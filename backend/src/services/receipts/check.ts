import type {
  ParsedReceipt,
  ReceiptCheckDTO,
  ReceiptItemCheck,
  ReceiptLine,
  ReceiptVerdict,
  StoreRef,
} from '@tilbudsradar/shared';
import { groupReceiptLines, sumLines } from '@tilbudsradar/shared';
import { basicClean, levenshteinRatio, parseQuantity, splitLeadingBrand } from '@tilbudsradar/scrapers';
import { sql } from 'drizzle-orm';
import { query, type Db } from '../../db/client';
import { OFFER_SELECT, toOfferDTOs, type OfferRow } from '../offers';
import { activeChainSql } from '../scope';

/**
 * Tjekker en kvittering mod kædens avis på købsdagen.
 *
 * Kvitteringsnavne er forkortede ("Henriettelund Skrab", "Ristede pistac. nød."),
 * mens avisen bruger lange navne ("HENRIETTELUND Skrabeæg"). Matchingen er derfor
 * ord-for-ord med præfikser og sammensatte ord – og bevidst forsigtig: et forkert
 * "du har betalt for meget" er værre end et overset tilbud. Kun sikre match kan
 * give "mulig fejl"; usikre match bliver til "tjek selv".
 */

const r2 = (n: number) => Math.round(n * 100) / 100;
const kr = (n: number) => r2(n).toFixed(2).replace('.', ',');

/* ------------------------------------------------------------------ */
/* Ord                                                                */
/* ------------------------------------------------------------------ */

const STOP = new Set([
  'og', 'eller', 'med', 'i', 'af', 'pr', 'ca', 'fx', 'til', 'på', 'uden', 'stk', 'styk', 'kg', 'g', 'gr', 'l', 'ml',
  'cl', 'dl', 'pk', 'pakke', 'bk', 'bakke', 'klasse', 'dansk', 'danske', 'danskt', 'ny', 'nye', 'ean', 'the', 'de',
  'la', 'le', 'x', 'dkk', 'kr', 'ass', 'assorteret', 'flere', 'varianter', 'sorter', 'sk1', 'sk',
]);

/** Beskrivende ord der ikke alene afgør om to varer er ens. */
const GENERIC = new Set([
  'nature', 'naturel', 'natur', 'classic', 'original', 'mild', 'hel', 'hele', 'stor', 'store', 'lille', 'fersk',
  'friske', 'frisk', 'ekstra', 'extra', 'premium', 'let', 'lys', 'mørk', 'fin', 'grov', 'plus', 'mini',
]);

const ORGANIC_RE = /(?:^|[^\p{L}])(?:øko|økolog\p{L}*|bio|organic)(?=[^\p{L}]|$)/iu;
const APP_RE =
  /lidl\s*plus|med\s+app(?:en)?\b|kun\s+med\s+.{0,20}app|medlemspris|medlemstilbud|coop\s*app|plus-?pris|salling\s*group\s*app|rema\s*1000\s*app/i;
const MAX_RE = /maks\.?\s*(\d{1,2})\b/i;
const SIZE_RE = /\d+(?:[.,]\d+)?\s*(?:kg|g|gr|l|ml|cl|dl|stk|pk)\b\.?/gi;

interface Tok {
  t: string;
  w: number;
}

function toks(text: string): Tok[] {
  const words = basicClean(text)
    .replace(SIZE_RE, ' ')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => (w.match(/\p{L}/gu) ?? []).length >= 2 && !STOP.has(w) && !ORGANIC_RE.test(` ${w} `));
  return [...new Set(words)].map((t) => ({ t, w: GENERIC.has(t) ? 0.3 : Math.max(0.4, Math.min(t.length, 10) / 10) }));
}

/** Kvitteringens ord mod avisens ord – tåler forkortelser, sammensatte ord og læsefejl. */
function tokMatch(r: string, o: string): boolean {
  if (r === o) return true;
  if (r.length >= 4 && o.startsWith(r)) return true; // "skrab" → "skrabeæg"
  if (o.length >= 4 && r.startsWith(o)) return true; // "granatæbler" → "granatæble"
  if (r.length >= 5 && o.includes(r)) return true; // "olivenolie" ⊂ "jomfruolivenolie"
  if (o.length >= 5 && r.includes(o)) return true; // "culturakefir" ⊃ "kefir"
  return r.length >= 6 && o.length >= 6 && levenshteinRatio(r, o) >= 0.8; // læsefejl
}

