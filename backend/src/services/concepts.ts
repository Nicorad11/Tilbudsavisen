import { KNOWN_BRANDS, splitLeadingBrand, trigramSimilarity } from '@tilbudsradar/scrapers';

/**
 * Varetyper: de generiske varer et tilbud dækker, uden mærke og mængde.
 *
 *   "MADVÆRKET Hakket oksekød"                    → hakket oksekød
 *   "Hakket okse- eller grise/kalvekød"           → hakket oksekød, hakket grisekød, hakket kalvekød
 *   "Kyllingebrystfilet eller -inderfilet"        → kyllingebrystfilet, kyllingeinderfilet
 *   "STEFF HOULBERG Hotdog-, grill- eller bayerske pølser" → hotdogpølser, grillpølser, bayerske pølser
 *
 * Bruges både til søgeforslag ("okse" → "Hakket oksekød") og som ekstra
 * match i søgningen, så et forslag altid finder de tilbud det kom fra.
 */

/** Efterled som et "X-" kan sættes foran: "okse-" + "kalvekød" → "oksekød". */
const HEADS = [
  'kød', 'filet', 'fileter', 'bryst', 'lår', 'overlår', 'underlår', 'vinger', 'steg', 'pølser', 'pølse', 'bøffer',
  'frikadeller', 'schnitzel', 'schnitzler', 'strimler', 'kebab', 'suppe', 'sovs', 'sauce', 'ost', 'mælk', 'fløde',
  'smør', 'yoghurt', 'skyr', 'ris', 'pasta', 'brød', 'boller', 'kage', 'kager', 'donuts', 'kiks', 'chips', 'juice',
  'saft', 'vin', 'øl', 'sodavand', 'kaffe', 'olie', 'salat', 'blanding', 'mix', 'røget', 'valsede', 'pleje', 'sæt',
  'gryn', 'marked', 'æg', 'rejer', 'laks', 'pålæg', 'postej', 'creme', 'is',
].sort((a, b) => b.length - a.length);

/** Forled der deles af "X eller -Y": "Kyllingebrystfilet eller -inderfilet" → "kyllinge" + "inderfilet". */
const MODIFIERS = [
  'kyllinge', 'kylling', 'kalkun', 'ande', 'and', 'okse', 'grise', 'gris', 'kalve', 'lamme', 'svine', 'halloween',
].sort((a, b) => b.length - a.length);

/** Ord der ikke skiller varer fra hinanden ("danske", "økologisk", "hele"). */
const FILLER = new Set([
  'dansk', 'danske', 'danskt', 'økologisk', 'økologiske', 'øko', 'hel', 'hele', 'fersk', 'ferske', 'frisk', 'friske',
  'stor', 'store', 'lille', 'små', 'klassisk', 'klassiske', 'classic', 'original', 'xxl', 'ny', 'nye', 'fx', 'bl.a',
  'flere', 'varianter', 'variant', 'udvalgte', 'diverse', 'div', 'assorteret', 'ass', 'frit', 'valg', 'pr', 'stk',
  'fast', 'lav', 'pris', 'the', 'la', 'le', 'de', 'et', 'en', 'fra', 'kun', 'nu', 'den', 'det', 'luksus', 'kæmpekøb',
]);

/** Varetyper der ikke er en vare men en kampagne ("Ølmarked", "Julefrokost"). */
const NOT_A_PRODUCT = /(?:marked|sortiment|udvalg|menu|buffet|frokost|tilbud|kampagne)$/;

/**
 * Mærker der står i avistitlerne, men ikke i scrapernes mærkeliste. Holdes her,
 * fordi en ændring af KNOWN_BRANDS ændrer normaliserede navne og dermed hvordan
 * tilbud kobles til varer i prishistorikken.
 */
const EXTRA_BRANDS = [
  'murph', 'sanex', 'livol', 'nissin', 'easis', 'taffel', 'buko', 'klovborg', 'kinder', 'ferrero', 'fazer', 'umage',
  'dava', 'propud', 'hellmanns', 'maille', 'frosch', 'willemoes', 'athena', 'innocent', 'danpo', 'valsemøllen',
  'sødergården', 'leffe', 'karolines', 'ørbæk', 'frisko', 'møllegaarden', 'trapiche', 'oreo', 'gullón', 'schwarzkopf',
  'zucchi', 'skippers', 'mars', 'malaco', 'mixa', 'castus', 'rexona', 'bosio', 'smirnoff', 'carletti', 'landana',
  'elvital', 'philips', 'stuhr', 'gustus', 'la molisana', 'molisana', 'castillo', 'fynbo', 'them', 'puck', 'amo',
  'cruesli', 'velsmag', 'zelected', 'apoderma', 'olaplex', 'biotherm', 'vichy', 'garmin', 'epigenetics', 'helfrich',
  'fournier', 'høgelund', 'fredsted', 'samsø', 'valor', 'finca', 'honningbien', 'chokoladehuset', 'smuuti',
];

