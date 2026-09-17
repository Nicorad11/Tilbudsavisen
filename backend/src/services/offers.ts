import type {
  BaseUnit,
  CommunityReportDTO,
  Facet,
  OfferDetailResponse,
  OfferDTO,
  PriceHistoryResponse,
  ProductDTO,
  SearchResponse,
  SearchSort,
  StoreDTO,
} from '@tilbudsradar/shared';
import { categoryLabel, discountPct, FOOD_CATEGORIES } from '@tilbudsradar/shared';
import { sql, type SQL } from 'drizzle-orm';
import { query, queryOne, searchConfig, type Db } from '../db/client';
import { haversineSql, type GeoPoint } from './geo';
import { activeChainSql } from './scope';
import { loadCommunity, loadTrust } from './trust';

/* ------------------------------------------------------------------ */
/* Rækker → DTO                                                       */
/* ------------------------------------------------------------------ */

export interface OfferRow {
  id: number;
  product_id: number | null;
  store_id: string;
  store_name: string;
  store_color: string;
  store_logo: string | null;
  title: string;
  description: string | null;
  normalized_name: string;
  brand: string | null;
  category: string;
  offer_price: number;
  original_price: number | null;
  unit: string;
  quantity_min: number | null;
  quantity_max: number | null;
  unit_price: number | null;
  unit_price_max: number | null;
  valid_from: Date;
  valid_to: Date;
  image_url: string | null;
  source_url: string;
  first_seen_at: Date;
  distance_km?: number | null;
  rank?: number | null;
  /** 1 = hele ord i titel/navn, 2 = delstrenge (sammensatte ord), 3 = kun stavefejl/beskrivelse. */
  tier?: number | null;
}

export const OFFER_SELECT = sql`o.id, o.product_id, o.store_id, s.name AS store_name, s.color AS store_color,
  s.logo_url AS store_logo, o.title, o.description, o.normalized_name, o.brand, o.category, o.offer_price,
  o.original_price, o.unit, o.quantity_min, o.quantity_max, o.unit_price, o.unit_price_max, o.valid_from,
  o.valid_to, o.image_url, o.source_url, o.first_seen_at`;

/** Aktive tilbud + kommende (næste uges avis). */
export const ACTIVE_OR_UPCOMING = sql`o.valid_to > now() AND o.valid_from <= now() + interval '8 days'`;

const toDate = (v: Date | string) => (v instanceof Date ? v : new Date(v));

/** Beriger rækker med troværdighed og community-score (2 batch-queries). */
export async function toOfferDTOs(db: Db, rows: OfferRow[]): Promise<OfferDTO[]> {
  if (!rows.length) return [];
  const [trust, community] = await Promise.all([
    loadTrust(
      db,
      rows.map((r) => ({
        id: r.id,
        productId: r.product_id,
        storeId: r.store_id,
        storeName: r.store_name,
        unitPrice: r.unit_price,
        offerPrice: r.offer_price,
        originalPrice: r.original_price,
      })),
    ),
    loadCommunity(
      db,
      rows.map((r) => r.id),
    ),
  ]);
  return rows.map((r) => ({
    id: r.id,
    productId: r.product_id,
    store: { id: r.store_id, name: r.store_name, color: r.store_color, logoUrl: r.store_logo },
    title: r.title,
    description: r.description,
    normalizedName: r.normalized_name,
    category: r.category,
    offerPrice: r.offer_price,
    originalPrice: r.original_price,
    unit: r.unit as BaseUnit,
    quantityMin: r.quantity_min,
    quantityMax: r.quantity_max,
    unitPrice: r.unit_price,
    unitPriceMax: r.unit_price_max,
    validFrom: toDate(r.valid_from).toISOString(),
    validTo: toDate(r.valid_to).toISOString(),
    imageUrl: r.image_url,
    sourceUrl: r.source_url,
    discountPct: discountPct(r.offer_price, r.original_price),
    trust: trust.get(r.id)!,
    community: community.get(r.id) ?? { real: 0, misleading: 0, score: null },
    distanceKm: r.distance_km == null ? null : Math.round(r.distance_km * 10) / 10,
  }));
}