function coverage(from: Tok[], against: Tok[]): number {
  const total = from.reduce((s, x) => s + x.w, 0);
  if (!total) return 0;
  return from.reduce((s, x) => s + (against.some((y) => tokMatch(x.t, y.t) || tokMatch(y.t, x.t)) ? x.w : 0), 0) / total;
}

/* ------------------------------------------------------------------ */
/* Tilbud                                                             */
/* ------------------------------------------------------------------ */

interface PreparedOffer {
  row: OfferRow;
  brand: Tok[];
  /** Avisens "A eller B" som separate alternativer. */
  alternatives: Tok[][];
  /** Øko i titlen – så skal kvitteringen også sige øko. */
  organicTitle: boolean;
  /** Øko i titel eller beskrivelse (Vallø Slotsæg er økologiske, selvom navnet ikke siger det). */
  organicAny: boolean;
  requiresApp: boolean;
  maxPerCustomer: number | null;
  /** Gjaldt tilbuddet ifølge avisen på købstidspunktet (±3 timer)? */
  validAtPurchase: boolean;
  /** Tilbuddet startede først efter købet (næste uges avis). */
  early: boolean;
}

function prepare(row: OfferRow): PreparedOffer {
  const { brand, rest } = splitLeadingBrand(row.title);
  const brandToks = toks([row.brand, brand].filter(Boolean).join(' '));
  const alternatives = rest
    .split(/\s+eller\s+|,\s+|\s+og\s+|\s+\/\s+/i)
    .map((a) => toks(a).filter((x) => !brandToks.some((b) => b.t === x.t)))
    .filter((a) => a.length);
  const text = `${row.title} ${row.description ?? ''}`;
  const max = MAX_RE.exec(row.description ?? '');
  return {
    row,
    brand: brandToks,
    alternatives: alternatives.length ? alternatives : [brandToks],
    organicTitle: ORGANIC_RE.test(row.title),
    organicAny: ORGANIC_RE.test(text),
    requiresApp: APP_RE.test(text),
    maxPerCustomer: max ? Number(max[1]) : null,
    validAtPurchase: true,
    early: false,
  };
}

const HOUR = 3_600_000;

/**
 * Tilbud omkring købstidspunktet. Butikkerne starter tit ugens priser en dag før
 * avisens officielle start (Lidl lørdag i stedet for søndag), så nabodagene tages
 * med – men de må kun bekræfte en pris, aldrig give "mulig fejl".
 */
async function loadOffers(db: Db, at: Date): Promise<PreparedOffer[]> {
  const rows = await query<OfferRow>(
    db,
    sql`SELECT ${OFFER_SELECT} FROM offers o JOIN stores s ON s.id = o.store_id
        WHERE ${activeChainSql} AND s.enabled
          AND o.valid_from <= ${new Date(at.getTime() + 30 * HOUR)}
          AND o.valid_to >= ${new Date(at.getTime() - 30 * HOUR)}`,
  );
  return rows.map((row) => {
    const offer = prepare(row);
    const from = new Date(row.valid_from).getTime();
    const to = new Date(row.valid_to).getTime();
    offer.validAtPurchase = from <= at.getTime() + 3 * HOUR && to >= at.getTime() - 3 * HOUR;
    offer.early = from > at.getTime() + 3 * HOUR;
    return offer;
  });
}

/* ------------------------------------------------------------------ */
/* Match                                                              */
/* ------------------------------------------------------------------ */

type Level = 'sure' | 'likely' | 'similar';

interface Candidate {
  offer: PreparedOffer;
  level: Level;
  score: number;
  /** Avisens pris pr. stk (pakning) eller pr. kg for vægtvarer. */
  expectedPer: number | null;
}