const BRANDS_SORTED = [...KNOWN_BRANDS, ...EXTRA_BRANDS].sort((a, b) => b.length - a.length);
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const BRAND_RE = new RegExp(`(?<![\\p{L}\\d])(?:${BRANDS_SORTED.map(escape).join('|')})(?![\\p{L}\\d])`, 'gu');

const lower = (s: string) => s.toLocaleLowerCase('da-DK');

function headOf(word: string): string | null {
  for (const h of HEADS) if (word.endsWith(h)) return h;
  return null;
}

function modifierOf(word: string): string | null {
  for (const m of MODIFIERS) if (word.startsWith(m) && word.length > m.length + 2) return m;
  // "Halloweenboller eller -donuts": forleddet er ordet minus efterleddet.
  const head = headOf(word);
  return head && word.length - head.length >= 3 ? word.slice(0, -head.length) : null;
}

/** Ental/flertal slås sammen: "laksefileter" og "laksefilet", "bananer" og "banan". */
export function stem(word: string): string {
  if (word.length < 5) return word;
  for (const suffix of ['erne', 'ene', 'er', 'e', 'r']) {
    if (word.endsWith(suffix) && word.length - suffix.length >= 4) return word.slice(0, -suffix.length);
  }
  return word;
}

/** Nøgle der samler ental/flertal af samme varetype. */
export function conceptKey(concept: string): string {
  const words = concept.split(' ');
  return [...words.slice(0, -1), stem(words[words.length - 1]!)].join(' ');
}

function cleanPart(part: string): string {
  return part
    .replace(/\d+(?:[.,]\d+)?\s*(?:-\s*\d+(?:[.,]\d+)?)?\s*(?:%|kg|g|gr|l|cl|ml|dl|stk|pk)?\.?(?![\p{L}])/gu, ' ')
    .replace(/[^\p{L}\s-]/gu, ' ')
    .split(/\s+/)
    .map((w) => w.replace(/^-+(?=-)|(?<=-)-+$/g, ''))
    // Enkeltbogstaver er rester af "A+", "M&M's" o.l.
    .filter((w) => (w.match(/\p{L}/gu) ?? []).length >= 2 && !FILLER.has(w))
    .join(' ')
    .trim();
}

