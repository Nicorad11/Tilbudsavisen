import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  cleanPath,
  jsonForScript,
  PAGE_META,
  renderHeadTags,
  seoCategoryBySlug,
  seoForPath,
  seoStoreBySlug,
  seoTermBySlug,
  type PublicConfig,
  type SeoMeta,
} from '@tilbudsradar/shared';
import type { Db } from '../db/client';
import { env } from '../env';
import { cached } from '../services/cache';
import {
  getCategoryPage,
  getMethodPage,
  getStorePage,
  getStoresHub,
  getTermHub,
  getTermPage,
  getWeeklyBest,
} from '../services/seo/pages';
import { getStats } from '../services/stats';

/**
 * Server-rendering af de offentlige sider. Frontendens SSR-bundle
 * (frontend/dist/server/entry-server.js, bygget fra src/entry-server.tsx)
 * renderer siden med data, som serveren henter direkte fra services – med
 * samme query-nøgler som frontendens hooks. Browseren hydrerer derefter den
 * samme HTML (frontend/src/main.tsx). /app forbliver klient-renderet.
 */

export interface PrefetchedQuery {
  queryKey: readonly unknown[];
  data: unknown;
}

/** Det SSR-bundlet eksporterer. */
export interface SsrModule {
  render(url: string, queries: PrefetchedQuery[]): { html: string; meta: SeoMeta | null; state: unknown };
}

export interface SsrPage {
  status: number;
  html: string;
}

/** De faste offentlige sider (forside, priser, juridiske sider). */
export const STATIC_PUBLIC_PATHS = Object.keys(PAGE_META).filter((p) => !/^\/app(\/|$)/.test(p));

/** Server-renderes: alt uden for /app og /api – også ukendte stier, der får en rigtig 404-side. */
export const isServerRendered = (pathname: string) => !/^\/(app|api)(\/|$)/.test(pathname);

/** Som et API-svar: JSON frem og tilbage, så fx datoer er strenge præcis som i browseren. */
const asJson = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/**
 * Datasidernes loaders: stien under /api/seo og funktionen, der bygger siden.
 * Query-nøglen er ['seo', ...stiens dele] – den samme som frontend/src/pages/seo/data.ts.
 */
const SEO_LOADERS: { pattern: RegExp; valid?: (slug: string) => boolean; load: (db: Db, slug: string) => Promise<unknown> }[] = [
  { pattern: /^\/tilbud$/, load: (db) => getTermHub(db) },
  { pattern: /^\/tilbud\/([^/]+)$/, valid: (s) => Boolean(seoTermBySlug(s)), load: (db, s) => getTermPage(db, s) },
  { pattern: /^\/butikker$/, load: (db) => getStoresHub(db) },
  { pattern: /^\/butik\/([^/]+)$/, valid: (s) => Boolean(seoStoreBySlug(s)), load: (db, s) => getStorePage(db, s) },
  { pattern: /^\/kategori\/([^/]+)$/, valid: (s) => Boolean(seoCategoryBySlug(s)), load: (db, s) => getCategoryPage(db, s) },
  { pattern: /^\/ugens-bedste-tilbud$/, load: (db) => getWeeklyBest(db) },
  { pattern: /^\/metode$/, load: (db) => getMethodPage(db) },
];

export const seoQueryKey = (pathname: string) => ['seo', ...pathname.split('/').filter(Boolean)];

/** Siden findes (forside, faste sider og datasider for varer, kæder og kategorier på listerne) og må caches. */
export function isKnownPath(pathname: string): boolean {
  if (STATIC_PUBLIC_PATHS.includes(pathname)) return true;
  for (const route of SEO_LOADERS) {
    const match = route.pattern.exec(pathname);
    if (match) return !route.valid || route.valid(match[1] ?? '');
  }
  return false;
}

/**
 * Data pr. side – samme nøgler som frontendens hooks. Ukendte varer, kæder og
 * kategorier får data null, så siden renderes som 404 uden at vente på data.
 */
async function prefetch(db: Db, pathname: string): Promise<PrefetchedQuery[]> {
  if (pathname === '/') return [{ queryKey: ['stats'], data: asJson(await getStats(db)) }];
  for (const route of SEO_LOADERS) {
    const match = route.pattern.exec(pathname);
    if (!match) continue;
    const slug = match[1] ?? '';
    const data = !route.valid || route.valid(slug) ? asJson(await route.load(db, slug)) : null;
    return [{ queryKey: seoQueryKey(pathname), data }];
  }
  return [];
}

/** Indlæser SSR-bundlet. null, hvis frontenden ikke er bygget med det (fx under udvikling og i tests). */
export async function loadSsrModule(distDir: string, config: PublicConfig): Promise<SsrModule | null> {
  const file = path.join(distDir, 'server', 'entry-server.js');
  if (!existsSync(file)) return null;
  // Frontendens CONFIG læses ved indlæsning – på serveren herfra i stedet for fra siden.
  (globalThis as { __TR_CONFIG__?: PublicConfig }).__TR_CONFIG__ = config;
  return (await import(pathToFileURL(file).href)) as SsrModule;
}

const SEO_BLOCK = /<!--seo-->[\s\S]*?<!--\/seo-->/;
const ROOT = '<div id="root"></div>';

export function createSsr(options: { db: Db; module: SsrModule; template: string; configTag: string }) {
  async function build(url: string, queries: PrefetchedQuery[]): Promise<SsrPage> {
    const pathname = cleanPath(url);
    const { html, meta, state } = options.module.render(url, queries);
    const resolved = meta ?? seoForPath(pathname);
    const head = [
      renderHeadTags(resolved, env.APP_URL),
      options.configTag,
      `<script id="tr-state" type="application/json">${jsonForScript(state)}</script>`,
    ].join('\n    ');
    return {
      status: resolved.notFound ? 404 : 200,
      html: options.template.replace(SEO_BLOCK, () => head).replace(ROOT, () => `<div id="root">${html}</div>`),
    };
  }

  return {
    /**
     * Færdig HTML for en offentlig side. Kendte sider caches i hukommelsen pr.
     * data-version (nye tilbud nulstiller) og højst 10 minutter, så "gælder nu"
     * og lignende holder. Ukendte stier (404) caches ikke.
     */
    async render(pathname: string): Promise<SsrPage> {
      const clean = cleanPath(pathname);
      // Data hentes først: kun kendte sider (forside, faste sider, varer, kæder og kategorier) caches.
      if (isKnownPath(clean)) return cached(`ssr:${clean}`, 10 * 60_000, async () => build(clean, await prefetch(options.db, clean)));
      return build(pathname, await prefetch(options.db, clean));
    },
  };
}

export type Ssr = ReturnType<typeof createSsr>;