interface Line {
  item: ReceiptLine;
  toks: Tok[];
  organic: boolean;
  size: ReturnType<typeof parseQuantity>;
  isWeight: boolean;
  paidPerUnit: number;
}

function evaluate(line: Line, offer: PreparedOffer): Candidate | null {
  if (!line.toks.length) return null;
  // "Øko. blomkål" er ikke "Dansk blomkål" – og omvendt.
  if (line.organic ? !offer.organicAny : offer.organicTitle) return null;
  const brandAndAlt = (alt: Tok[]) => [...alt, ...offer.brand];
  let covR = 0;
  let covO = 0;
  for (const alt of offer.alternatives) {
    const r = coverage(line.toks, brandAndAlt(alt));
    const o = coverage(alt, line.toks);
    if (r * 0.65 + o * 0.35 > covR * 0.65 + covO * 0.35) {
      covR = r;
      covO = o;
    }
  }
  const score = covR * 0.65 + covO * 0.35;
  if (covR < 0.6 || score < 0.6) return null;

  const row = offer.row;
  let expectedPer: number | null;
  if (line.isWeight) expectedPer = row.unit === 'kg' && row.unit_price ? row.unit_price : null;
  else expectedPer = row.offer_price;

  // Anden pakningsstørrelse ("Løg 1kg" mod "Danske løg 750 g") → ikke samme vare.
  const size = line.size;
  const sizeConflict =
    !line.isWeight &&
    size != null &&
    row.quantity_min != null &&
    size.unit === row.unit &&
    (size.min < row.quantity_min * 0.85 || size.min > (row.quantity_max ?? row.quantity_min) * 1.15);
  const ratio = expectedPer ? line.paidPerUnit / expectedPer : null;
  // Løsvægt (kg × pris) mod en fast pakning kræver næsten identiske navne.
  const sure = line.isWeight ? covR >= 0.9 && covO >= 0.9 : covR >= 0.8 && covO >= 0.85;
  // Er vi i tvivl om varen, skal prisen også ligge tæt på ("Mammen Guld ML" til 20 kr er ikke "Danbo Guld" til 49,95).
  const plausible = ratio != null && (sure ? ratio > 0.35 && ratio < 2.5 : ratio > 0.7 && ratio < 1.6);

  if (sizeConflict || !plausible) {
    return covR >= 0.75 && covO >= 0.6 ? { offer, level: 'similar', score, expectedPer } : null;
  }
  return { offer, level: sure ? 'sure' : 'likely', score, expectedPer };
}

const LEVEL_RANK: Record<Level, number> = { sure: 3, likely: 2, similar: 1 };

/**
 * Bedste tilbud for linjen. Ved lige gode navne (samme vare i flere aviser eller
 * mærker, fx to olivenolier) vinder det tilbud der forklarer den betalte pris,
 * dernæst det der gjaldt på købsdagen.
 */
function best(line: Line, offers: PreparedOffer[]): Candidate | null {
  const key = (c: Candidate) => {
    const exp = c.expectedPer ?? Infinity;
    const explains = Math.abs(exp - line.paidPerUnit) <= Math.max(0.1, exp * 0.01);
    return [LEVEL_RANK[c.level], Math.round(c.score * 50), explains ? 1 : 0, c.offer.validAtPurchase ? 1 : 0, -Math.abs(exp - line.paidPerUnit)];
  };
  let top: { c: Candidate; k: number[] } | null = null;
  for (const offer of offers) {
    const c = evaluate(line, offer);
    if (!c) continue;
    const k = key(c);
    if (!top || compareKeys(k, top.k) > 0) top = { c, k };
  }
  return top?.c ?? null;
}

function compareKeys(a: number[], b: number[]): number {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i]! - b[i]!;
  return 0;
}

/** Pris pr. kg/l/stk for kvitteringslinjen – kræver vægtvare eller størrelse i navnet. */
function paidBaseUnit(line: Line): { unit: string; price: number; amount: number } | null {
  if (line.isWeight) return { unit: 'kg', price: line.paidPerUnit, amount: line.item.quantity };
  const size = line.size;
  if (!size || size.min <= 0) return null;
  const perPack = (size.min + size.max) / 2 * Math.max(1, size.pieces);
  return { unit: size.unit, price: line.paidPerUnit / perPack, amount: perPack * line.item.quantity };
}

