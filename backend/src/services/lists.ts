import type { ListOptimizationDTO, OfferDTO, ShoppingListDTO, StorePlan } from '@tilbudsradar/shared';
import { sql } from 'drizzle-orm';
import { query, queryOne, type Db } from '../db/client';
import { OFFER_SELECT, textMatchSql, toOfferDTOs, type OfferRow } from './offers';

interface ItemRow {
  id: number;
  text: string;
  product_id: number | null;
  quantity: number;
  checked: boolean;
}

type Candidate = OfferRow & { relevance: number };

/**
 * Kandidat-tilbud for én listevare. Er varen koblet til en kanonisk vare,
 * bruges den; ellers fritekstsøgning, hvor kun det bedste matchniveau går videre.
 */
async function candidatesFor(db: Db, item: ItemRow, storeIds: string[] | null): Promise<Candidate[]> {
  const storeFilter = storeIds?.length ? sql`AND o.store_id IN (${sql.join(storeIds.map((s) => sql`${s}`), sql`, `)})` : sql``;
  const base = sql`FROM offers o JOIN stores s ON s.id = o.store_id
    WHERE s.enabled AND o.valid_to > now() AND o.valid_from <= now() ${storeFilter}`;

  if (item.product_id) {
    const rows = await query<Candidate>(
      db,
      sql`SELECT ${OFFER_SELECT}, 1::float8 AS relevance ${base} AND o.product_id = ${item.product_id} ORDER BY o.unit_price ASC NULLS LAST LIMIT 40`,
    );
    if (rows.length) return rows;
  }

  const text = await textMatchSql(db, item.text);
  if (!text) return [];
  const rows = await query<Candidate & { tier: number }>(
    db,
    sql`SELECT ${OFFER_SELECT}, ${text.rank} AS relevance, ${text.tier} AS tier
        ${base} AND ${text.match}
        ORDER BY tier ASC, relevance DESC
        LIMIT 120`,
  );
  // Kun det bedste matchniveau: hele ord > sammensatte ord > stavefejl/beskrivelse.
  const bestTier = rows[0]?.tier;
  const tierRows = rows.filter((r) => r.tier === bestTier);
  if (bestTier !== 3) return tierRows;
  const top = tierRows[0]?.relevance ?? 0;
  return tierRows.filter((r) => r.relevance >= top * 0.8);
}

/**
 * Sammenligner to kandidater som et menneske ville: pris pr. enhed når begge har
 * den (fx kr/kg), ellers pakkepris. Kun kandidater i varens dominerende enhed
 * tæller, så "mælk" i liter ikke sammenlignes med chokolade i stk.
 */
function bestCandidates(cands: Candidate[]): Candidate[] {
  const counts = new Map<string, number>();
  for (const c of cands) counts.set(c.unit, (counts.get(c.unit) ?? 0) + 1);
  const unit = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  return cands.filter((c) => c.unit === unit);
}

const cheaper = (a: Candidate, b: Candidate) =>
  a.unit_price != null && b.unit_price != null ? a.unit_price < b.unit_price : a.offer_price < b.offer_price;

/** Billigste relevante tilbud pr. kæde. */
function cheapestPerStore(cands: Candidate[]): Map<string, Candidate> {
  const map = new Map<string, Candidate>();
  for (const c of bestCandidates(cands)) {
    const cur = map.get(c.store_id);
    if (!cur || cheaper(c, cur)) map.set(c.store_id, c);
  }
  return map;
}

async function loadItems(db: Db, listId: number): Promise<ItemRow[]> {
  return query<ItemRow>(
    db,
    sql`SELECT id, text, product_id, quantity, checked FROM shopping_list_items WHERE list_id = ${listId} ORDER BY checked, created_at, id`,
  );
}

export async function getListDetail(db: Db, listId: number, storeIds: string[] | null): Promise<ShoppingListDTO | null> {
  const list = await queryOne<{ id: number; name: string; created_at: Date; updated_at: Date }>(
    db,
    sql`SELECT id, name, created_at, updated_at FROM shopping_lists WHERE id = ${listId}`,
  );
  if (!list) return null;
  const items = await loadItems(db, listId);
  const best = new Map<number, OfferRow>();
  for (const item of items) {
    const cands = bestCandidates(await candidatesFor(db, item, storeIds));
    const cheapest = cands.reduce<Candidate | null>((acc, c) => (!acc || cheaper(c, acc) ? c : acc), null);
    if (cheapest) best.set(item.id, cheapest);
  }
  const dtos = await toOfferDTOs(db, [...new Map([...best.values()].map((r) => [r.id, r])).values()]);
  const byId = new Map(dtos.map((d) => [d.id, d]));
  return {
    id: list.id,
    name: list.name,
    createdAt: new Date(list.created_at).toISOString(),
    updatedAt: new Date(list.updated_at).toISOString(),
    items: items.map((i) => ({
      id: i.id,
      text: i.text,
      productId: i.product_id,
      quantity: i.quantity,
      checked: i.checked,
      bestOffer: best.has(i.id) ? (byId.get(best.get(i.id)!.id) ?? null) : null,
    })),
  };
}

