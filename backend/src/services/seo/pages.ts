import type {
  BaseUnit,
  CategoryPageDTO,
  MethodPageDTO,
  OfferDTO,
  SeoFaq,
  SeoLink,
  SeoMeta,
  SeoOffer,
  StorePageDTO,
  StoresHubDTO,
  StoreSummary,
  TermHubDTO,
  TermPageDTO,
  TrustCounts,
  WeeklyBestDTO,
} from '@tilbudsradar/shared';
import { isoWeek, SEO_CATEGORIES, SEO_STORES, SEO_TERMS, seoCategoryBySlug, seoCategoryById, seoStoreById, seoStoreBySlug, seoTermBySlug } from '@tilbudsradar/shared';
import { sql } from 'drizzle-orm';
import { query, queryOne, type Db } from '../../db/client';
import { cached } from '../cache';
import { OFFER_SELECT, toOfferDTOs, type OfferRow } from '../offers';
import { activeChainSql } from '../scope';
import { TRUST_THRESHOLDS } from '../trust';
import { termIndex, WINDOW_DAYS, type TermSummary } from './termIndex';

/**
 * Indholdet på datasiderne. Hver sætning bygges af data – ingen fyldtekst.
 * Alt beregnes på serveren og caches pr. data-version (nye tilbud), så den
 * server-renderede side og browserens visning bruger præcis de samme tekster.
 */

const DAY = 86_400_000;
const PAGE_TTL = 30 * 60 * 1000;
const TZ = 'Europe/Copenhagen';

/* ------------------------------------------------------------------ */
/* Tekst                                                              */
/* ------------------------------------------------------------------ */