const APP_NAME: Record<string, string> = {
  lidl: 'Lidl Plus',
  netto: 'Salling Group-appen',
  foetex: 'Salling Group-appen',
  bilka: 'Salling Group-appen',
  rema1000: 'REMA 1000-appen',
};

/* ------------------------------------------------------------------ */
/* Tjek                                                               */
/* ------------------------------------------------------------------ */

export interface CheckInput {
  id?: number | null;
  createdAt?: Date | string | null;
  storeId: string | null;
  purchasedAt: string | null;
  total: number | null;
  lines: ReceiptLine[];
  source: ParsedReceipt['source'];
  warnings?: string[];
}

export async function checkReceipt(db: Db, input: CheckInput): Promise<ReceiptCheckDTO> {
  const at = input.purchasedAt ? new Date(input.purchasedAt) : new Date();
  const all = await loadOffers(db, at);
  const own = input.storeId ? all.filter((o) => o.row.store_id === input.storeId) : [];
  // Andre kæder sammenlignes kun med tilbud der gjaldt på købstidspunktet.
  const others = all.filter((o) => o.row.store_id !== input.storeId && o.validAtPurchase);

  const groups = groupReceiptLines(input.lines);
  const picked = new Map<number, OfferRow>();
  const drafts = groups.map(({ item, discounts }, index) => {
    const discount = r2(-discounts.reduce((s, d) => s + d.amount, 0));
    const paid = r2(item.amount - discount);
    const line: Line = {
      item,
      toks: toks(item.name),
      organic: ORGANIC_RE.test(item.name),
      size: parseQuantity(item.name),
      isWeight: item.unit === 'kg',
      paidPerUnit: item.quantity > 0 ? paid / item.quantity : paid,
    };
    const appDiscount = discounts.some((d) => /plus|app|medlem/i.test(d.name));
    const match = own.length ? best(line, own) : null;
    const draft = judge(line, match, { discount, paid, appDiscount, storeId: input.storeId });
    if (draft.offerRow) picked.set(draft.offerRow.id, draft.offerRow);
    if (draft.similarRow) picked.set(draft.similarRow.id, draft.similarRow);

    const elsewhere = cheaperElsewhere(line, paid, match?.level !== 'similar' ? match : null, others);
    if (elsewhere) picked.set(elsewhere.row.id, elsewhere.row);
    return { index, item, line, discount, paid, draft, elsewhere, uncertain: Boolean(item.uncertain || discounts.some((d) => d.uncertain)) };
  });

  const dtos = new Map((await toOfferDTOs(db, [...picked.values()])).map((d) => [d.id, d]));
  const items: ReceiptItemCheck[] = drafts.map((d) => ({
    index: d.index,
    name: d.item.name,
    quantity: d.item.quantity,
    unit: d.item.unit,
    normalAmount: r2(d.item.amount),
    discount: d.discount,
    paid: d.paid,
    paidPerUnit: d.item.quantity > 0 ? r2(d.paid / d.item.quantity) : null,
    verdict: d.draft.verdict,
    message: d.draft.message,
    offer: d.draft.offerRow ? (dtos.get(d.draft.offerRow.id) ?? null) : null,
    expectedAmount: d.draft.expectedAmount,
    difference: d.draft.difference,
    saved: d.draft.saved,
    cheaperElsewhere: d.elsewhere ? { offer: dtos.get(d.elsewhere.row.id)!, saving: d.elsewhere.saving } : null,
    similarOffer: d.draft.similarRow ? (dtos.get(d.draft.similarRow.id) ?? null) : null,
    uncertain: d.uncertain,
  }));

  const linesTotal = sumLines(input.lines);
  const deposits = r2(input.lines.filter((l) => l.kind === 'deposit').reduce((s, l) => s + l.amount, 0));
  const overcharged = items.filter((i) => i.verdict === 'overcharged');
  const storeRow = input.storeId ? await storeRef(db, input.storeId) : null;
  return {
    id: input.id ?? null,
    store: storeRow,
    purchasedAt: input.purchasedAt,
    createdAt: input.createdAt ? new Date(input.createdAt).toISOString() : null,
    source: input.source,
    total: input.total ?? linesTotal,
    linesTotal,
    totalMatches: input.total == null ? null : Math.abs(input.total - linesTotal) <= 0.05,
    deposits,
    saved: r2(items.reduce((s, i) => s + i.saved, 0)),
    discountsOnReceipt: r2(-input.lines.filter((l) => l.kind === 'discount').reduce((s, l) => s + l.amount, 0)),
    itemCount: items.length,
    verifiedOffers: items.filter((i) => i.offer && (i.verdict === 'match' || i.verdict === 'cheaper')).length,
    possibleErrors: overcharged.length,
    possibleRefund: r2(overcharged.reduce((s, i) => s + (i.difference ?? 0), 0)),
    toCheck: items.filter((i) => i.verdict === 'check' || i.verdict === 'app_price').length,
    cheaperElsewhereTotal: r2(items.reduce((s, i) => s + (i.cheaperElsewhere?.saving ?? 0), 0)),
    items,
    lines: input.lines,
    warnings: input.warnings ?? [],
  };
}

