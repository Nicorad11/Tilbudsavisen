import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { SeoOffer } from '@tilbudsradar/shared';
import { Resvg } from '@resvg/resvg-js';
import satori from 'satori';
import type { Db } from '../../db/client';
import { cached } from '../cache';
import { TRUST_THRESHOLDS } from '../trust';
import { getCategoryPage, getStorePage, getTermPage } from './pages';

/**
 * Delingsbilleder (1200×630) til vare-, kæde- og kategorisider – fx
 * "Smør · billigst 44,22 kr/kg hos Lidl · uge 45". Tegnes med satori og
 * resvg med Inter Tight (sharp er dårlig til tekst uden systemskrifttyper),
 * og caches pr. data-version.
 */

export const OG_KINDS = ['tilbud', 'butik', 'kategori'] as const;
export type OgKind = (typeof OG_KINDS)[number];

const WIDTH = 1200;
const HEIGHT = 630;
const C = { canvas: '#e7e7e5', ink: '#1a1a1a', ink2: '#4f4f4f', muted: '#969694', lime: '#e2f33b', card: '#fbfbfa', track: '#e3e3e1' };

const require = createRequire(import.meta.url);
let fontCache: { name: string; data: Buffer; weight: 400 | 700; style: 'normal' }[] | null = null;
function fonts() {
  fontCache ??= ([400, 700] as const).map((weight) => ({
    name: 'Inter Tight',
    data: readFileSync(require.resolve(`@fontsource/inter-tight/files/inter-tight-latin-${weight}-normal.woff`)),
    weight,
    style: 'normal' as const,
  }));
  return fontCache;
}

/* Et lille element-træ i satoris format (svarer til JSX uden React). */
type Child = El | string;
interface El {
  type: string;
  props: { style: Record<string, unknown>; children?: Child | Child[] };
}
const el = (style: Record<string, unknown>, ...children: Child[]): El => ({
  type: 'div',
  props: { style: { display: 'flex', ...style }, children: children.length === 1 ? children[0] : children },
});

const krFmt = new Intl.NumberFormat('da-DK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const kr = (n: number) => krFmt.format(n);
const cut = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);

function logo(): El {
  return el(
    { alignItems: 'center', gap: 16 },
    el({ width: 56, height: 56, borderRadius: 16, background: C.ink, alignItems: 'center', justifyContent: 'center' }, el({ width: 22, height: 22, borderRadius: 11, background: C.lime })),
    el({ fontSize: 38, fontWeight: 700, color: C.ink, letterSpacing: -1 }, 'tilbudsradar'),
  );
}

interface Row {
  color: string;
  label: string;
  value: string;
  /** 0–1 – bjælkens længde. */
  share?: number;
  highlight?: boolean;
}

/* Mål: 1200 − 2×64 margen = 1072 = venstre spalte 520 + mellemrum 48 + kort 504. */
const MARGIN = 64;
const LEFT = 520;
const CARD = 504;
const CARD_PAD = 32;

/** Tekst på én linje, afkortet med … – også hvis skriften fylder mere end forventet. */
const oneLine = (style: Record<string, unknown>, text: string, max: number) =>
  el({ ...style, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }, cut(text, max));

function card(title: string, rows: Row[]): El {
  const inner = CARD - 2 * CARD_PAD;
  return el(
    {
      flexDirection: 'column',
      flexShrink: 0,
      width: CARD,
      boxSizing: 'border-box',
      padding: CARD_PAD,
      borderRadius: 36,
      background: C.card,
      gap: 18,
      boxShadow: '0 30px 60px -30px rgba(0,0,0,0.35)',
    },
    el({ fontSize: 22, color: C.muted }, title),
    ...rows.map((r) => {
      // prik 12 + 3 mellemrum à 14 + værdi 104 = 158; resten deles mellem tekst og bjælke.
      const label = r.share == null ? inner - 158 : 132;
      return el(
        { alignItems: 'center', gap: 14, width: inner },
        el({ width: 12, height: 12, borderRadius: 6, background: r.color, flexShrink: 0 }),
        oneLine({ width: label, flexShrink: 0, fontSize: 24, color: C.ink2 }, r.label, r.share == null ? 26 : 12),
        ...(r.share == null
          ? []
          : [
              el(
                { flexGrow: 1, height: 26, borderRadius: 13, background: C.track },
                el({ width: `${Math.max(8, Math.round(r.share * 100))}%`, height: 26, borderRadius: 13, background: r.highlight ? C.lime : '#cfcfcd' }),
              ),
            ]),
        el({ width: 104, flexShrink: 0, justifyContent: 'flex-end', fontSize: 26, fontWeight: r.highlight ? 700 : 400, color: C.ink }, r.value),
      );
    }),
  );
}

