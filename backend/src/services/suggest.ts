import type { BaseUnit, SearchSuggestionDTO } from '@tilbudsradar/shared';
import { sql } from 'drizzle-orm';
import { query, type Db } from '../db/client';
import { cached } from './cache';
import { conceptKey, conceptWords, extractConcepts, matchConcept, queryTokens, typoMatch } from './concepts';

/**
 * Varetype-indeks over aktive og kommende tilbud. Bygges i hukommelsen og
 * genbruges, til nye tilbud er gemt (~1.000 tilbud tager få millisekunder).
 */

interface OfferLite {
  id: number;
  store: string;
  unit: BaseUnit;
  unitPrice: number | null;
  category: string;
}

interface Concept {
  label: string;
  words: string[];
  offers: OfferLite[];
  stores: Set<string>;
  category: string;
}

interface Row {
  id: number;
  title: string;
  category: string;
  store_id: string;
  unit: string;
  unit_price: number | null;
}

function mostCommon<T>(values: T[], tieBreak: (a: T, b: T) => number = () => 0): T {
  const counts = new Map<T, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || tieBreak(a[0], b[0]))[0]![0];
}

async function buildIndex(db: Db): Promise<Concept[]> {
  const rows = await query<Row>(
    db,
    sql`SELECT o.id, o.title, o.category, o.store_id, o.unit, o.unit_price
        FROM offers o JOIN stores s ON s.id = o.store_id
        WHERE s.enabled AND o.valid_to > now() AND o.valid_from <= now() + interval '8 days'`,
  );

  const groups = new Map<string, { forms: string[]; offers: Map<number, OfferLite> }>();
  for (const r of rows) {
    const offer: OfferLite = { id: r.id, store: r.store_id, unit: r.unit as BaseUnit, unitPrice: r.unit_price, category: r.category };
    for (const concept of extractConcepts(r.title)) {
      const key = conceptKey(concept);
      const g = groups.get(key) ?? { forms: [], offers: new Map<number, OfferLite>() };
      g.forms.push(concept);
      g.offers.set(r.id, offer);
      groups.set(key, g);
    }
  }

  return [...groups.values()].map((g) => {
    // Den hyppigste stavemåde vises ("bananer" frem for "banan", hvis kæderne skriver det sådan).
    const label = mostCommon(g.forms, (a, b) => a.length - b.length);
    const offers = [...g.offers.values()];
    return {
      label,
      words: conceptWords(label),
      offers,
      stores: new Set(offers.map((o) => o.store)),
      category: mostCommon(offers.map((o) => o.category)),
    };
  });
}

function conceptIndex(db: Db): Promise<Concept[]> {
  return cached('concept-index', 10 * 60 * 1000, () => buildIndex(db));
}

/** Tilbud i de varetyper en søgning rammer præcist. Korte ord skal være hele ord. */
function matchingOffers(concepts: Concept[], q: string): Map<number, OfferLite> {
  const tokens = queryTokens(q);
  const offers = new Map<number, OfferLite>();
  if (!tokens.length) return offers;
  for (const c of concepts) {
    if (matchConcept(c.words, tokens) > 0) for (const o of c.offers) offers.set(o.id, o);
  }
  return offers;
}

/**
 * Tilbud hvis varetype matcher søgningen – så "hakket grisekød" også finder
 * "Hakket okse- eller grise/kalvekød", og "svin" finder grisekød.
 */
export async function conceptOfferIds(db: Db, q: string): Promise<number[]> {
  return [...matchingOffers(await conceptIndex(db), q).keys()].slice(0, 2000);
}

/** Søgeforslag mens man skriver: "okse" → "Hakket oksekød" (12 tilbud i 4 kæder fra 61,76 kr/kg). */
export async function suggestConcepts(db: Db, q: string, limit = 7): Promise<SearchSuggestionDTO[]> {
  const tokens = queryTokens(q);
  if (tokens.join('').length < 2) return [];
  const text = tokens.join(' ');
  const all = await conceptIndex(db);
  // Blandede kampagner ("Luksus julefrokost") er ikke varetyper man søger efter.
  const candidates = all.filter((c) => c.category !== 'andet');

  let scored = candidates
    .map((c) => ({ c, s: matchConcept(c.words, tokens, { typing: true }) }))
    .filter((x) => x.s > 0);
  if (!scored.length) scored = candidates.map((c) => ({ c, s: typoMatch(c.words, tokens) })).filter((x) => x.s > 0);

  // Rangering efter selve varetypen: udbredt i flere kæder, starter med det skrevne, kort navn.
  const byScore = (a: { score: number; c: Concept }, b: { score: number; c: Concept }) =>
    b.score - a.score || a.c.label.localeCompare(b.c.label, 'da');
  const ranked = scored
    .map(({ c, s }) => ({
      c,
      score:
        s * 2 +
        1.2 * Math.log2(1 + c.offers.length) +
        0.8 * c.stores.size +
        (c.label.startsWith(text) ? 1 : 0) -
        0.25 * c.words.length,
    }))
    .sort(byScore)
    .slice(0, 20)
    // Tallene viser hvad et klik giver: alle tilbud i varetyper som forslaget matcher.
    // Det tæller også lidt med, så "oksekød" (14 tilbud i alt) står over en enkelt kebab.
    .map(({ c, score }) => {
      const offers = [...matchingOffers(all, c.label).values()];
      return { c, offers, score: score + 0.6 * Math.log2(1 + offers.length) };
    })
    .sort(byScore)
    .slice(0, limit);

  return ranked.map(({ c, offers }) => {
    const unit = mostCommon(c.offers.map((o) => o.unit));
    const prices = offers.filter((o) => o.unit === unit && o.unitPrice != null).map((o) => o.unitPrice!);
    return {
      term: c.label,
      category: c.category,
      offerCount: offers.length,
      storeCount: new Set(offers.map((o) => o.store)).size,
      fromUnitPrice: prices.length ? Math.min(...prices) : null,
      unit: prices.length ? unit : null,
    };
  });
}