/* ------------------------------------------------------------------ */
/* Søgning                                                            */
/* ------------------------------------------------------------------ */

export interface SearchParams {
  q: string;
  stores?: string[];
  categories?: string[];
  sort: SearchSort;
  point?: GeoPoint | null;
  radiusKm?: number;
  zip?: string | null;
  onlyReal?: boolean;
  onlyActive?: boolean;
  foodOnly?: boolean;
  limit: number;
  offset: number;
}

export function tokenize(q: string): string[] {
  return [
    ...new Set(
      q
        .toLocaleLowerCase('da-DK')
        .split(/[^\p{L}\p{N}]+/u)
        .filter((t) => t.length >= 2),
    ),
  ].slice(0, 8);
}

/** Regex der kræver alle ord som hele ord (Postgres' \m og \M er ordgrænser). */
export function wholeWord(tokens: string[]): string {
  return tokens.map((t) => String.raw`(?=.*\m${t}\M)`).join('') + '.*';
}

export interface TextMatch {
  /** WHERE-betingelse: rækken matcher overhovedet. */
  match: SQL;
  /** Relevansscore til sortering inden for et niveau. */
  rank: SQL;
  /** Matchniveau 1-3 (lavere er bedre). */
  tier: SQL;
}

/**
 * Korte ord hvis endelse også findes i helt andre ord: "pålæg", "tillæg" og
 * "anlæg" ender på "æg" men er ikke æg. Værdien er et negativt lookbehind.
 */
const FALSE_FRIEND_PREFIX: Record<string, string> = {
  æg: '(?<!l)',
  is: '(?<!r)',
};

/**
 * Fælles tekstmatching for søgning og indkøbslister. Beskrivelser vægtes lavt
 * (ts_rank-vægte {D,C,B,A}), så "æg og rejer" i en julefrokost-beskrivelse
 * ikke slår varer der hedder "æg".
 */
export async function textMatchSql(db: Db, q: string): Promise<TextMatch | null> {
  const tokens = tokenize(q);
  if (!tokens.length) return null;
  const cfg = sql.raw(`'${await searchConfig(db)}'`);
  const query = sql`to_tsquery(${cfg}::regconfig, ${tokens.map((t) => `${t}:*`).join(' & ')})`;
  const text = q.toLowerCase();
  const haystack = sql`(lower(o.title) || ' ' || lower(coalesce(o.brand, '')) || ' ' || o.normalized_name)`;
  // Lange ord må stå inde i sammensatte ord ("kyllingebryst"). Korte ord ("æg")
  // skal afslutte et ord ("skrabeæg"), ellers rammer de "pålægsslagteren".
  const long = tokens.filter((t) => t.length > 3);
  const short = tokens.filter((t) => t.length <= 3);
  const longMatch = long.length
    ? sql`${haystack} LIKE ALL (ARRAY[${sql.join(long.map((t) => sql`${`%${t}%`}`), sql`, `)}]::text[])`
    : sql`TRUE`;
  const shortMatch = short.length
    ? sql`${haystack} ~ ${short.map((t) => String.raw`(?=.*${FALSE_FRIEND_PREFIX[t] ?? ''}${t}\M)`).join('') + '.*'}`
    : sql`TRUE`;
  const likeAll = sql`(${longMatch} AND ${shortMatch})`;
  const whole = sql`${haystack} ~ ${wholeWord(tokens)}`;
  // Stavefejls-tolerance: løs for ét ord, stram for flere (ellers matcher "hakket oksekød" en suppe).
  const fuzzy = tokens.length === 1 ? 0.55 : 0.75;
  return {
    match: sql`(o.search_vector @@ ${query} OR ${likeAll} OR word_similarity(${text}, o.normalized_name) >= ${fuzzy}::float8)`,
    rank: sql`(ts_rank('{0.02, 0.02, 0.4, 1.0}', o.search_vector, ${query}) * 2
      + word_similarity(${text}, lower(o.title))
      + CASE WHEN lower(o.title) LIKE ${`${tokens[0]}%`} THEN 0.3 ELSE 0 END)::float8`,
    tier: sql`(CASE WHEN ${whole} THEN 1 WHEN ${likeAll} THEN 2 ELSE 3 END)`,
  };
}

