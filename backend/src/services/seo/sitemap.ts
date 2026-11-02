import { SEO_CATEGORIES, SEO_STORES, SITEMAP_PATHS, STATIC_LASTMOD } from '@tilbudsradar/shared';
import { sql } from 'drizzle-orm';
import { query, type Db } from '../../db/client';
import { cached } from '../cache';
import { activeChainSql } from '../scope';
import { getCategoryPage, getStorePage, getWeeklyBest } from './pages';
import { termIndex } from './termIndex';

/**
 * Sitemaps med rigtig lastmod: den nyeste dag, et af sidens tilbud blev set
 * første gang (first_seen_at) – for faste sider datoen for seneste ændring.
 * Kun sider, der må indekseres, kommer med.
 */

export interface SitemapEntry {
  path: string;
  /** YYYY-MM-DD */
  lastmod: string;
}

export interface Sitemaps {
  pages: SitemapEntry[];
  tilbud: SitemapEntry[];
  butikker: SitemapEntry[];
  kategorier: SitemapEntry[];
}

export const SITEMAP_NAMES = ['pages', 'tilbud', 'butikker', 'kategorier'] as const;

const day = (d: Date | string | number) => new Date(d).toISOString().slice(0, 10);
const newestDay = (dates: (Date | string | null | undefined)[], fallback: string) => {
  const times = dates.filter((d) => d != null).map((d) => new Date(d!).getTime());
  return times.length ? day(Math.max(...times)) : fallback;
};

async function build(db: Db): Promise<Sitemaps> {
  const [index, weekly] = await Promise.all([termIndex(db), getWeeklyBest(db)]);
  // Nyeste first_seen_at pr. kæde og kategori blandt de aktuelle tilbud.
  const latest = await query<{ store_id: string; category: string; at: Date }>(
    db,
    sql`SELECT o.store_id, o.category, max(o.first_seen_at) AS at FROM offers o JOIN stores s ON s.id = o.store_id
        WHERE s.enabled AND ${activeChainSql} AND o.valid_to > now() AND o.valid_from <= now() + interval '8 days'
        GROUP BY o.store_id, o.category`,
  );
  const today = day(Date.now());
  const overall = newestDay(latest.map((r) => r.at), today);

  const tilbud: SitemapEntry[] = [...index.values()]
    .filter((s) => s.indexable)
    .map((s) => {
      const current = [...s.active, ...s.upcoming];
      return { path: `/tilbud/${s.term.slug}`, lastmod: newestDay((current.length ? current : s.rows).map((r) => r.first_seen_at), overall) };
    })
    .sort((a, b) => a.path.localeCompare(b.path));

  const butikker: SitemapEntry[] = [];
  for (const st of SEO_STORES) {
    const page = await getStorePage(db, st.slug);
    if (page?.indexable) butikker.push({ path: `/butik/${st.slug}`, lastmod: newestDay(latest.filter((r) => r.store_id === st.id).map((r) => r.at), overall) });
  }

  const kategorier: SitemapEntry[] = [];
  for (const c of SEO_CATEGORIES) {
    const page = await getCategoryPage(db, c.slug);
    if (page?.indexable) kategorier.push({ path: `/kategori/${c.slug}`, lastmod: newestDay(latest.filter((r) => r.category === c.id).map((r) => r.at), overall) });
  }

  const pages: SitemapEntry[] = SITEMAP_PATHS.filter((p) => p !== '/ugens-bedste-tilbud' || weekly.indexable).map((path) => ({
    path,
    // Forsiden og oversigterne følger dataene; de øvrige faste sider har en fast dato.
    lastmod: STATIC_LASTMOD[path] ?? overall,
  }));

  return { pages, tilbud, butikker, kategorier };
}

/** Beregnes én gang pr. data-version (nye tilbud) og højst hver 30. minut. */
export function sitemaps(db: Db): Promise<Sitemaps> {
  return cached('seo:sitemaps', 30 * 60 * 1000, () => build(db));
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);

export function urlsetXml(entries: SitemapEntry[], appUrl: string): string {
  const urls = entries.map((e) => `  <url><loc>${esc(`${appUrl}${e.path}`)}</loc><lastmod>${e.lastmod}</lastmod></url>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

export function sitemapIndexXml(maps: Sitemaps, appUrl: string): string {
  const items = SITEMAP_NAMES.filter((name) => maps[name].length).map((name) => {
    const lastmod = maps[name].map((e) => e.lastmod).sort().at(-1)!;
    return `  <sitemap><loc>${esc(`${appUrl}/sitemap-${name}.xml`)}</loc><lastmod>${lastmod}</lastmod></sitemap>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${items.join('\n')}\n</sitemapindex>\n`;
}

/** Alle adresser i sitemaps med lastmod – til IndexNow. */
export const sitemapUrls = (maps: Sitemaps) => SITEMAP_NAMES.flatMap((name) => maps[name]);