function layout(o: { kicker: string; title: string; highlight: string; detail: string; side: El | null }): El {
  return el(
    { width: WIDTH, height: HEIGHT, boxSizing: 'border-box', background: C.canvas, padding: MARGIN, justifyContent: 'space-between', alignItems: 'center', fontFamily: 'Inter Tight' },
    el(
      { flexDirection: 'column', flexShrink: 0, gap: 22, width: o.side ? LEFT : WIDTH - 2 * MARGIN },
      logo(),
      el({ fontSize: 30, color: C.ink2, marginTop: 18 }, o.kicker),
      el({ fontSize: o.title.length > 22 ? 62 : 76, fontWeight: 700, color: C.ink, letterSpacing: -2.5, lineHeight: 1.02 }, o.title),
      el({ alignSelf: 'flex-start', fontSize: 40, fontWeight: 700, color: C.ink, background: C.lime, padding: '6px 16px', borderRadius: 12 }, o.highlight),
      el({ fontSize: 28, color: C.ink2, lineHeight: 1.25 }, o.detail),
    ),
    ...(o.side ? [o.side] : []),
  );
}

/** Billigste pris pr. enhed pr. kæde (samme enhed som sidens billigste). */
function perStore(offers: SeoOffer[]): Row[] {
  const unit = offers.find((o) => o.unitPrice != null)?.unit;
  const best = new Map<string, SeoOffer>();
  for (const o of offers) {
    if (o.unit !== unit || o.unitPrice == null) continue;
    const prev = best.get(o.store.id);
    if (!prev || o.unitPrice < prev.unitPrice!) best.set(o.store.id, o);
  }
  const list = [...best.values()].sort((a, b) => a.unitPrice! - b.unitPrice!).slice(0, 5);
  const max = Math.max(...list.map((o) => o.unitPrice!));
  return list.map((o, i) => ({ color: o.store.color, label: o.store.name, value: kr(o.unitPrice!), share: o.unitPrice! / max, highlight: i === 0 }));
}

/** De fem største besparelser – samme vare i flere størrelser vises kun én gang. */
function dealRows(offers: SeoOffer[]): Row[] {
  const seen = new Set<string>();
  return offers
    .filter((o) => {
      const key = o.title.trim().toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 5)
    .map((o) => ({ color: o.store.color, label: o.title, value: o.trust.savingsPct != null ? `−${Math.round(o.trust.savingsPct)} %` : kr(o.offerPrice) }));
}

async function tree(db: Db, kind: OgKind, slug: string): Promise<El | null> {
  if (kind === 'tilbud') {
    const p = await getTermPage(db, slug);
    if (!p) return null;
    const cheapest = p.offers.find((o) => o.unitPrice != null && o.unit === p.unit);
    const unit = p.unit === 'l' ? 'l' : p.unit === 'stk' ? 'stk.' : 'kg';
    const rows = perStore(p.offers);
    return layout({
      kicker: `Uge ${p.week} · ${p.offers.length} tilbud`,
      title: `${p.label} på tilbud`,
      highlight: cheapest ? `Billigst ${kr(cheapest.unitPrice!)} kr/${unit}` : `Ikke på tilbud i uge ${p.week}`,
      detail: cheapest ? `hos ${cheapest.store.name}` : 'Få besked, når prisen falder',
      side: rows.length >= 2 ? card(`kr/${unit} · billigste pr. kæde`, rows) : null,
    });
  }
  if (kind === 'butik') {
    const p = await getStorePage(db, slug);
    if (!p) return null;
    return layout({
      kicker: `Uge ${p.week}`,
      title: `${p.store.name} tilbud`,
      highlight: `${p.store.offerCount} tilbud · ${p.trustCounts.real} reelle`,
      detail: `Reel = mindst ${TRUST_THRESHOLDS.realPct} % under varens egen gennemsnitspris`,
      side: p.best.length ? card('Største reelle besparelser', dealRows(p.best)) : null,
    });
  }
  const p = await getCategoryPage(db, slug);
  if (!p) return null;
  return layout({
    kicker: `Uge ${p.week}`,
    title: `${p.label} på tilbud`,
    highlight: p.trustCounts.real ? `${p.trustCounts.real} reelle tilbud` : `${p.stores.reduce((n, st) => n + st.count, 0)} tilbud`,
    detail: `fra ${p.stores.map((s) => s.name).join(', ')}`,
    side: p.best.length ? card('Største reelle besparelser', dealRows(p.best)) : null,
  });
}

/** PNG til /og/{kind}/{slug}.png – null, hvis siden ikke findes. */
export function renderOgImage(db: Db, kind: OgKind, slug: string): Promise<Buffer | null> {
  return cached(`og:${kind}:${slug}`, 6 * 60 * 60 * 1000, async () => {
    const t = await tree(db, kind, slug);
    if (!t) return null;
    const svg = await satori(t as unknown as Parameters<typeof satori>[0], { width: WIDTH, height: HEIGHT, fonts: fonts() });
    return new Resvg(svg).render().asPng();
  });
}
