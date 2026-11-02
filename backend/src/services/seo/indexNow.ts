import type { Logger } from '@tilbudsradar/scrapers';
import type { Db } from '../../db/client';
import { sitemaps, sitemapUrls } from './sitemap';

/**
 * IndexNow: fortæller Bing, Yandex m.fl., hvilke sider der er ændret, så de
 * hentes igen hurtigt (Google bruger det ikke). Kun i produktion og kun med
 * INDEXNOW_KEY. Fejl logges, men vælter aldrig hentningen af aviserne.
 */

const ENDPOINT = 'https://api.indexnow.org/indexnow';

export interface IndexNowOptions {
  key: string | null;
  appUrl: string;
  isProd: boolean;
  log: Logger;
  fetchImpl?: typeof fetch;
}

/** Melder adresserne i én forespørgsel. true, hvis IndexNow tog imod dem. */
export async function submitIndexNow(urls: string[], o: IndexNowOptions): Promise<boolean> {
  if (!o.isProd || !o.key || !urls.length) return false;
  try {
    const res = await (o.fetchImpl ?? fetch)(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        host: new URL(o.appUrl).host,
        key: o.key,
        keyLocation: `${o.appUrl}/${o.key}.txt`,
        urlList: urls.slice(0, 10_000),
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      o.log.warn(`IndexNow afviste ${urls.length} adresser (HTTP ${res.status})`);
      return false;
    }
    o.log.info(`IndexNow: ${urls.length} ændrede sider meldt`);
    return true;
  } catch (err) {
    o.log.warn('IndexNow kunne ikke nås', { err: err instanceof Error ? err.message : String(err) });
    return false;
  }
}

/**
 * Kaldes efter hver hentning, der gav nye tilbud: beregner sitemaps (og varmer
 * dermed datasidernes cache op) og melder de sider, hvis lastmod har ændret sig
 * siden sidst. Efter en genstart meldes alle sider én gang.
 */
export function createIndexNowNotifier(db: Db, o: IndexNowOptions): () => Promise<void> {
  let last: Map<string, string> | null = null;
  return async () => {
    try {
      const entries = sitemapUrls(await sitemaps(db));
      const current = new Map(entries.map((e) => [e.path, e.lastmod]));
      const changed = entries.filter((e) => last?.get(e.path) !== e.lastmod).map((e) => `${o.appUrl}${e.path}`);
      last = current;
      await submitIndexNow(changed, o);
    } catch (err) {
      o.log.warn('Sitemaps kunne ikke beregnes efter hentning', { err: err instanceof Error ? err.message : String(err) });
    }
  };
}