async function storeRef(db: Db, id: string): Promise<StoreRef | null> {
  const [row] = await query<{ id: string; name: string; color: string; logo_url: string | null }>(
    db,
    sql`SELECT id, name, color, logo_url FROM stores WHERE id = ${id}`,
  );
  return row ? { id: row.id, name: row.name, color: row.color, logoUrl: row.logo_url } : null;
}

interface Judgement {
  verdict: ReceiptVerdict;
  message: string;
  offerRow: OfferRow | null;
  similarRow: OfferRow | null;
  expectedAmount: number | null;
  difference: number | null;
  saved: number;
}

function judge(
  line: Line,
  match: Candidate | null,
  ctx: { discount: number; paid: number; appDiscount: boolean; storeId: string | null },
): Judgement {
  const { item, isWeight } = line;
  const qty = item.quantity > 0 ? item.quantity : 1;
  const per = isWeight ? ' kr/kg' : qty > 1 ? ' kr/stk' : ' kr';
  const none = (message?: string, similar?: OfferRow | null): Judgement => ({
    verdict: 'no_offer',
    message:
      message ?? (ctx.discount > 0 ? `Rabat på kvitteringen: ${kr(ctx.discount)} kr – ikke med i avisen.` : 'Ikke på tilbud i avisen.'),
    offerRow: null,
    similarRow: similar ?? null,
    expectedAmount: null,
    difference: null,
    saved: ctx.discount,
  });

  if (!match || match.expectedPer == null) return none();

  if (match.level === 'similar') {
    // Samme vare i en anden størrelse: vis den kun, hvis den gjaldt og var billigere pr. kg/l/stk.
    const base = paidBaseUnit(line);
    const row = match.offer.row;
    const cheaper =
      match.offer.validAtPurchase && base && row.unit === base.unit && row.unit_price != null && row.unit_price < base.price * 0.95;
    return none(undefined, cheaper ? row : null);
  }

  const row = match.offer.row;
  const expectedPer = match.expectedPer;
  const normalPer = item.amount / qty;
  const max = match.offer.maxPerCustomer;
  const expectedLow = r2(expectedPer * qty);
  // Maks. X pr. kunde: resten må gerne koste normalpris.
  const expectedHigh = !isWeight && max && qty > max ? r2(expectedPer * max + normalPer * (qty - max)) : expectedLow;
  const tol = Math.max(0.1, expectedLow * 0.01);
  const savedFromOffer =
    !isWeight && row.original_price && row.original_price > expectedPer ? r2((row.original_price - ctx.paid / qty) * qty) : 0;
  // Avisens førpris tæller kun med, når vi er sikre på at det er samme vare.
  const saved = match.level === 'sure' ? Math.max(ctx.discount, savedFromOffer, 0) : ctx.discount;
  const base = { offerRow: row, similarRow: null, saved };

  // Et tilbud fra nabodagen, eller et usikkert navnematch, må kun bekræfte prisen.
  const confirmOnly = !match.offer.validAtPurchase;
  const withinHigh = ctx.paid <= expectedHigh + tol;
  if (confirmOnly && !(ctx.paid >= expectedLow - tol && withinHigh)) return none();
  if (ctx.paid < expectedLow - tol) {
    // "Billigere end avisen" kun ved sikker vare og en rimelig forskel – ellers er det nok en anden vare.
    if (match.level !== 'sure' || ctx.paid < expectedLow * 0.6) return none();
    return {
      ...base,
      verdict: 'cheaper',
      message: `Du betalte ${kr(expectedLow - ctx.paid)} kr mindre end avisprisen på ${kr(expectedPer)}${per}.`,
      expectedAmount: expectedLow,
      difference: r2(ctx.paid - expectedLow),
    };
  }
  if (ctx.paid <= expectedHigh + tol) {
    return {
      ...base,
      verdict: 'match',
      message: confirmOnly
        ? `Avispris ${kr(expectedPer)}${per} – stemmer. Butikken gav prisen ${match.offer.early ? 'før avisen officielt gjaldt' : 'efter at avisen var udløbet'}.`
        : `Avispris ${kr(expectedPer)}${per} – stemmer.`,
      expectedAmount: r2(Math.max(expectedLow, Math.min(ctx.paid, expectedHigh))),
      difference: 0,
    };
  }

  const diff = r2(ctx.paid - expectedHigh);
  if (match.offer.requiresApp && !ctx.appDiscount) {
    const app = APP_NAME[ctx.storeId ?? ''] ?? 'kædens app';
    return {
      ...base,
      verdict: 'app_price',
      message: `Avisprisen ${kr(expectedPer)}${per} kræver ${app}. Du betalte normalprisen – ${kr(diff)} kr mere.`,
      expectedAmount: expectedHigh,
      difference: diff,
    };
  }
  if (match.level === 'sure') {
    return {
      ...base,
      verdict: 'overcharged',
      message: `Avisen siger ${kr(expectedPer)}${per}, men du betalte ${kr(ctx.paid / qty)}${per}. Det er ${kr(diff)} kr for meget.`,
      expectedAmount: expectedHigh,
      difference: diff,
    };
  }
  // Usikkert match: små forskelle skyldes oftest at det ikke er samme vare.
  if (diff >= 1 && diff >= expectedHigh * 0.03) {
    return {
      ...base,
      verdict: 'check',
      message: `Avisen har "${row.title}" til ${kr(expectedPer)}${per}. Du betalte ${kr(ctx.paid / qty)}${per} – tjek om det er samme vare.`,
      expectedAmount: expectedHigh,
      difference: diff,
    };
  }
  return none();
}