const inList = (values: string[]) => sql.join(values.map((v) => sql`${v}`), sql`, `);

/** Tekst- og geo-betingelser der deles af resultat- og facet-queries. */
async function baseConditions(db: Db, p: SearchParams): Promise<{ where: SQL; rank: SQL; tier: SQL; distance: SQL }> {
  const conds: SQL[] = [sql`s.enabled`, p.onlyActive ? sql`o.valid_to > now() AND o.valid_from <= now()` : ACTIVE_OR_UPCOMING];
  const text = await textMatchSql(db, p.q);
  if (text) conds.push(text.match);
  const rank: SQL = text?.rank ?? sql`0::float8`;
  const tier: SQL = text?.tier ?? sql`1`;
  if (p.foodOnly) conds.push(sql`o.category IN (${inList(FOOD_CATEGORIES)})`);

  let distance: SQL = sql`NULL::float8`;
  if (p.point) {
    const radius = p.radiusKm ?? 10;
    const d = haversineSql('l', p.point);
    distance = sql`(SELECT min(${d}) FROM store_locations l WHERE l.store_id = o.store_id)`;
    // Kæder hvor vi (endnu) ikke kender butikkerne udelukkes ikke.
    conds.push(sql`(
      NOT EXISTS (SELECT 1 FROM store_locations l0 WHERE l0.store_id = o.store_id)
      OR EXISTS (SELECT 1 FROM store_locations l WHERE l.store_id = o.store_id AND ${d} <= ${radius}::float8)
    )`);
  }
  return { where: sql.join(conds, sql` AND `), rank, tier, distance };
}

