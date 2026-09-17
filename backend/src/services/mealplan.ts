import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import type { MealPlanDTO, MealPlanRequest } from '@tilbudsradar/shared';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { query, type Db } from '../db/client';
import { mealPlanRecipes, mealPlans, type StoredIngredient } from '../db/schema';
import { env, log } from '../env';
import { type OfferRow, OFFER_SELECT } from './offers';

/* ------------------------------------------------------------------ */
/* Kontekst: ugens relevante madvarer på tilbud                       */
/* ------------------------------------------------------------------ */

const BUCKETS: [string, number][] = [
  ['kod-fisk', 30],
  ['frugt-gront', 30],
  ['mejeri', 18],
  ['kolonial', 18],
  ['brod', 8],
  ['frost', 10],
];

async function offerContext(db: Db, storeIds: string[] | null): Promise<OfferRow[]> {
  const storeFilter = storeIds?.length ? sql`AND o.store_id IN (${sql.join(storeIds.map((s) => sql`${s}`), sql`, `)})` : sql``;
  const out: OfferRow[] = [];
  for (const [category, limit] of BUCKETS) {
    out.push(
      ...(await query<OfferRow>(
        db,
        sql`SELECT ${OFFER_SELECT} FROM offers o JOIN stores s ON s.id = o.store_id
            WHERE s.enabled AND o.valid_to > now() AND o.valid_from <= now() + interval '2 days'
              AND o.category = ${category} ${storeFilter}
            ORDER BY o.unit_price ASC NULLS LAST
            LIMIT ${limit}`,
      )),
    );
  }
  return out;
}

const fmtKr = (n: number | null) => (n == null ? '-' : n.toFixed(2).replace('.', ','));

function describeOffer(o: OfferRow): string {
  const size =
    o.quantity_min && o.unit !== 'stk'
      ? `${o.unit === 'kg' ? Math.round(o.quantity_min * 1000) + ' g' : Math.round(o.quantity_min * 100) + ' cl'}`
      : o.quantity_min && o.quantity_min > 1
        ? `${o.quantity_min} stk`
        : '';
  return `#${o.id} | ${o.store_name} | ${o.title} | ${fmtKr(o.offer_price)} kr | ${size} | ${fmtKr(o.unit_price)} kr/${o.unit}`;
}

/* ------------------------------------------------------------------ */
/* AI-generering (Claude)                                             */
/* ------------------------------------------------------------------ */

const PlanSchema = z.object({
  summary: z.string(),
  recipes: z.array(
    z.object({
      day: z.number().int(),
      title: z.string(),
      description: z.string(),
      servings: z.number().int(),
      estimatedCost: z.number(),
      ingredients: z.array(
        z.object({
          name: z.string(),
          amount: z.string(),
          offerId: z.number().int().nullable(),
        }),
      ),
      steps: z.array(z.string()),
    }),
  ),
});
type GeneratedPlan = z.infer<typeof PlanSchema>;

const SYSTEM_PROMPT = `Du er en erfaren dansk madplanlægger. Du laver realistiske, familievenlige aftensmåltider
der primært bruger varer, som er på tilbud i denne uge, så husstanden sparer penge.

Retningslinjer:
- Skriv på dansk. Retterne skal kunne laves på 20-45 minutter i et almindeligt dansk køkken.
- Brug tilbudsvarerne fra listen, og henvis til dem med deres id i feltet offerId. Basisvarer der
  typisk er i skabet (salt, peber, olie, mel, krydderier) har offerId null.
- Brug kun offerId-værdier der står i listen. Find aldrig på et id.
- Genbrug gerne en tilbudsvare på tværs af dage, så intet går til spilde.
- estimatedCost er den forventede pris i kr for retten, baseret på tilbudspriserne og normale priser
  for resten. Hold den samlede pris inden for budgettet, hvis der er et.
- Respektér kostpræferencer og allergier fuldt ud.
- summary er 1-2 sætninger om ugens plan og den forventede besparelse.`;

async function generateWithClaude(req: Required<MealPlanRequest>, offers: OfferRow[]): Promise<GeneratedPlan | null> {
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const userPrompt = [
    `Lav en madplan med aftensmad til ${req.days} dage (day = 1..${req.days}).`,
    `Husstand: ${req.householdSize} personer (servings = ${req.householdSize}).`,
    req.budget ? `Budget for hele ugen: ${req.budget} kr.` : 'Intet fast budget – men hold det billigt.',
    req.preferences.length ? `Kostpræferencer: ${req.preferences.join(', ')}.` : 'Ingen særlige kostpræferencer.',
    req.allergies.length ? `Allergier/undgå: ${req.allergies.join(', ')}.` : 'Ingen allergier.',
    '',
    'Ugens tilbud (id | butik | vare | pris | pakning | enhedspris):',
    ...offers.map(describeOffer),
  ].join('\n');

  const response = await client.beta.messages.parse({
    model: env.ANTHROPIC_MODEL,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
    output_config: {
      format: betaZodOutputFormat(PlanSchema),
      ...(env.ANTHROPIC_EFFORT ? { effort: env.ANTHROPIC_EFFORT } : {}),
    },
  });

  if (response.stop_reason === 'refusal') {
    log.warn('Claude afviste madplan-forespørgslen – bruger regelbaseret plan');
    return null;
  }
  if (response.stop_reason === 'max_tokens') {
    log.warn('Madplanen blev afkortet (max_tokens) – bruger regelbaseret plan');
    return null;
  }
  return response.parsed_output ?? null;
}

