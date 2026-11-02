import type { BaseUnit, SeoTerm } from '@tilbudsradar/shared';
import { SEO_TERMS } from '@tilbudsradar/shared';
import { sql } from 'drizzle-orm';
import { query, type Db } from '../../db/client';
import { cached } from '../cache';
import { OFFER_SELECT, tokenize, type OfferRow } from '../offers';
import { activeChainSql } from '../scope';

/**
 * Hvilke tilbud hører til hvilken vare på /tilbud/{vare}?
 *
 * Alle tilbud fra de sidste 90 dage (og næste uges aviser) hentes én gang pr.
 * data-version og matches i hukommelsen mod varelisten (shared/src/seoTerms.ts):
 * hvert ord i et søgeord skal stå som et helt ord i titel, mærke eller navn.
 * Søgningens varetype-indeks bruges bevidst ikke her – det matcher også
 * forstavelser ("ost" → "tørkost", "bacon" → "baconleverpostej"), hvilket er
 * fint mens man søger, men giver forkerte sider. Kun tilbud i varens
 * kategorier tæller, og `exclude`-ord sorterer fra.
 */

export const WINDOW_DAYS = 90;

/** Bogstaver der kan stå inde i et dansk ord – resten er ordgrænser. */
const LETTER = 'a-z0-9æøåäöüéèáàíóúñ';
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Matcher, når alle ord i søgeordet står som hele ord ("smør" rammer ikke "smørbar"). */
function wordMatcher(q: string): ((haystack: string) => boolean) | null {
  const tokens = tokenize(q);
  if (!tokens.length) return null;
  const patterns = tokens.map((t) => new RegExp(`(?<![${LETTER}])${escapeRegExp(t)}(?![${LETTER}])`, 'u'));
  return (haystack) => patterns.every((p) => p.test(haystack));
}

let textMatchers: { term: SeoTerm; matchers: ((haystack: string) => boolean)[] }[] | null = null;

/**
 * Varen på listen, som en tekst – fx et søgeord fra Google – handler om. Samme
 * regel som på varesiderne: hvert ord i et af varens søgeord står som et helt ord.
 */
export function termForText(text: string): SeoTerm | null {
  textMatchers ??= SEO_TERMS.map((term) => ({ term, matchers: term.queries.map(wordMatcher).filter((m) => m !== null) }));
  const haystack = text.toLocaleLowerCase('da-DK');
  return textMatchers.find((t) => t.matchers.some((m) => m(haystack)))?.term ?? null;
}

const haystackOf = (r: OfferRow) => `${r.title} ${r.brand ?? ''} ${r.normalized_name}`.toLocaleLowerCase('da-DK');
const time = (v: Date | string) => (v instanceof Date ? v : new Date(v)).getTime();

export interface TermSummary {
  term: SeoTerm;
  /** Alle matchende tilbud i perioden (inkl. næste uges). */
  rows: OfferRow[];
  /** Gælder nu. */
  active: OfferRow[];
  /** Gælder først fra en senere dag (næste uges avis). */
  upcoming: OfferRow[];
  /** Tilbud der har gældt inden for de sidste 90 dage (ikke de kommende). */
  past: OfferRow[];
  /** Mest brugte enhed – siden sammenligner pris pr. denne enhed. */
  unit: BaseUnit | null;
  /** Laveste pris pr. enhed blandt de aktuelle tilbud (aktive før kommende). */
  cheapest: OfferRow | null;
  /** Med i søgemaskinerne: ≥3 aktuelle tilbud eller ≥6 i de sidste 90 dage. */
  indexable: boolean;
  /** Seneste dag varen var på tilbud (også før de 90 dage). null = aldrig (eller kun kommende tilbud). */
  lastOfferAt: Date | null;
  /** Varen har været eller kommer på tilbud – ellers svarer siden 404. */
  hasData: boolean;
}

export const isIndexable = (current: number, past90: number) => current >= 3 || past90 >= 6;