export async function searchOffers(db: Db, p: SearchParams): Promise<SearchResponse> {
  const { where, rank, tier, distance } = await baseConditions(db, p);
  const filters: SQL[] = [];
  if (p.stores?.length) filters.push(sql`o.store_id IN (${inList(p.stores)})`);
  if (p.categories?.length) filters.push(sql`o.category IN (${inList(p.categories)})`);
  const filterSql = filters.length ? sql` AND ${sql.join(filters, sql` AND `)}` : sql``;

  const [rows, facetRows] = await Promise.all([
    query<OfferRow>(
      db,
      sql`SELECT ${OFFER_SELECT}, ${distance} AS distance_km, ${rank} AS rank, ${tier} AS tier
          FROM offers o JOIN stores s ON s.id = o.store_id
          WHERE ${where}${filterSql}
          ORDER BY tier ASC, rank DESC, o.unit_price ASC NULLS LAST
          LIMIT 1500`,
    ),
    query<{ store_id: string; store_name: string; category: string; n: number }>(
      db,
      sql`SELECT o.store_id, s.name AS store_name, o.category, count(*)::int AS n
          FROM offers o JOIN stores s ON s.id = o.store_id
          WHERE ${where}
          GROUP BY o.store_id, s.name, o.category`,
    ),
  ]);

  const storeFacet = new Map<string, Facet>();
  const catFacet = new Map<string, Facet>();
  for (const f of facetRows) {
    const s = storeFacet.get(f.store_id) ?? { id: f.store_id, label: f.store_name, count: 0 };
    s.count += f.n;
    storeFacet.set(f.store_id, s);
    const c = catFacet.get(f.category) ?? { id: f.category, label: categoryLabel(f.category), count: 0 };
    c.count += f.n;
    catFacet.set(f.category, c);
  }

  // Sortering sker i JS, så pris pr. enhed kan grupperes efter den dominerende enhed.
  const needsTrust = p.sort === 'discount' || p.onlyReal;
  let items: OfferDTO[] | null = needsTrust ? await toOfferDTOs(db, rows) : null;
  if (items && p.onlyReal) items = items.filter((o) => o.trust.level === 'real' || o.trust.level === 'ok');

  const unitCounts = new Map<string, number>();
  for (const r of rows) if ((r.tier ?? 1) <= 2) unitCounts.set(r.unit, (unitCounts.get(r.unit) ?? 0) + 1);
  const dominant = [...unitCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const exactOf = new Map(rows.map((r) => [r.id, r.tier ?? 1]));
  // Bedste matchniveau først, derefter den dominerende enhed, derefter pris.
  const byUnit = (r: OfferRow) => [exactOf.get(r.id)!, r.unit === dominant ? 0 : 1, r.unit_price ?? Number.POSITIVE_INFINITY];
  const cmp = (a: (number | string)[], b: (number | string)[]) => {
    for (let i = 0; i < a.length; i++) {
      if (a[i]! < b[i]!) return -1;
      if (a[i]! > b[i]!) return 1;
    }
    return 0;
  };

  let total: number;
  let page: OfferDTO[];
  if (items) {
    const saving = (o: OfferDTO) => Math.max(o.discountPct ?? -100, o.trust.savingsPct ?? -100);
    items.sort(
      (a, b) =>
        exactOf.get(a.id)! - exactOf.get(b.id)! || saving(b) - saving(a) || (a.unitPrice ?? 1e9) - (b.unitPrice ?? 1e9),
    );
    total = items.length;
    page = items.slice(p.offset, p.offset + p.limit);
  } else {
    const sorted = [...rows];
    if (p.sort === 'unit') sorted.sort((a, b) => cmp(byUnit(a), byUnit(b)));
    else if (p.sort === 'price') sorted.sort((a, b) => exactOf.get(a.id)! - exactOf.get(b.id)! || a.offer_price - b.offer_price);
    else sorted.sort((a, b) => (b.rank ?? 0) - (a.rank ?? 0));
    total = sorted.length;
    page = await toOfferDTOs(db, sorted.slice(p.offset, p.offset + p.limit));
  }

  return {
    query: p.q,
    total,
    items: page,
    facets: {
      stores: [...storeFacet.values()].sort((a, b) => b.count - a.count),
      categories: [...catFacet.values()].sort((a, b) => b.count - a.count),
    },
    location: p.point ? { lat: p.point.lat, lng: p.point.lng, radiusKm: p.radiusKm ?? 10, zip: p.zip ?? null } : null,
  };
}

/* ------------------------------------------------------------------ */
/* Enkelt tilbud, alternativer og community                           */
/* ------------------------------------------------------------------ */

export async function getOfferRow(db: Db, id: number): Promise<OfferRow | undefined> {
  return queryOne<OfferRow>(
    db,
    sql`SELECT ${OFFER_SELECT} FROM offers o JOIN stores s ON s.id = o.store_id WHERE o.id = ${id}`,
  );
}

export async function getOfferDetail(db: Db, id: number, userId: string | null): Promise<OfferDetailResponse | null> {
  const row = await getOfferRow(db, id);
  if (!row) return null;

  // Samme kanoniske vare – eller tilsvarende navn i samme enhed – i andre kæder.
  const alternatives = await query<OfferRow>(
    db,
    sql`SELECT ${OFFER_SELECT}
        FROM offers o JOIN stores s ON s.id = o.store_id
        WHERE s.enabled AND ${ACTIVE_OR_UPCOMING} AND o.id <> ${id} AND o.unit = ${row.unit}
          AND (
            (${row.product_id}::int IS NOT NULL AND o.product_id = ${row.product_id}::int)
            OR similarity(o.normalized_name, ${row.normalized_name}) >= 0.45
          )
        ORDER BY (o.product_id IS NOT DISTINCT FROM ${row.product_id}::int) DESC, o.unit_price ASC NULLS LAST
        LIMIT 8`,
  );

  const reports = await query<{
    id: number;
    verdict: string;
    comment: string | null;
    created_at: Date;
    user_id: string;
    up: number;
    down: number;
    my_vote: number | null;
  }>(
    db,
    sql`SELECT r.id, r.verdict, r.comment, r.created_at, r.user_id,
          count(*) FILTER (WHERE v.value > 0)::int AS up,
          count(*) FILTER (WHERE v.value < 0)::int AS down,
          max(CASE WHEN v.user_id = ${userId}::uuid THEN v.value END)::int AS my_vote
        FROM community_reports r
        LEFT JOIN community_votes v ON v.report_id = r.id
        WHERE r.offer_id = ${id}
        GROUP BY r.id
        ORDER BY (count(*) FILTER (WHERE v.value > 0) - count(*) FILTER (WHERE v.value < 0)) DESC, r.created_at DESC
        LIMIT 50`,
  );

  const [offer, ...alts] = await toOfferDTOs(db, [row, ...alternatives]);
  return {
    offer: offer!,
    alternatives: alts,
    reports: reports.map(
      (r): CommunityReportDTO => ({
        id: r.id,
        verdict: r.verdict === 'real' ? 'real' : 'misleading',
        comment: r.comment,
        createdAt: toDate(r.created_at).toISOString(),
        upvotes: r.up,
        downvotes: r.down,
        myVote: (r.my_vote ?? 0) > 0 ? 1 : (r.my_vote ?? 0) < 0 ? -1 : 0,
        isMine: r.user_id === userId,
        author: r.user_id === userId ? 'Dig' : `Bruger ${r.user_id.slice(0, 4)}`,
      }),
    ),
  };
}

/* ------------------------------------------------------------------ */
/* Prishistorik                                                       */
/* ------------------------------------------------------------------ */

export async function getPriceHistory(db: Db, productId: number, days: number): Promise<PriceHistoryResponse | null> {
  const product = await queryOne<{ id: number; name: string; normalized_name: string; category: string; unit: string }>(
    db,
    sql`SELECT id, name, normalized_name, category, unit FROM products WHERE id = ${productId}`,
  );
  if (!product) return null;
  const points = await query<{
    date: string;
    store_id: string;
    price: number;
    unit_price: number | null;
    is_offer: boolean;
    synthetic: boolean;
  }>(
    db,
    sql`SELECT observed_on::text AS date, store_id, price, unit_price, is_offer, synthetic
        FROM price_history
        WHERE product_id = ${productId} AND observed_on >= current_date - ${days}::int
        ORDER BY observed_on, store_id`,
  );
  const storeIds = [...new Set(points.map((p) => p.store_id))];
  const stores = storeIds.length
    ? await query<{ id: string; name: string; color: string; logo_url: string | null }>(
        db,
        sql`SELECT id, name, color, logo_url FROM stores WHERE id IN (${inList(storeIds)}) ORDER BY name`,
      )
    : [];

  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const recent = points.filter((p) => p.date >= cutoff && p.unit_price !== null);
  const regular = recent.filter((p) => !p.is_offer);
  const basis = regular.length ? regular : recent;
  const unitPrices = points.map((p) => p.unit_price).filter((v): v is number => v !== null);
  const round = (n: number) => Math.round(n * 100) / 100;

  const dto: ProductDTO = {
    id: product.id,
    name: product.name,
    normalizedName: product.normalized_name,
    category: product.category,
    unit: product.unit as BaseUnit,
  };
  return {
    product: dto,
    points: points.map((p) => ({
      date: p.date,
      storeId: p.store_id,
      price: p.price,
      unitPrice: p.unit_price,
      isOffer: p.is_offer,
      synthetic: p.synthetic,
    })),
    stores: stores.map((s) => ({ id: s.id, name: s.name, color: s.color, logoUrl: s.logo_url })),
    avgUnitPrice90d: basis.length ? round(basis.reduce((s, p) => s + p.unit_price!, 0) / basis.length) : null,
    minUnitPrice: unitPrices.length ? round(Math.min(...unitPrices)) : null,
    maxUnitPrice: unitPrices.length ? round(Math.max(...unitPrices)) : null,
    hasSynthetic: points.some((p) => p.synthetic),
  };
}

/* ------------------------------------------------------------------ */
/* Butikker, kategorier, varer                                        */
/* ------------------------------------------------------------------ */

export async function listStores(db: Db): Promise<StoreDTO[]> {
  const rows = await query<{
    id: string;
    name: string;
    color: string;
    logo_url: string | null;
    category: string;
    website: string | null;
    enabled: boolean;
    offer_count: number;
    location_count: number;
  }>(
    db,
    sql`SELECT s.*,
          (SELECT count(*)::int FROM offers o WHERE o.store_id = s.id AND ${ACTIVE_OR_UPCOMING}) AS offer_count,
          (SELECT count(*)::int FROM store_locations l WHERE l.store_id = s.id) AS location_count
        FROM stores s WHERE ${activeChainSql} ORDER BY s.category, s.name`,
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    color: r.color,
    logoUrl: r.logo_url,
    category: r.category,
    website: r.website,
    enabled: r.enabled,
    offerCount: r.offer_count,
    locationCount: r.location_count,
  }));
}