/* ------------------------------------------------------------------ */
/* Regelbaseret fallback                                              */
/* ------------------------------------------------------------------ */

/** En ingrediens: mønster på titlen + hvilke kategorier tilbuddet skal være i. */
interface Match {
  label: string;
  re: RegExp;
  cats: string[];
}

const m = (label: string, re: RegExp, cats: string[]): Match => ({ label, re, cats });
const GRONT = ['frugt-gront', 'frost'];
const KOD = ['kod-fisk', 'frost'];

// Mønstrene bruger bogstav-grænser (\p{L}), så "pålæg" ikke er æg og "leverpostej" ikke er ost.
const RIS = m('ris', /(?<!\p{L})ris(?!\p{L})|basmati|jasmin/iu, ['kolonial']);
const LOG = m('løg', /(?<!\p{L})(?:rød)?løg(?!\p{L})/iu, GRONT);
const KARTOFLER = m('kartofler', /kartof/iu, GRONT);
const PASTA = m('pasta', /spaghetti|pasta|penne/iu, ['kolonial']);
const BROD = m('brød', /brød|flutes|baguette/iu, ['brod']);

interface Template {
  title: string;
  protein: Match | null;
  vegetarian: boolean;
  description: string;
  sides: Match[];
  pantry: string[];
  steps: string[];
}

const TEMPLATES: Template[] = [
  {
    title: 'Spaghetti bolognese',
    protein: m('hakket kød', /hakket|oksekød|grisekød/iu, KOD),
    vegetarian: false,
    description: 'Klassisk kødsovs med grøntsager og pasta.',
    sides: [PASTA, m('hakkede tomater', /tomat/iu, ['kolonial', 'frugt-gront']), m('gulerødder', /gulerød/iu, GRONT)],
    pantry: ['olie', 'salt og peber', 'oregano'],
    steps: [
      'Svits hakket løg og gulerod i olie.',
      'Brun kødet, tilsæt tomater og krydderier, og lad saucen simre 20 min.',
      'Kog pastaen efter anvisningen og server med saucen.',
    ],
  },
  {
    title: 'Kylling i karry med ris',
    protein: m('kylling', /kylling/iu, KOD),
    vegetarian: false,
    description: 'Mild karryret med grøntsager.',
    sides: [
      RIS,
      m('grøntsager', /peberfrugt|broccoli|squash|gulerød/iu, GRONT),
      m('fløde', /fløde|kokosmælk/iu, ['mejeri', 'kolonial']),
    ],
    pantry: ['karry', 'løg', 'olie'],
    steps: [
      'Skær kyllingen i tern og brun den med karry og løg.',
      'Tilsæt grøntsager og fløde/kokosmælk, og lad det simre 15 min.',
      'Server med kogte ris.',
    ],
  },
  {
    title: 'Ovnbagt laks med kartofler',
    protein: m('fisk', /laks|torsk|fisk|(?<!\p{L})sej(?!\p{L})|rødspætte/iu, KOD),
    vegetarian: false,
    description: 'Fisk i ovn med citron, kartofler og grønt.',
    sides: [KARTOFLER, m('grønt', /broccoli|ærter|salat|asparges/iu, GRONT), m('citron', /citron/iu, ['frugt-gront'])],
    pantry: ['olie', 'salt og peber', 'dild'],
    steps: [
      'Kog kartoflerne møre.',
      'Læg fisken i et fad med citron, olie og krydderier, og bag 15 min ved 200 °C.',
      'Server med kartofler og dampet grønt.',
    ],
  },
  {
    title: 'Medister med kartofler og rødkål',
    protein: m('medister', /medister|pølse|frikadelle|karbonade|kødbolle/iu, KOD),
    vegetarian: false,
    description: 'Dansk hverdagsklassiker.',
    sides: [KARTOFLER, m('rødkål', /kål(?!\p{L})/iu, ['frugt-gront', 'kolonial'])],
    pantry: ['smør', 'salt og peber'],
    steps: ['Steg kødet gyldent på panden.', 'Kog kartoflerne.', 'Varm rødkålen og server det hele sammen.'],
  },
  {
    title: 'Svinekoteletter med bagte rodfrugter',
    protein: m('svinekød', /kotelet|nakke|mørbrad|svinekød|flæsk|(?<!\p{L})gris/iu, KOD),
    vegetarian: false,
    description: 'Stegt svinekød med ovnbagte rodfrugter.',
    sides: [m('rodfrugter', /kartof|gulerød|pastinak|rødbede/iu, GRONT), LOG],
    pantry: ['olie', 'timian', 'salt og peber'],
    steps: [
      'Skær rodfrugterne i både og bag dem 30 min ved 200 °C.',
      'Steg kødet 3-4 min på hver side.',
      'Server med rodfrugterne.',
    ],
  },
  {
    title: 'Grøntsagssuppe med brød',
    protein: null,
    vegetarian: true,
    description: 'Mættende suppe af sæsonens grøntsager.',
    sides: [m('grøntsager', /gulerød|kartof|porre|squash|kål(?!\p{L})/iu, GRONT), LOG, BROD],
    pantry: ['bouillon', 'olie', 'salt og peber'],
    steps: [
      'Svits løg og grøntsager i olie.',
      'Tilsæt vand og bouillon, og kog 20 min.',
      'Blend suppen og server med brød.',
    ],
  },
  {
    title: 'Pasta med pesto og grøntsager',
    protein: null,
    vegetarian: true,
    description: 'Hurtig pasta med grønne grøntsager.',
    sides: [PASTA, m('pesto', /pesto/iu, ['kolonial', 'mejeri']), m('grøntsager', /broccoli|squash|spinat|ærter|tomat/iu, GRONT)],
    pantry: ['olie', 'salt og peber'],
    steps: ['Kog pastaen.', 'Steg grøntsagerne kort.', 'Vend det hele med pesto og server.'],
  },
  {
    title: 'Omelet med grønt og brød',
    protein: m('æg', /(?<!l)æg(?!\p{L})/iu, ['mejeri']),
    vegetarian: true,
    description: 'Luftig omelet med det grønt, der er på tilbud.',
    sides: [
      m('grøntsager', /tomat|peberfrugt|spinat|champignon|squash/iu, GRONT),
      BROD,
      m('ost', /(?<![rpm])ost(?!\p{L})/iu, ['mejeri']),
    ],
    pantry: ['mælk', 'smør', 'salt og peber'],
    steps: ['Pisk æggene med lidt mælk.', 'Steg grøntsagerne, hæld æggemassen over, og lad den stivne.', 'Server med brød.'],
  },
];

