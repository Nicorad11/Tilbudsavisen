import type { Db } from '../../db/client';
import { cached } from '../cache';
import { sitemaps, sitemapUrls } from './sitemap';

/**
 * Hvad Google ser på vores egne sider: titel, beskrivelse, robots og interne
 * links – læst ud af den server-renderede HTML. Bruges af Search Console-
 * analysen (nuværende titel ved lav klikrate, hvem der linker til en side).
 */

export interface PageInfo {
  path: string;
  status: number;
  title: string | null;
  description: string | null;
  robots: string | null;
  canonical: string | null;
  /** Interne links i sidens indhold (<main>). */
  mainLinks: string[];
  /** Interne links i header og footer (på alle sider). */
  siteLinks: string[];
}

export type PageRenderer = (path: string) => Promise<{ status: number; html: string }>;

let renderer: PageRenderer | null = null;

/** Sættes af site.ts, når SSR-bundlet er indlæst. */
export function setPageRenderer(r: PageRenderer | null): void {
  renderer = r;
}

const ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#x27;': "'", '&#39;': "'", '&nbsp;': ' ' };
const decode = (s: string) => s.replace(/&(amp|lt|gt|quot|nbsp|#x27|#39);/g, (m) => ENTITIES[m] ?? m).replace(/<!-- -->/g, '');

/** Intern sti uden query, hash og afsluttende skråstreg – eller null for eksterne links. */
export function internalPath(href: string, appUrl: string): string | null {
  let h = decode(href.trim());
  if (h.startsWith(appUrl)) h = h.slice(appUrl.length) || '/';
  if (!h.startsWith('/') || h.startsWith('//')) return null;
  const path = h.split(/[?#]/)[0]!;
  return path.length > 1 ? path.replace(/\/+$/, '') : '/';
}

function links(html: string, appUrl: string): string[] {
  const out = new Set<string>();
  for (const m of html.matchAll(/<a\b[^>]*\bhref="([^"]+)"/g)) {
    const p = internalPath(m[1]!, appUrl);
    if (p) out.add(p);
  }
  return [...out];
}

/** Titel, beskrivelse og links fra en server-renderet side. */
export function parsePage(path: string, status: number, html: string, appUrl: string): PageInfo {
  const meta = (name: string) => new RegExp(`<meta name="${name}" content="([^"]*)"`).exec(html)?.[1];
  const title = /<title>([\s\S]*?)<\/title>/.exec(html)?.[1];
  const canonical = /<link rel="canonical" href="([^"]*)"/.exec(html)?.[1];
  const mainStart = html.indexOf('<main');
  const mainEnd = html.indexOf('</main>', mainStart);
  const main = mainStart >= 0 && mainEnd > mainStart ? html.slice(mainStart, mainEnd) : '';
  const outside = main ? html.slice(0, mainStart) + html.slice(mainEnd) : html;
  const mainLinks = links(main, appUrl);
  return {
    path,
    status,
    title: title ? decode(title).trim() : null,
    description: meta('description') !== undefined ? decode(meta('description')!) : null,
    robots: meta('robots') ?? null,
    canonical: canonical ? decode(canonical) : null,
    mainLinks,
    siteLinks: links(outside, appUrl).filter((l) => !mainLinks.includes(l)),
  };
}

/** Renderer sider med en given renderer (fx i rapport-scriptet). */
export async function snapshotWith(render: PageRenderer, paths: string[], appUrl: string): Promise<Map<string, PageInfo>> {
  const pages = new Map<string, PageInfo>();
  for (const path of paths) {
    try {
      const { status, html } = await render(path);
      pages.set(path, parsePage(path, status, html, appUrl));
    } catch {
      // En side, der ikke kan renderes, springes over – analysen kører videre uden den.
    }
  }
  return pages;
}

/**
 * Alle sider i sitemapet, renderet som Google ser dem. null, når
 * server-renderingen ikke er tilgængelig (frontenden er ikke bygget).
 * Caches pr. data-version (nye tilbud) og højst 6 timer.
 */
export async function siteSnapshot(db: Db, appUrl: string, render: PageRenderer | null = renderer): Promise<Map<string, PageInfo> | null> {
  if (!render) return null;
  return cached('seo:snapshot', 6 * 60 * 60 * 1000, async () => {
    const paths = sitemapUrls(await sitemaps(db)).map((e) => e.path);
    return snapshotWith(render, paths, appUrl);
  });
}