export async function searchProducts(db: Db, q: string, limit = 8): Promise<(ProductDTO & { activeOffers: number })[]> {
  const term = q.trim().toLowerCase();
  if (term.length < 2) return [];
  const rows = await query<{ id: number; name: string; normalized_name: string; category: string; unit: string; active: number }>(
    db,
    sql`SELECT p.id, p.name, p.normalized_name, p.category, p.unit,
          (SELECT count(*)::int FROM offers o WHERE o.product_id = p.id AND ${ACTIVE_OR_UPCOMING}) AS active
        FROM products p
        WHERE p.normalized_name LIKE ${`%${term}%`} OR word_similarity(${term}, p.normalized_name) >= 0.5
        ORDER BY active DESC, similarity(p.normalized_name, ${term}) DESC
        LIMIT ${limit}`,
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    normalizedName: r.normalized_name,
    category: r.category,
    unit: r.unit as BaseUnit,
    activeOffers: r.active,
  }));
}

/* ------------------------------------------------------------------ */
/* "Ugens bedste tilbud" – caches til næste ingest                    */
/* ------------------------------------------------------------------ */

let dataVersion = 0;
const cache = new Map<string, { version: number; at: number; value: unknown }>();

export function bumpDataVersion(): void {
  dataVersion++;
}