function ruleBasedPlan(req: Required<MealPlanRequest>, offers: OfferRow[]): GeneratedPlan {
  const vegetarian = req.preferences.some((p) => /vegetar|vegan|plantebas/i.test(p));
  const avoid = req.allergies.map((a) => a.toLowerCase()).filter(Boolean);
  const allowed = offers.filter((o) => !avoid.some((a) => o.title.toLowerCase().includes(a)));
  const templates = TEMPLATES.filter((t) => (vegetarian ? t.vegetarian : true));
  const used = new Set<string>();
  const recipes: GeneratedPlan['recipes'] = [];

  const pick = (match: Match, exclude: Set<number> = new Set()) =>
    allowed
      .filter((o) => match.cats.includes(o.category) && match.re.test(o.title) && !exclude.has(o.id))
      .sort((a, b) => a.offer_price - b.offer_price)[0];

  // Retter med en protein på tilbud først, derefter resten.
  const ranked = [...templates].sort((a, b) => Number(Boolean(b.protein && pick(b.protein))) - Number(Boolean(a.protein && pick(a.protein))));
  for (let day = 1; day <= req.days; day++) {
    const t = ranked.find((x) => !used.has(x.title)) ?? ranked[(day - 1) % ranked.length]!;
    used.add(t.title);
    const ingredients: GeneratedPlan['recipes'][number]['ingredients'] = [];
    const inRecipe = new Set<number>();
    let cost = 0;
    const main = t.protein ? pick(t.protein) : undefined;
    if (main) {
      inRecipe.add(main.id);
      ingredients.push({ name: main.title, amount: `${Math.max(1, Math.ceil(req.householdSize / 4))} pk.`, offerId: main.id });
      cost += main.offer_price * Math.max(1, Math.ceil(req.householdSize / 4));
    } else if (t.protein) {
      ingredients.push({ name: t.protein.label, amount: `${req.householdSize * 125} g`, offerId: null });
      cost += 12 * req.householdSize;
    }
    for (const side of t.sides) {
      // Samme tilbud bruges ikke to gange i én ret.
      const o = pick(side, inRecipe);
      if (o) {
        inRecipe.add(o.id);
        ingredients.push({ name: o.title, amount: '1 pk.', offerId: o.id });
        cost += o.offer_price * 0.6;
      } else {
        ingredients.push({ name: side.label, amount: 'efter behov', offerId: null });
        cost += 8;
      }
    }
    for (const p of t.pantry) ingredients.push({ name: p, amount: 'efter smag', offerId: null });
    recipes.push({
      day,
      title: t.title,
      description: t.description,
      servings: req.householdSize,
      estimatedCost: Math.round(cost),
      ingredients,
      steps: t.steps,
    });
  }
  const total = recipes.reduce((s, r) => s + r.estimatedCost, 0);
  return {
    summary: `Regelbaseret plan for ${req.days} dage bygget på ugens billigste tilbud. Anslået pris ${total} kr${
      req.budget ? ` (budget ${req.budget} kr)` : ''
    }.`,
    recipes,
  };
}