function mostCommon<T>(values: T[]): T | null {
  const counts = new Map<T, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

/**
 * Laveste pris pr. enhed. Tilbud, hvor varen står først i titlen, foretrækkes:
 * i "Hakket okse/grisekød, ribbenssteg eller nakkefilet" kan kiloprisen gælde
 * en af de andre varer.
 */
export function cheapestOf(rows: OfferRow[], unit: BaseUnit | null, term?: SeoTerm): OfferRow | null {
  const priced = rows.filter((r) => r.unit === unit && r.unit_price != null).sort((a, b) => a.unit_price! - b.unit_price!);
  if (!term) return priced[0] ?? null;
  const matchers = term.queries.map(wordMatcher).filter((m) => m !== null);
  const leading = priced.find((r) => matchers.some((m) => m(firstSegment(r.title))));
  return leading ?? priced[0] ?? null;
}

/** "Hakket okse/ grisekød, ribbenssteg eller nakkefilet" → "hakket okse/ grisekød" */
const firstSegment = (title: string) => title.split(/,| eller /i)[0]!.toLocaleLowerCase('da-DK');

async function windowOffers(db: Db): Promise<OfferRow[]> {
  return query<OfferRow>(
    db,
    sql`SELECT ${OFFER_SELECT} FROM offers o JOIN stores s ON s.id = o.store_id
        WHERE s.enabled AND ${activeChainSql}
          AND o.valid_to > now() - make_interval(days => ${WINDOW_DAYS})
          AND o.valid_from <= now() + interval '8 days'`,
  );
}

/** Tilbudene for én vare blandt de givne rækker. */
export function matchTerm(term: SeoTerm, rows: OfferRow[]): OfferRow[] {
  const categories = new Set<string>(term.categories);
  const exclude = (term.exclude ?? []).map((e) => e.toLocaleLowerCase('da-DK'));
  const matchers = term.queries.map(wordMatcher).filter((m) => m !== null);
  return rows.filter((r) => {
    if (!categories.has(r.category)) return false;
    const title = r.title.toLocaleLowerCase('da-DK');
    if (exclude.some((e) => title.includes(e))) return false;
    const haystack = haystackOf(r);
    return matchers.some((m) => m(haystack));
  });
}

/** Seneste gang en vare var på tilbud før perioden – kun for varer uden tilbud i perioden. */
async function lastOfferBefore(db: Db, term: SeoTerm): Promise<Date | null> {
  const old = await query<OfferRow>(
    db,
    sql`SELECT ${OFFER_SELECT} FROM offers o JOIN stores s ON s.id = o.store_id
        WHERE ${activeChainSql} AND o.category IN (${sql.join(term.categories.map((c) => sql`${c}`), sql`, `)})
          AND o.valid_to <= now() - make_interval(days => ${WINDOW_DAYS})
        ORDER BY o.valid_to DESC LIMIT 2000`,
  );
  const matched = matchTerm(term, old);
  return matched[0] ? new Date(time(matched[0].valid_to)) : null;
}

async function buildIndex(db: Db): Promise<Map<string, TermSummary>> {
  const rows = await windowOffers(db);
  const now = Date.now();
  const index = new Map<string, TermSummary>();
  for (const term of SEO_TERMS) {
    const matched = matchTerm(term, rows);
    const active = matched.filter((r) => time(r.valid_from) <= now && time(r.valid_to) > now);
    const upcoming = matched.filter((r) => time(r.valid_from) > now);
    // Alle tilbud, der har gældt i perioden (også dem, der startede før og stadig gælder).
    const past = matched.filter((r) => time(r.valid_from) <= now);
    const current = [...active, ...upcoming];
    const unit = mostCommon((current.length ? current : matched).map((r) => r.unit as BaseUnit));
    // Senest på tilbud: i dag, hvis et tilbud gælder nu – ellers slutdatoen for det seneste.
    const started = matched.filter((r) => time(r.valid_from) <= now);
    const lastOfferAt = started.length
      ? new Date(Math.min(now, Math.max(...started.map((r) => time(r.valid_to)))))
      : await lastOfferBefore(db, term);
    index.set(term.slug, {
      term,
      rows: matched,
      active,
      upcoming,
      past,
      unit,
      cheapest: cheapestOf(active, unit, term) ?? cheapestOf(upcoming, unit, term),
      indexable: isIndexable(current.length, past.length),
      lastOfferAt,
      hasData: matched.length > 0 || lastOfferAt !== null,
    });
  }
  return index;
}

/** Vareindekset for alle varer på listen – beregnes én gang pr. data-version (nye tilbud). */
export function termIndex(db: Db): Promise<Map<string, TermSummary>> {
  return cached('seo:term-index', 6 * 60 * 60 * 1000, () => buildIndex(db));
}

/**
 * Den mest præcise vare på listen, et tilbud hører under – til linket "Se alle
 * tilbud på …" i appen. Færrest tilbud vinder ("Kyllingebryst" frem for "Kylling").
 * null, når tilbuddet ikke matcher en vare (eller er ældre end 90 dage).
 */
export async function termForOffer(db: Db, offerId: number): Promise<SeoTerm | null> {
  const byOffer = await cached('seo:offer-terms', 6 * 60 * 60 * 1000, async () => {
    const best = new Map<number, TermSummary>();
    for (const s of (await termIndex(db)).values()) {
      for (const r of s.rows) {
        const prev = best.get(r.id);
        if (!prev || s.rows.length < prev.rows.length) best.set(r.id, s);
      }
    }
    return new Map([...best].map(([id, s]) => [id, s.term]));
  });
  return byOffer.get(offerId) ?? null;
}
