import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { cleanPath, jsonForScript, PAGE_META, renderHeadTags, seoForPath, type PublicConfig, type SeoMeta } from '@tilbudsradar/shared';
import type { Db } from '../db/client';
import { env } from '../env';
import { cached } from '../services/cache';
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

/** Data pr. side – samme nøgler som hooks i frontend/src/lib/hooks.ts. */
async function prefetch(db: Db, pathname: string): Promise<PrefetchedQuery[]> {
  if (pathname === '/') return [{ queryKey: ['stats'], data: asJson(await getStats(db)) }];
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
  async function build(url: string): Promise<SsrPage> {
    const pathname = cleanPath(url);
    const { html, meta, state } = options.module.render(url, await prefetch(options.db, pathname));
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
    render(pathname: string): Promise<SsrPage> {
      const clean = cleanPath(pathname);
      return STATIC_PUBLIC_PATHS.includes(clean) ? cached(`ssr:${clean}`, 10 * 60_000, () => build(clean)) : build(pathname);
    },
  };
}

export type Ssr = ReturnType<typeof createSsr>;