export async function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && hit.version === dataVersion && Date.now() - hit.at < ttlMs) return hit.value as T;
  const value = await load();
  cache.set(key, { version: dataVersion, at: Date.now(), value });
  return value;
}

export async function topDeals(db: Db, limit: number, storeIds?: string[]): Promise<OfferDTO[]> {
  const key = `top:${limit}:${storeIds?.join(',') ?? ''}`;
  return cached(key, 10 * 60 * 1000, async () => {
    const rows = await query<OfferRow>(
      db,
      sql`SELECT ${OFFER_SELECT}
          FROM offers o JOIN stores s ON s.id = o.store_id
          WHERE s.enabled AND o.valid_to > now() AND o.valid_from <= now()
            AND o.category IN (${inList(FOOD_CATEGORIES)})
            ${storeIds?.length ? sql`AND o.store_id IN (${inList(storeIds)})` : sql``}
          LIMIT 4000`,
    );
    const dtos = await toOfferDTOs(db, rows);
    const score = (o: OfferDTO) =>
      (o.trust.level === 'real' ? 100 : o.trust.level === 'ok' ? 40 : o.trust.level === 'inflated' ? -100 : 0) +
      Math.max(o.trust.savingsPct ?? 0, o.discountPct ?? 0);
    return dtos
      .filter((o) => o.trust.level !== 'inflated' && (o.trust.savingsPct ?? o.discountPct ?? 0) > 0)
      .sort((a, b) => score(b) - score(a))
      .slice(0, limit);
  });
}