const krFmt = new Intl.NumberFormat('da-DK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const kr = (n: number) => krFmt.format(n);
const pctText = (n: number) => `${Math.round(n)} %`;
const dayMonth = new Intl.DateTimeFormat('da-DK', { day: 'numeric', month: 'long', timeZone: TZ });
const weekdayDate = new Intl.DateTimeFormat('da-DK', { weekday: 'long', day: 'numeric', month: 'long', timeZone: TZ });

const UNIT_WORD: Record<BaseUnit, string> = { kg: 'kg', l: 'liter', stk: 'stk.' };
const PER_UNIT: Record<BaseUnit, string> = { kg: 'kr/kg', l: 'kr/l', stk: 'kr/stk.' };

const cap = (s: string) => s.charAt(0).toLocaleUpperCase('da-DK') + s.slice(1);

/** "Netto, REMA 1000 og Lidl" */
export function listText(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} og ${items.at(-1)}`;
}

/** Den første titel, der kan være der (titler holdes under ca. 60 tegn). */
export function fitTitle(candidates: string[], max = 60): string {
  return candidates.find((c) => c.length <= max) ?? candidates.at(-1)!;
}

/** Afkortet ved et ord, så beskrivelser holder sig under 160 tegn. */
export function clip(text: string, max = 160): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  return `${cut.slice(0, cut.lastIndexOf(' '))}…`;
}

/** Kort produktnavn til beskrivelser ("Hakket okse/ grisekød, ribbenssteg eller …" → "Hakket okse/ grisekød"). */
const shortTitle = (title: string) => clip(title.split(/,| eller /)[0]!.trim(), 40);

const time = (v: Date | string) => (v instanceof Date ? v : new Date(v)).getTime();
const iso = (v: Date | string) => new Date(time(v)).toISOString();

/* ------------------------------------------------------------------ */
/* Fælles data                                                        */
/* ------------------------------------------------------------------ */

function toSeoOffer(o: OfferDTO): SeoOffer {
  return {
    id: o.id,
    title: o.title,
    store: o.store,
    offerPrice: o.offerPrice,
    originalPrice: o.originalPrice,
    discountPct: o.discountPct,
    unit: o.unit,
    quantityMin: o.quantityMin,
    quantityMax: o.quantityMax,
    unitPrice: o.unitPrice,
    validFrom: o.validFrom,
    validTo: o.validTo,
    imageUrl: o.imageUrl,
    trust: { level: o.trust.level, label: o.trust.label, savingsPct: o.trust.savingsPct },
  };
}

function trustCounts(offers: { trust: { level: keyof TrustCounts } }[]): TrustCounts {
  const counts: TrustCounts = { real: 0, ok: 0, inflated: 0, unknown: 0 };
  for (const o of offers) counts[o.trust.level]++;
  return counts;
}

/** Størst reel besparelse først (målt mod 90 dages priser), ellers kædens egen rabat. */
const bySavings = (a: OfferDTO, b: OfferDTO) =>
  (b.trust.savingsPct ?? -100) - (a.trust.savingsPct ?? -100) || (b.discountPct ?? 0) - (a.discountPct ?? 0);

/**
 * Besparelser over 75 % er næsten altid en datafejl (fx en anden pakkestørrelse i
 * prishistorikken) – de vises ikke blandt de bedste tilbud.
 */
const PLAUSIBLE_SAVINGS_PCT = 75;
const plausible = (o: OfferDTO) => (o.trust.savingsPct ?? 0) <= PLAUSIBLE_SAVINGS_PCT;
const isGoodDeal = (o: OfferDTO) => (o.trust.level === 'real' || o.trust.level === 'ok') && plausible(o);

interface Context {
  now: Date;
  week: number;
  year: number;
  generatedAt: string;
  updatedAt: string | null;
  /** Første dag med data i 90-dages vinduet. */
  since: Date;
}

/** Seneste hentning og den ældste data – deles af alle sider. */
async function context(db: Db): Promise<Context> {
  const facts = await cached('seo:facts', PAGE_TTL, async () => {
    const run = await queryOne<{ at: Date | null }>(db, sql`SELECT max(finished_at) AS at FROM scrape_runs WHERE status IN ('success', 'partial')`);
    const first = await queryOne<{ at: Date | null }>(db, sql`SELECT min(first_seen_at) AS at FROM offers`);
    return { updatedAt: run?.at ? iso(run.at) : null, firstData: first?.at ? time(first.at) : null };
  });
  const now = new Date();
  const { week, year } = isoWeek(now);
  return {
    now,
    week,
    year,
    generatedAt: now.toISOString(),
    updatedAt: facts.updatedAt,
    since: new Date(Math.max(now.getTime() - WINDOW_DAYS * DAY, facts.firstData ?? 0)),
  };
}

/** "de sidste 90 dage" – eller "siden 20. oktober", når vi har data for en kortere periode. */
const periodText = (ctx: Context) =>
  ctx.since.getTime() > ctx.now.getTime() - (WINDOW_DAYS - 1) * DAY ? `siden ${dayMonth.format(ctx.since)}` : `de sidste ${WINDOW_DAYS} dage`;

/** Alle aktuelle tilbud (gælder nu eller fra næste uges avis) med troværdighed. */
function currentOffers(db: Db): Promise<OfferDTO[]> {
  return cached('seo:current', PAGE_TTL, async () => {
    const rows = await query<OfferRow>(
      db,
      sql`SELECT ${OFFER_SELECT} FROM offers o JOIN stores s ON s.id = o.store_id
          WHERE s.enabled AND ${activeChainSql} AND o.valid_to > now() AND o.valid_from <= now() + interval '8 days'`,
    );
    return toOfferDTOs(db, rows);
  });
}

const isActive = (o: { validFrom: string; validTo: string }, now: Date) => time(o.validFrom) <= now.getTime() && time(o.validTo) > now.getTime();

const crumbs = (...links: SeoLink[]): SeoLink[] => [{ href: '/', label: 'Forside' }, ...links];

function meta(m: { title: string; description: string; path: string; noindex?: boolean }): SeoMeta {
  return { title: m.title, description: clip(m.description), path: m.path, ...(m.noindex ? { noindex: true } : {}) };
}

/* ------------------------------------------------------------------ */
/* /tilbud/{vare}                                                     */
/* ------------------------------------------------------------------ */

function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

function termHistory(s: TermSummary, ctx: Context): TermPageDTO['history'] {
  const priced = s.past.filter((r) => r.unit === s.unit && r.unit_price != null);
  const lowestRow = [...priced].sort((a, b) => a.unit_price! - b.unit_price!)[0];
  const counts = new Map<string, number>();
  for (const r of s.past) counts.set(r.store_name, (counts.get(r.store_name) ?? 0) + 1);
  const latest = [...s.rows].filter((r) => time(r.valid_from) <= ctx.now.getTime()).sort((a, b) => time(b.valid_from) - time(a.valid_from))[0];
  return {
    since: ctx.since.toISOString(),
    offers: s.past.length,
    // Ugen tidligst fra vores første data – et tilbud kan være startet, før vi så det.
    lowest: lowestRow
      ? {
          unitPrice: lowestRow.unit_price!,
          storeName: lowestRow.store_name,
          ...isoWeek(new Date(Math.max(time(lowestRow.valid_from), ctx.since.getTime()))),
        }
      : null,
    medianUnitPrice: priced.length >= 3 ? median(priced.map((r) => r.unit_price!)) : null,
    byStore: [...counts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'da')),
    lastOfferAt: s.lastOfferAt?.toISOString() ?? null,
    lastOffer: latest ? { title: latest.title, storeName: latest.store_name, offerPrice: latest.offer_price, unitPrice: latest.unit_price } : null,
  };
}

function termTitle(label: string, unit: BaseUnit | null, week: number): string {
  const per = unit ? ` – billigste pr. ${UNIT_WORD[unit]}` : '';
  return fitTitle([
    `${label} på tilbud${per} i uge ${week} | Tilbudsradar`,
    `${label} på tilbud${per} i uge ${week}`,
    `${label} på tilbud i uge ${week} | Tilbudsradar`,
    `${label} på tilbud i uge ${week}`,
  ]);
}

export async function getTermPage(db: Db, slug: string): Promise<TermPageDTO | null> {
  const term = seoTermBySlug(slug);
  if (!term) return null;
  return cached(`seo:term:${slug}`, PAGE_TTL, async () => {
    const index = await termIndex(db);
    const s = index.get(slug);
    if (!s?.hasData) return null;
    const ctx = await context(db);
    const unit = s.unit;
    const dtos = await toOfferDTOs(db, [...s.active, ...s.upcoming]);
    const offers = dtos
      .map(toSeoOffer)
      .sort((a, b) => Number(a.unit !== unit) - Number(b.unit !== unit) || (a.unitPrice ?? Infinity) - (b.unitPrice ?? Infinity));
    const storeNames = [...new Set(offers.map((o) => o.store.name))];
    const counts = trustCounts(offers);
    const history = termHistory(s, ctx);
    const cheapest = s.cheapest;
    const phrase = term.phrase;
    const upcoming = s.upcoming.length;

    let summary: string;
    if (offers.length) {
      summary = `Lige nu er der ${offers.length} tilbud på ${phrase} i ${storeNames.length} ${storeNames.length === 1 ? 'kæde' : 'kæder'}.`;
      if (cheapest && unit) summary += ` Billigst pr. ${UNIT_WORD[unit]} er ${cheapest.title} hos ${cheapest.store_name}: ${kr(cheapest.unit_price!)} ${PER_UNIT[unit]}.`;
      if (upcoming) summary += ` ${upcoming === offers.length ? 'De' : `${upcoming} af dem`} gælder først fra næste uges avis.`;
    } else {
      summary = `${cap(phrase)} er ikke på tilbud i uge ${ctx.week}.`;
      if (history.lastOffer && history.lastOfferAt) {
        summary += ` Sidst var det ${history.lastOffer.title} hos ${history.lastOffer.storeName} til ${kr(history.lastOffer.offerPrice)} kr – tilbuddet sluttede ${dayMonth.format(new Date(history.lastOfferAt))}.`;
      }
    }

    const faq: SeoFaq[] = [];
    if (cheapest && unit) {
      const validity = time(cheapest.valid_from) > ctx.now.getTime()
        ? `fra ${weekdayDate.format(new Date(time(cheapest.valid_from)))}`
        : `til og med ${weekdayDate.format(new Date(time(cheapest.valid_to) - 1000))}`;
      faq.push({
        q: `Hvor er ${phrase} billigst i denne uge?`,
        a: `Billigst pr. ${UNIT_WORD[unit]} er ${cheapest.title} hos ${cheapest.store_name} til ${kr(cheapest.offer_price)} kr (${kr(cheapest.unit_price!)} ${PER_UNIT[unit]}), ${validity}. I alt er der ${offers.length} tilbud hos ${listText(storeNames)}.`,
      });
    } else {
      faq.push({
        q: `Hvor er ${phrase} billigst i denne uge?`,
        a: `${cap(phrase)} er ikke på tilbud i uge ${ctx.week}.${history.lastOffer ? ` Seneste tilbud var ${history.lastOffer.title} hos ${history.lastOffer.storeName}.` : ''} Opret en prisalarm, så får du besked, når det kommer på tilbud igen.`,
      });
    }
    if (history.medianUnitPrice != null && history.lowest && unit) {
      faq.push({
        q: `Hvad er en god pris på ${phrase}?`,
        a: `${cap(periodText(ctx))} har den typiske tilbudspris været ${kr(history.medianUnitPrice)} ${PER_UNIT[unit]}. Den laveste var ${kr(history.lowest.unitPrice)} ${PER_UNIT[unit]} hos ${history.lowest.storeName} i uge ${history.lowest.week}. Ligger prisen under ${kr(history.medianUnitPrice)} ${PER_UNIT[unit]}, er det en god pris.`,
      });
    }
    if (history.offers > 0) {
      const top = history.byStore[0];
      faq.push({
        q: `Hvor ofte er ${phrase} på tilbud?`,
        a: `${cap(periodText(ctx))} har vi set ${history.offers} tilbud på ${phrase} hos ${history.byStore.length} ${history.byStore.length === 1 ? 'kæde' : 'kæder'}${top && history.byStore.length > 1 ? ` – oftest hos ${top.name} (${top.count} gange)` : ''}.`,
      });
    }
    if (offers.length) {
      const notCheaper = counts.inflated;
      faq.push({
        q: `Er tilbuddene på ${phrase} reelle?`,
        a:
          `${counts.real} af ${offers.length} tilbud er reelle – mindst ${TRUST_THRESHOLDS.realPct} % under varens gennemsnitspris de sidste ${TRUST_THRESHOLDS.windowDays} dage.` +
          (notCheaper ? ` ${notCheaper} er ikke billigere end normalt eller har en mulig opskrevet førpris.` : '') +
          (counts.unknown ? ` For ${counts.unknown} har vi endnu for lidt prishistorik til at vurdere det.` : ''),
      });
    }

    const category = term.categories[0];
    const related: SeoLink[] = SEO_TERMS.filter((t) => t.slug !== slug && t.categories[0] === category)
      .map((t) => index.get(t.slug)!)
      .filter((r) => r.hasData && r.active.length + r.upcoming.length > 0)
      .sort((a, b) => b.active.length + b.upcoming.length - (a.active.length + a.upcoming.length))
      .slice(0, 8)
      .map((r) => ({
        href: `/tilbud/${r.term.slug}`,
        label: r.term.label,
        ...(r.cheapest && r.unit ? { detail: `fra ${kr(r.cheapest.unit_price!)} ${PER_UNIT[r.unit]}` } : {}),
      }));
    const storeLinks = SEO_STORES.filter((st) => offers.some((o) => o.store.id === st.id)).map((st) => ({ href: `/butik/${st.slug}`, label: st.name }));

    const description = offers.length
      ? `${offers.length} tilbud på ${phrase} fra ${listText(storeNames.slice(0, 3))}${storeNames.length > 3 ? ' m.fl.' : '.'}` +
        (cheapest && unit ? ` Billigst: ${shortTitle(cheapest.title)} ${kr(cheapest.unit_price!)} ${PER_UNIT[unit]} hos ${cheapest.store_name}.` : '') +
        ' Se hvilke tilbud der er reelle.'
      : `${cap(phrase)} er ikke på tilbud i denne uge. Se den laveste pris de sidste ${WINDOW_DAYS} dage, og få besked, når prisen falder.`;

    return {
      kind: 'term',
      slug,
      label: term.label,
      phrase,
      unit,
      indexable: s.indexable,
      summary,
      offers,
      activeCount: s.active.length,
      upcomingCount: upcoming,
      storeNames,
      trustCounts: counts,
      history,
      faq,
      related,
      storeLinks,
      generatedAt: ctx.generatedAt,
      updatedAt: ctx.updatedAt,
      week: ctx.week,
      breadcrumbs: crumbs({ href: '/tilbud', label: 'Tilbud' }, { href: `/tilbud/${slug}`, label: term.label }),
      meta: meta({ title: termTitle(term.label, unit, ctx.week), description, path: `/tilbud/${slug}`, noindex: !s.indexable }),
    } satisfies TermPageDTO;
  });
}

/* ------------------------------------------------------------------ */
/* /tilbud                                                            */
/* ------------------------------------------------------------------ */

export async function getTermHub(db: Db): Promise<TermHubDTO> {
  return cached('seo:term-hub', PAGE_TTL, async () => {
    const [index, ctx] = await Promise.all([termIndex(db), context(db)]);
    const terms = SEO_TERMS.map((t) => index.get(t.slug)!)
      .filter((s) => s.hasData)
      .sort((a, b) => a.term.label.localeCompare(b.term.label, 'da'));
    const groups = new Map<string, TermHubDTO['groups'][number]['terms']>();
    for (const s of terms) {
      const letter = s.term.label.charAt(0).toLocaleUpperCase('da-DK');
      const current = s.active.length + s.upcoming.length;
      const list = groups.get(letter) ?? [];
      list.push({
        href: `/tilbud/${s.term.slug}`,
        label: s.term.label,
        detail: s.cheapest && s.unit ? `fra ${kr(s.cheapest.unit_price!)} ${PER_UNIT[s.unit]}` : 'ikke på tilbud nu',
        indexable: s.indexable,
        offerCount: current,
      });
      groups.set(letter, list);
    }
    return {
      kind: 'termHub',
      groups: [...groups.entries()].map(([letter, list]) => ({ letter, terms: list })),
      termCount: terms.length,
      generatedAt: ctx.generatedAt,
      updatedAt: ctx.updatedAt,
      week: ctx.week,
      breadcrumbs: crumbs({ href: '/tilbud', label: 'Tilbud' }),
      meta: meta({
        title: fitTitle([`Dagligvarer på tilbud A–Å i uge ${ctx.week} | Tilbudsradar`, `Dagligvarer på tilbud A–Å i uge ${ctx.week}`]),
        description: `${terms.length} dagligvarer fra smør til toiletpapir med ugens laveste pris pr. kg, liter eller stk. hos REMA 1000, Netto, føtex, Bilka og Lidl.`,
        path: '/tilbud',
      }),
    } satisfies TermHubDTO;
  });
}

/* ------------------------------------------------------------------ */
/* /butikker og /butik/{kæde}                                         */
/* ------------------------------------------------------------------ */

async function storeSummaries(db: Db, ctx: Context): Promise<StoreSummary[]> {
  const offers = await currentOffers(db);
  const next = await query<{ store_id: string; next: Date | null }>(
    db,
    sql`SELECT o.store_id, min(o.valid_from) AS next FROM offers o WHERE o.valid_from > now() GROUP BY o.store_id`,
  );
  const colors = new Map(offers.map((o) => [o.store.id, o.store.color]));
  return SEO_STORES.map((st) => {
    const mine = offers.filter((o) => o.store.id === st.id);
    const nextAt = next.find((n) => n.store_id === st.id)?.next;
    return {
      slug: st.slug,
      name: st.name,
      color: colors.get(st.id) ?? '#999',
      offerCount: mine.length,
      realCount: mine.filter((o) => isActive(o, ctx.now) && o.trust.level === 'real').length,
      nextCatalogAt: nextAt ? iso(nextAt) : null,
    };
  });
}

export async function getStoresHub(db: Db): Promise<StoresHubDTO> {
  return cached('seo:stores', PAGE_TTL, async () => {
    const ctx = await context(db);
    const stores = await storeSummaries(db, ctx);
    return {
      kind: 'storesHub',
      stores,
      generatedAt: ctx.generatedAt,
      updatedAt: ctx.updatedAt,
      week: ctx.week,
      breadcrumbs: crumbs({ href: '/butikker', label: 'Butikker' }),
      meta: meta({
        title: fitTitle([`Tilbudsaviser uge ${ctx.week}: REMA 1000, Netto, føtex, Bilka og Lidl`, `Tilbudsaviser i uge ${ctx.week} | Tilbudsradar`]),
        description: `Ugens tilbud fra ${listText(stores.map((s) => s.name))} samlet ét sted – med pris pr. kg og vurdering af, om tilbuddene er reelle.`,
        path: '/butikker',
      }),
    } satisfies StoresHubDTO;
  });
}

export async function getStorePage(db: Db, slug: string): Promise<StorePageDTO | null> {
  const st = seoStoreBySlug(slug);
  if (!st) return null;
  return cached(`seo:store:${slug}`, PAGE_TTL, async () => {
    const ctx = await context(db);
    const [offers, summaries, index] = await Promise.all([currentOffers(db), storeSummaries(db, ctx), termIndex(db)]);
    const summary = summaries.find((s) => s.slug === slug)!;
    const mine = offers.filter((o) => o.store.id === st.id);
    const active = mine.filter((o) => isActive(o, ctx.now));
    const best = active.filter(isGoodDeal).sort(bySavings).slice(0, 20).map(toSeoOffer);
    const counts = trustCounts(active);
    const categories = SEO_CATEGORIES.map((c) => ({ c, count: mine.filter((o) => o.category === c.id).length }))
      .filter((x) => x.count > 0)
      .sort((a, b) => b.count - a.count)
      .map(({ c, count }) => ({ href: `/kategori/${c.slug}`, label: c.label, count }));
    const cheapestFor: SeoLink[] = [...index.values()]
      .filter((s) => s.indexable && s.cheapest?.store_id === st.id && s.unit)
      .sort((a, b) => a.term.label.localeCompare(b.term.label, 'da'))
      .slice(0, 24)
      .map((s) => ({ href: `/tilbud/${s.term.slug}`, label: s.term.label, detail: `${kr(s.cheapest!.unit_price!)} ${PER_UNIT[s.unit!]}` }));
    const upcoming = mine.length - active.length;

    let text = `${st.name} har ${active.length} tilbud i ugens avis${upcoming ? ` og ${upcoming} fra næste avis` : ''}.`;
    text += ` ${counts.real} af ugens tilbud er reelle – mindst ${TRUST_THRESHOLDS.realPct} % under varens gennemsnitspris de sidste ${TRUST_THRESHOLDS.windowDays} dage.`;
    if (summary.nextCatalogAt) text += ` Næste avis gælder fra ${weekdayDate.format(new Date(summary.nextCatalogAt))}.`;

    return {
      kind: 'store',
      store: summary,
      indexable: mine.length >= 10,
      summary: text,
      best,
      trustCounts: counts,
      categories,
      cheapestFor,
      generatedAt: ctx.generatedAt,
      updatedAt: ctx.updatedAt,
      week: ctx.week,
      breadcrumbs: crumbs({ href: '/butikker', label: 'Butikker' }, { href: `/butik/${slug}`, label: st.name }),
      meta: meta({
        title: fitTitle([
          `${st.name} tilbud uge ${ctx.week} – de bedste efter kilopris | Tilbudsradar`,
          `${st.name} tilbud uge ${ctx.week} – de bedste efter kilopris`,
          `${st.name} tilbud i uge ${ctx.week} | Tilbudsradar`,
        ]),
        description: `${active.length} tilbud hos ${st.name} i uge ${ctx.week}, heraf ${counts.real} reelle. Se de største besparelser målt mod 90 dages priser – med pris pr. kg og liter.`,
        path: `/butik/${slug}`,
        noindex: mine.length < 10,
      }),
    } satisfies StorePageDTO;
  });
}

/* ------------------------------------------------------------------ */
/* /kategori/{kategori}                                               */
/* ------------------------------------------------------------------ */

export async function getCategoryPage(db: Db, slug: string): Promise<CategoryPageDTO | null> {
  const cat = seoCategoryBySlug(slug);
  if (!cat) return null;
  return cached(`seo:category:${slug}`, PAGE_TTL, async () => {
    const [offers, index, ctx] = await Promise.all([currentOffers(db), termIndex(db), context(db)]);
    const mine = offers.filter((o) => o.category === cat.id);
    const active = mine.filter((o) => isActive(o, ctx.now));
    const best = active.filter(isGoodDeal).sort(bySavings).slice(0, 20).map(toSeoOffer);
    const counts = trustCounts(active);
    const stores = SEO_STORES.map((st) => ({ name: st.name, slug: st.slug, count: mine.filter((o) => o.store.id === st.id).length })).filter(
      (s) => s.count > 0,
    );
    const terms: SeoLink[] = SEO_TERMS.filter((t) => t.categories[0] === cat.id)
      .map((t) => index.get(t.slug)!)
      .filter((s) => s.hasData)
      .sort((a, b) => a.term.label.localeCompare(b.term.label, 'da'))
      .map((s) => ({
        href: `/tilbud/${s.term.slug}`,
        label: s.term.label,
        ...(s.cheapest && s.unit ? { detail: `fra ${kr(s.cheapest.unit_price!)} ${PER_UNIT[s.unit]}` } : {}),
      }));
    const label = cat.label.toLocaleLowerCase('da-DK');
    return {
      kind: 'category',
      slug,
      label: cat.label,
      indexable: mine.length >= 10,
      summary: `Lige nu er der ${mine.length} tilbud på ${label} fra ${stores.length} ${stores.length === 1 ? 'kæde' : 'kæder'}. ${counts.real} af ugens tilbud er reelle – mindst ${TRUST_THRESHOLDS.realPct} % under varens gennemsnitspris de sidste ${TRUST_THRESHOLDS.windowDays} dage.`,
      best,
      trustCounts: counts,
      stores,
      terms,
      generatedAt: ctx.generatedAt,
      updatedAt: ctx.updatedAt,
      week: ctx.week,
      breadcrumbs: crumbs({ href: '/tilbud', label: 'Tilbud' }, { href: `/kategori/${slug}`, label: cat.label }),
      meta: meta({
        title: fitTitle([`${cat.label} på tilbud i uge ${ctx.week} | Tilbudsradar`, `${cat.label} på tilbud i uge ${ctx.week}`]),
        description: `${mine.length} tilbud på ${label} fra ${listText(stores.map((s) => s.name))}. Se de bedste efter pris pr. kg, og hvilke tilbud der er reelle.`,
        path: `/kategori/${slug}`,
        noindex: mine.length < 10,
      }),
    } satisfies CategoryPageDTO;
  });
}

/* ------------------------------------------------------------------ */
/* /ugens-bedste-tilbud                                               */
/* ------------------------------------------------------------------ */

export async function getWeeklyBest(db: Db): Promise<WeeklyBestDTO> {
  return cached('seo:weekly', PAGE_TTL, async () => {
    const [offers, ctx] = await Promise.all([currentOffers(db), context(db)]);
    const active = offers.filter((o) => isActive(o, ctx.now) && seoCategoryById(o.category));
    const real = active.filter((o) => o.trust.level === 'real' && plausible(o)).sort(bySavings);
    const top = real[0];
    const byStore = SEO_STORES.map((st) => ({
      store: { href: `/butik/${st.slug}`, label: st.name },
      offers: real.filter((o) => o.store.id === st.id).slice(0, 3).map(toSeoOffer),
    })).filter((s) => s.offers.length);
    return {
      kind: 'weekly',
      indexable: real.length >= 5,
      summary:
        `I uge ${ctx.week} har vi fundet ${real.length} reelle tilbud – varer, der er mindst ${TRUST_THRESHOLDS.realPct} % billigere end deres gennemsnitspris de sidste ${TRUST_THRESHOLDS.windowDays} dage.` +
        (top?.trust.savingsPct != null ? ` Den største besparelse er ${top.title} hos ${top.store.name}: ${pctText(top.trust.savingsPct)} under normalt.` : ''),
      best: real.slice(0, 30).map(toSeoOffer),
      byStore,
      trustCounts: trustCounts(active),
      generatedAt: ctx.generatedAt,
      updatedAt: ctx.updatedAt,
      week: ctx.week,
      breadcrumbs: crumbs({ href: '/ugens-bedste-tilbud', label: 'Ugens bedste tilbud' }),
      meta: meta({
        title: fitTitle([`Ugens bedste tilbud – uge ${ctx.week} | Tilbudsradar`, `Ugens bedste tilbud i uge ${ctx.week}`]),
        description: `${real.length} reelle tilbud i uge ${ctx.week} fra REMA 1000, Netto, føtex, Bilka og Lidl – målt mod varernes egne priser de sidste ${TRUST_THRESHOLDS.windowDays} dage.`,
        path: '/ugens-bedste-tilbud',
        noindex: real.length < 5,
      }),
    } satisfies WeeklyBestDTO;
  });
}

/* ------------------------------------------------------------------ */
/* /metode                                                            */
/* ------------------------------------------------------------------ */

export async function getMethodPage(db: Db): Promise<MethodPageDTO> {
  return cached('seo:method', PAGE_TTL, async () => {
    const ctx = await context(db);
    const analyzed = await queryOne<{ n: number }>(
      db,
      sql`SELECT count(*)::int AS n FROM offers o JOIN stores s ON s.id = o.store_id
          WHERE ${activeChainSql} AND o.valid_to > now() - make_interval(days => ${WINDOW_DAYS})`,
    );
    return {
      kind: 'method',
      offersAnalyzed: analyzed?.n ?? 0,
      dataSince: ctx.since.toISOString(),
      thresholds: { ...TRUST_THRESHOLDS },
      generatedAt: ctx.generatedAt,
      updatedAt: ctx.updatedAt,
      week: ctx.week,
      breadcrumbs: crumbs({ href: '/metode', label: 'Metode' }),
      meta: meta({
        title: 'Sådan beregner vi kilopris og reelle tilbud | Tilbudsradar',
        description: `Sådan regner Tilbudsradar prisen om pr. kg og liter, og hvornår et tilbud er "reelt": mindst ${TRUST_THRESHOLDS.realPct} % under varens gennemsnitspris de sidste ${TRUST_THRESHOLDS.windowDays} dage.`,
        path: '/metode',
      }),
    } satisfies MethodPageDTO;
  });
}