function combinations<T>(items: T[], k: number): T[][] {
  if (k === 0) return [[]];
  if (items.length < k) return [];
  const [first, ...rest] = items;
  return [...combinations(rest, k - 1).map((c) => [first!, ...c]), ...combinations(rest, k)];
}

/**
 * Butiks-splitting: hvilken kombination af op til `maxStores` kæder giver den
 * billigste samlede tur? Antallet af kæder er lille (<10), så alle
 * kombinationer afprøves (højst ~C(10,3) = 120).
 */
export function planStores(
  prices: Map<number, Map<string, number>>,
  stores: string[],
  maxStores: number,
): { single: StorePlan[]; bestSingle: StorePlan | null; bestSplit: StorePlan | null; savings: number | null } {
  const itemIds = [...prices.keys()];
  const evaluate = (subset: string[]): StorePlan => {
    const perStore = new Map<string, { itemIds: number[]; subtotal: number }>(subset.map((s) => [s, { itemIds: [], subtotal: 0 }]));
    const missing: number[] = [];
    let total = 0;
    for (const id of itemIds) {
      let bestStore: string | null = null;
      let bestPrice = Number.POSITIVE_INFINITY;
      for (const s of subset) {
        const p = prices.get(id)?.get(s);
        if (p !== undefined && p < bestPrice) {
          bestPrice = p;
          bestStore = s;
        }
      }
      if (bestStore === null) {
        missing.push(id);
        continue;
      }
      total += bestPrice;
      const entry = perStore.get(bestStore)!;
      entry.itemIds.push(id);
      entry.subtotal += bestPrice;
    }
    const round = (n: number) => Math.round(n * 100) / 100;
    return {
      storeIds: subset,
      total: round(total),
      covered: itemIds.length - missing.length,
      missing,
      perStore: [...perStore.entries()]
        .filter(([, v]) => v.itemIds.length)
        .map(([storeId, v]) => ({ storeId, itemIds: v.itemIds, subtotal: round(v.subtotal) })),
    };
  };
  const better = (a: StorePlan, b: StorePlan | null) =>
    !b || a.covered > b.covered || (a.covered === b.covered && a.total < b.total - 0.001);

  const single = stores.map((s) => evaluate([s])).sort((a, b) => b.covered - a.covered || a.total - b.total);
  const bestSingle = single[0] ?? null;

  let bestSplit: StorePlan | null = null;
  for (let k = 2; k <= Math.min(maxStores, stores.length); k++) {
    for (const subset of combinations(stores, k)) {
      const plan = evaluate(subset);
      // En ekstra butik skal give mindst 1 vare mere eller en reel besparelse.
      if (plan.perStore.length < k) continue;
      if (better(plan, bestSplit)) bestSplit = plan;
    }
  }
  if (bestSplit && bestSingle && !better(bestSplit, bestSingle)) bestSplit = null;

  let savings: number | null = null;
  const split: StorePlan | null = bestSplit;
  if (split && bestSingle) {
    const covered = itemIds.filter((id) => !bestSingle.missing.includes(id));
    const splitCost = covered.reduce((sum, id) => {
      const costs = split.storeIds.map((s) => prices.get(id)?.get(s)).filter((v): v is number => v !== undefined);
      return sum + (costs.length ? Math.min(...costs) : 0);
    }, 0);
    savings = Math.round((bestSingle.total - splitCost) * 100) / 100;
  }
  return { single, bestSingle, bestSplit: split, savings };
}

export async function optimizeList(
  db: Db,
  listId: number,
  opts: { storeIds: string[] | null; maxStores: number },
): Promise<ListOptimizationDTO & { offers: Record<number, Record<string, OfferDTO>> }> {
  const items = (await loadItems(db, listId)).filter((i) => !i.checked);
  const prices = new Map<number, Map<string, number>>();
  const chosen = new Map<number, Map<string, Candidate>>();
  const storeSet = new Set<string>();
  for (const item of items) {
    const perStore = cheapestPerStore(await candidatesFor(db, item, opts.storeIds));
    chosen.set(item.id, perStore);
    prices.set(item.id, new Map([...perStore.entries()].map(([s, c]) => [s, c.offer_price * item.quantity])));
    for (const s of perStore.keys()) storeSet.add(s);
  }
  const plan = planStores(prices, [...storeSet], opts.maxStores);

  const rows = [...new Map([...chosen.values()].flatMap((m) => [...m.values()]).map((r) => [r.id, r])).values()];
  const dtos = new Map((await toOfferDTOs(db, rows)).map((d) => [d.id, d]));
  const offers: Record<number, Record<string, OfferDTO>> = {};
  for (const [itemId, perStore] of chosen) {
    offers[itemId] = Object.fromEntries([...perStore.entries()].map(([s, c]) => [s, dtos.get(c.id)!]));
  }

  return {
    itemCount: items.length,
    bestSingle: plan.bestSingle,
    bestSplit: plan.bestSplit,
    savings: plan.savings,
    singleStores: plan.single,
    maxStores: opts.maxStores,
    offers,
  };
}