/** Udleder varetyperne i en tilbudstitel. */
export function extractConcepts(title: string): string[] {
  // Apostroffer væk, så "Stryhn's" genkendes som mærket "stryhns".
  let t = lower(splitLeadingBrand(title).rest).replace(/['’`´]/g, '');
  t = t.replace(BRAND_RE, ' ');
  // "okse/grisekød" betyder "okse- eller grisekød"; "shampoo/ shower gel" er to varer.
  t = t.replace(/(\p{L})\/(?=\p{L})/gu, '$1- eller ').replace(/\s*\/\s*/g, ' eller ');
  // "med grønt", "af brystfilet", "i skiver", "til håndled": beskriver varen, er ikke en vare.
  t = t.replace(/\s+(?:med|af|i|til|uden|på)\s+[^,]*?(?=,|\s+eller\s+|$)/g, '');

  const parts = t
    .split(/\s*,\s*(?:eller\s+|og\s+)?|\s+eller\s+|\s+og\s+|\s+&\s+/)
    .map(cleanPart)
    .filter(Boolean);

  const out: string[] = [];
  parts.forEach((part, i) => {
    let words = part.split(' ');
    const last = words[words.length - 1]!;
    if (last.endsWith('-')) {
      // "okse-" får efterleddet fra første efterfølgende del uden bindestreg.
      const next = parts.slice(i + 1).find((p) => !p.split(' ')[0]!.endsWith('-'))?.split(' ');
      if (!next) return;
      const firstHead = headOf(next[0]!);
      if (firstHead) {
        // "kold- eller varmrøget laks" → "koldrøget laks": resten af den næste del følger med.
        words = [...words.slice(0, -1), last.slice(0, -1) + firstHead, ...next.slice(1)];
      } else {
        // "Hotdog- eller bayerske pølser" → "hotdogpølser".
        const lastHead = headOf(next[next.length - 1]!);
        if (!lastHead) return;
        words = [...words.slice(0, -1), last.slice(0, -1) + lastHead];
      }
    }
    if (words[0]!.startsWith('-')) {
      // "-inderfilet" får forleddet fra den seneste del uden bindestreg foran
      // ("Kyllingevinger, -lårfilet eller -underlår" → "kyllinge").
      const anchor = parts
        .slice(0, i)
        .reverse()
        .find((p) => !p.startsWith('-'));
      const prevWord = anchor?.split(' ').at(-1)?.replace(/-$/, '');
      const mod = prevWord ? modifierOf(prevWord) : null;
      if (!mod) return;
      words = [mod + words[0]!.slice(1), ...words.slice(1)];
    }
    out.push(words.join(' '));
  });

  // "Hakket okse- eller grise/kalvekød": "hakket" gælder alle alternativerne.
  if (out[0]?.startsWith('hakket ')) {
    for (let i = 1; i < out.length; i++) if (!out[i]!.startsWith('hakket')) out[i] = `hakket ${out[i]}`;
  }

  return [
    ...new Set(
      out
        .map((c) => c.replace(/-/g, ' ').replace(/\s+/g, ' ').trim())
        .filter((c) => {
          const words = c.split(' ');
          return (c.match(/\p{L}/gu) ?? []).length >= 2 && words.length <= 4 && !NOT_A_PRODUCT.test(c);
        }),
    ),
  ];
}

/* ------------------------------------------------------------------ */
/* Matching                                                           */
/* ------------------------------------------------------------------ */

/**
 * Hovedord der også må stå sidst i et sammensat ord: "æg" → "skrabeæg",
 * "mælk" → "kakaomælk". Værdien udelukker falske venner ("pålæg", "boost").
 */
const COMPOUND_HEADS: Record<string, RegExp> = {
  æg: /(?<!l)æg$/,
  mælk: /mælk$/,
  ost: /(?<!o)ost$/,
  kød: /kød$/,
  brød: /brød$/,
  øl: /(?<!p)øl$/,
  pølser: /pølser$/,
  pølse: /pølser?$/,
  fløde: /fløde$/,
  smør: /smør$/,
  yoghurt: /yoghurt$/,
  filet: /filet(?:er)?$/,
  bryst: /bryst$/,
  steg: /steg$/,
  salat: /salat$/,
  suppe: /suppe$/,
  juice: /juice$/,
  saft: /saft$/,
  vin: /(?<![aeiouyæøå])vin$/,
  kaffe: /kaffe$/,
  chips: /chips$/,
  boller: /boller$/,
  laks: /laks$/,
  rejer: /rejer$/,
  kål: /kål$/,
  løg: /løg$/,
};

/** Kæderne skriver "gris", folk søger også "svin". */
const SYNONYMS: Record<string, string[]> = {
  svin: ['gris', 'grise'],
  svine: ['grise', 'gris'],
  svinekød: ['grisekød'],
  gris: ['svin', 'svine'],
  grise: ['svine'],
  grisekød: ['svinekød'],
  hk: ['hakket'],
  fars: ['hakket'],
  kartofler: ['kartoffel'],
  kartoffel: ['kartofler'],
};

export function queryTokens(q: string): string[] {
  return [...new Set(lower(q).split(/[^\p{L}\p{N}]+/u).filter(Boolean))].slice(0, 6);
}

export function conceptWords(concept: string): string[] {
  return concept.split(/[\s-]+/).filter(Boolean);
}

/**
 * Hvor godt ét søgeord rammer et ord i en varetype (0 = ikke).
 * `typing`: brugeren er ved at skrive ordet, så et kort ord må være et præfiks.
 */
function tokenStrength(token: string, words: string[], typing: boolean, viaSynonym = false): number {
  const variants = [token, ...(token.length >= 5 ? [stem(token)] : [])];
  let best = 0;
  for (const t of variants) {
    for (const w of words) {
      if (w === t || stem(w) === t) best = Math.max(best, 4);
      // Synonymer skal være lange nok til ikke at ramme noget andet ("gris" → "grissini").
      else if (w.startsWith(t) && (viaSynonym ? t.length >= 5 : t.length >= 3 || typing)) best = Math.max(best, 3);
      else if (COMPOUND_HEADS[t]?.test(w)) best = Math.max(best, 2.5);
      else if (t.length >= 5 && w.includes(t)) best = Math.max(best, 1);
    }
  }
  // Kun ét led: "grisekød" ↔ "svinekød" peger på hinanden.
  if (best === 0 && !viaSynonym) {
    for (const syn of SYNONYMS[token] ?? []) best = Math.max(best, tokenStrength(syn, words, typing, true) - 0.5);
  }
  return best;
}

/** Samlet matchstyrke for en varetype, eller 0 hvis ikke alle søgeord rammer. */
export function matchConcept(words: string[], tokens: string[], opts: { typing?: boolean } = {}): number {
  if (!tokens.length) return 0;
  let sum = 0;
  for (let i = 0; i < tokens.length; i++) {
    const s = tokenStrength(tokens[i]!, words, Boolean(opts.typing) && i === tokens.length - 1);
    if (s <= 0) return 0;
    sum += s;
  }
  return sum / tokens.length;
}

/** Stavefejl som sidste udvej: "kafe" → "kaffe". Kun for ét ord på mindst 4 tegn. */
export function typoMatch(words: string[], tokens: string[]): number {
  if (tokens.length !== 1 || tokens[0]!.length < 4) return 0;
  const t = tokens[0]!;
  return Math.max(0, ...words.map((w) => trigramSimilarity(t, w))) >= 0.5 ? 0.5 : 0;
}