/** Samme vare billigere i en anden kæde samme dag (kun sikre match). */
function cheaperElsewhere(
  line: Line,
  paid: number,
  own: Candidate | null,
  others: PreparedOffer[],
): { row: OfferRow; saving: number } | null {
  const base = paidBaseUnit(line);
  const ownRow = own?.offer.row;
  let top: { row: OfferRow; saving: number } | null = null;
  for (const offer of others) {
    const row = offer.row;
    const sameProduct = ownRow?.product_id != null && row.product_id === ownRow.product_id;
    const c = evaluate(line, offer);
    if (!sameProduct && c?.level !== 'sure') continue;
    if (sameProduct && !c) continue;
    if (offer.requiresApp) continue; // app-priser er ikke en fair sammenligning
    let cost: number | null = null;
    if (line.isWeight) {
      if (row.unit === 'kg' && row.unit_price) cost = row.unit_price * line.item.quantity;
    } else if (base && row.unit === base.unit && row.unit_price) {
      cost = row.unit_price * base.amount;
    } else if (sameProduct || (ownRow && ownRow.quantity_min === row.quantity_min && ownRow.unit === row.unit)) {
      cost = row.offer_price * line.item.quantity;
    }
    if (cost == null) continue;
    const saving = r2(paid - cost);
    if (saving >= 1 && saving >= paid * 0.05 && (!top || saving > top.saving)) top = { row, saving };
  }
  return top;
}
