import type { CommunityScore, TrustInfo } from '@tilbudsradar/shared';
import { discountPct } from '@tilbudsradar/shared';
import { sql } from 'drizzle-orm';
import { query, type Db } from '../db/client';

interface HistoryAgg {
  product_id: number;
  store_id: string;
  is_offer: boolean;
  /** Observeret for mere end 7 dage siden, dvs. i en tidligere kampagne. */
  old: boolean;
  avg: number;
  n: number;
}

export interface TrustInput {
  id: number;
  productId: number | null;
  storeId: string;
  storeName: string;
  unitPrice: number | null;
  offerPrice: number;
  originalPrice: number | null;
}

const pct = (n: number) => `${Math.round(n)}%`;
const kr = (n: number) => n.toFixed(2).replace('.', ',');

function combine(rows: HistoryAgg[]): { avg: number; n: number } | null {
  const n = rows.reduce((s, r) => s + r.n, 0);
  if (!n) return null;
  return { avg: rows.reduce((s, r) => s + r.avg * r.n, 0) / n, n };
}

/**
 * "Er dette et reelt tilbud?"
 *
 * Tilbudsprisen (kr/enhed) sammenlignes med gennemsnittet de sidste 90 dage:
 *   1. normalprisen i samme kæde (bedst)
 *   2. normalpriser i alle kæder
 *   3. tidligere tilbudspriser (svagt grundlag – kan aldrig give "reelt")
 * Reklamerer kæden med en stor rabat, som ikke kan genfindes i historikken,
 * markeres tilbuddet som en mulig kunstigt opskrevet førpris.
 */
export function assessTrust(offer: TrustInput, history: HistoryAgg[]): TrustInfo {
  const claimed = discountPct(offer.offerPrice, offer.originalPrice);
  const base: Omit<TrustInfo, 'level' | 'label' | 'explanation'> = {
    avgUnitPrice90d: null,
    savingsPct: null,
    claimedSavingsPct: claimed,
    samples: 0,
  };
  if (offer.productId === null || offer.unitPrice === null) {
    return { ...base, level: 'unknown', label: 'Ukendt', explanation: 'Varen kunne ikke kobles til prishistorik endnu.' };
  }

  const sameStore = combine(history.filter((h) => !h.is_offer && h.store_id === offer.storeId));
  const allStores = combine(history.filter((h) => !h.is_offer));
  const previousOffers = combine(history.filter((h) => h.is_offer && h.old));

  let basis: { avg: number; n: number } | null = null;
  let basisLabel = '';
  let weak = false;
  if (sameStore && sameStore.n >= 2) {
    basis = sameStore;
    basisLabel = `normalprisen i ${offer.storeName}`;
  } else if (allStores && allStores.n >= 2) {
    basis = allStores;
    basisLabel = 'normalpriser på tværs af kæder';
  } else if (previousOffers && previousOffers.n >= 3) {
    basis = previousOffers;
    basisLabel = 'tidligere tilbudspriser';
    weak = true;
  }

  if (!basis) {
    return {
      ...base,
      level: 'unknown',
      label: 'For lidt historik',
      explanation: claimed
        ? `Kæden angiver ${pct(claimed)} rabat, men vi har endnu ikke nok prisdata til at bekræfte det.`
        : 'Vi har endnu ikke nok prisdata til at vurdere tilbuddet.',
    };
  }

  const savings = Math.round(((basis.avg - offer.unitPrice) / basis.avg) * 1000) / 10;
  const info = { ...base, avgUnitPrice90d: Math.round(basis.avg * 100) / 100, savingsPct: savings, samples: basis.n };
  const vs = `${kr(offer.unitPrice)} kr mod gns. ${kr(basis.avg)} kr (${basisLabel}, 90 dage)`;

  if (claimed !== null && claimed >= 15 && savings < 3) {
    return {
      ...info,
      level: 'inflated',
      label: 'Opskrevet førpris?',
      explanation: `Kæden reklamerer med ${pct(claimed)} rabat, men prisen er kun ${pct(Math.max(0, savings))} under ${basisLabel}. ${vs}.`,
    };
  }
  if (weak) {
    if (savings >= 5) return { ...info, level: 'ok', label: 'Lavere end før', explanation: `Billigere end ${basisLabel}: ${vs}.` };
    if (savings <= -10) return { ...info, level: 'inflated', label: 'Dyrere end før', explanation: `Dyrere end ${basisLabel}: ${vs}.` };
    return { ...info, level: 'unknown', label: 'Som tidligere', explanation: `Samme niveau som ${basisLabel}: ${vs}.` };
  }
  if (savings >= 10) {
    return { ...info, level: 'real', label: 'Reelt tilbud', explanation: `${pct(savings)} under ${basisLabel}: ${vs}.` };
  }
  if (savings >= 3) {
    return { ...info, level: 'ok', label: 'Lille besparelse', explanation: `${pct(savings)} under ${basisLabel}: ${vs}.` };
  }
  return {
    ...info,
    level: 'inflated',
    label: 'Ikke billigere',
    explanation: `Prisen svarer til – eller overstiger – ${basisLabel}: ${vs}.`,
  };
}

export async function loadTrust(db: Db, offers: TrustInput[]): Promise<Map<number, TrustInfo>> {
  const productIds = [...new Set(offers.map((o) => o.productId).filter((id): id is number => id !== null))];
  const byProduct = new Map<number, HistoryAgg[]>();
  if (productIds.length) {
    const rows = await query<HistoryAgg>(
      db,
      sql`SELECT product_id, store_id, is_offer, (observed_on < current_date - 7) AS old,
            avg(unit_price)::float8 AS avg, count(*)::int AS n
          FROM price_history
          WHERE product_id IN (${sql.join(productIds.map((id) => sql`${id}`), sql`, `)})
            AND observed_on >= current_date - 90
            AND unit_price IS NOT NULL
          GROUP BY product_id, store_id, is_offer, old`,
    );
    for (const r of rows) {
      const list = byProduct.get(r.product_id) ?? [];
      list.push(r);
      byProduct.set(r.product_id, list);
    }
  }
  return new Map(offers.map((o) => [o.id, assessTrust(o, o.productId ? (byProduct.get(o.productId) ?? []) : [])]));
}

export async function loadCommunity(db: Db, offerIds: number[]): Promise<Map<number, CommunityScore>> {
  const map = new Map<number, CommunityScore>();
  if (!offerIds.length) return map;
  const rows = await query<{ offer_id: number; verdict: string; n: number }>(
    db,
    sql`SELECT offer_id, verdict, count(*)::int AS n
        FROM community_reports
        WHERE offer_id IN (${sql.join(offerIds.map((id) => sql`${id}`), sql`, `)})
        GROUP BY offer_id, verdict`,
  );
  for (const r of rows) {
    const cur = map.get(r.offer_id) ?? { real: 0, misleading: 0, score: null };
    if (r.verdict === 'real') cur.real += r.n;
    else cur.misleading += r.n;
    map.set(r.offer_id, cur);
  }
  for (const v of map.values()) {
    const total = v.real + v.misleading;
    v.score = total ? Math.round((v.real / total) * 100) : null;
  }
  return map;
}