/* ------------------------------------------------------------------ */
/* Offentlig API                                                      */
/* ------------------------------------------------------------------ */

export async function createMealPlan(db: Db, userId: string, input: MealPlanRequest): Promise<MealPlanDTO> {
  const req: Required<MealPlanRequest> = {
    householdSize: input.householdSize,
    budget: input.budget ?? null,
    days: input.days ?? 5,
    preferences: input.preferences ?? [],
    allergies: input.allergies ?? [],
    storeIds: input.storeIds ?? [],
  };
  const offers = await offerContext(db, req.storeIds.length ? req.storeIds : null);
  const byId = new Map(offers.map((o) => [o.id, o]));

  let plan: GeneratedPlan | null = null;
  let generatedBy: 'ai' | 'regler' = 'regler';
  if (env.ANTHROPIC_API_KEY && offers.length) {
    try {
      plan = await generateWithClaude(req, offers);
      if (plan) generatedBy = 'ai';
    } catch (err) {
      if (err instanceof Anthropic.RateLimitError) log.warn('Claude rate limit – bruger regelbaseret madplan');
      else if (err instanceof Anthropic.APIError) log.warn(`Claude API-fejl ${err.status} – bruger regelbaseret madplan`, { err: err.message });
      else log.error('Madplan-generering fejlede', { err: String(err) });
    }
  }
  plan ??= ruleBasedPlan(req, offers);

  const recipes = plan.recipes
    .filter((r) => r.day >= 1 && r.day <= req.days)
    .map((r) => ({
      ...r,
      servings: r.servings > 0 ? r.servings : req.householdSize,
      estimatedCost: Math.max(0, Math.round(r.estimatedCost)),
      ingredients: r.ingredients.map((i): StoredIngredient => {
        // Id'er der ikke findes i konteksten (hallucinationer) fjernes.
        const offer = i.offerId !== null ? byId.get(i.offerId) : undefined;
        return {
          name: i.name,
          amount: i.amount,
          offerId: offer?.id ?? null,
          price: offer?.offer_price ?? null,
          storeName: offer?.store_name ?? null,
        };
      }),
    }));
  const totalCost = recipes.reduce((s, r) => s + r.estimatedCost, 0);

  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(mealPlans)
      .values({
        userId,
        householdSize: req.householdSize,
        budget: req.budget,
        days: req.days,
        preferences: [...req.preferences, ...req.allergies.map((a) => `uden ${a}`)],
        generatedBy,
        summary: plan.summary,
        totalCost,
      })
      .returning();
    const inserted = recipes.length
      ? await tx
          .insert(mealPlanRecipes)
          .values(
            recipes.map((r) => ({
              mealPlanId: row!.id,
              dayIndex: r.day,
              title: r.title,
              description: r.description,
              servings: r.servings,
              estimatedCost: r.estimatedCost,
              ingredients: r.ingredients,
              steps: r.steps,
            })),
          )
          .returning()
      : [];
    return toMealPlanDTO(row!, inserted);
  });
}

export function toMealPlanDTO(
  plan: typeof mealPlans.$inferSelect,
  recipes: (typeof mealPlanRecipes.$inferSelect)[],
): MealPlanDTO {
  return {
    id: plan.id,
    createdAt: plan.createdAt.toISOString(),
    householdSize: plan.householdSize,
    budget: plan.budget,
    days: plan.days,
    preferences: plan.preferences,
    generatedBy: plan.generatedBy === 'ai' ? 'ai' : 'regler',
    summary: plan.summary,
    totalCost: plan.totalCost,
    recipes: recipes
      .sort((a, b) => a.dayIndex - b.dayIndex)
      .map((r) => ({
        id: r.id,
        day: r.dayIndex,
        title: r.title,
        description: r.description,
        servings: r.servings,
        estimatedCost: r.estimatedCost,
        ingredients: r.ingredients,
        steps: r.steps,
      })),
  };
}
