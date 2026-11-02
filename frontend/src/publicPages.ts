import type { ComponentType } from 'react';
import type { PublicPages } from './App';
import { lazyWithReload } from './lib/updates';

type Loader = () => Promise<ComponentType>;

/** Hvor de offentlige sider hentes fra i browseren (hver side er sin egen fil). */
const loaders: Record<keyof PublicPages, Loader> = {
  Pricing: async () => (await import('./pages/Pricing')).Pricing,
  Terms: async () => (await import('./pages/legal/Terms')).Terms,
  Privacy: async () => (await import('./pages/legal/Privacy')).Privacy,
  Cookies: async () => (await import('./pages/legal/Cookies')).Cookies,
  About: async () => (await import('./pages/legal/About')).About,
  Withdraw: async () => (await import('./pages/legal/Withdraw')).Withdraw,
  // Datasiderne ligger i én fil – de deler komponenter og hentes samlet.
  TermHub: async () => (await import('./pages/seo/SeoPages')).TermHubPage,
  Term: async () => (await import('./pages/seo/SeoPages')).TermPage,
  StoresHub: async () => (await import('./pages/seo/SeoPages')).StoresHubPage,
  Store: async () => (await import('./pages/seo/SeoPages')).StorePage,
  Category: async () => (await import('./pages/seo/SeoPages')).CategoryPage,
  WeeklyBest: async () => (await import('./pages/seo/SeoPages')).WeeklyBestPage,
  Method: async () => (await import('./pages/seo/SeoPages')).MethodPage,
};

/** De offentlige sider som lazy komponenter til browseren. */
export const lazyPublicPages = Object.fromEntries(
  Object.entries(loaders).map(([name, load]) => [name, lazyWithReload(async () => ({ default: await load() }))]),
) as unknown as PublicPages;

/** Hvilken side en sti viser (forsiden er altid med i hovedfilen). */
const PAGE_FOR_PATH: [RegExp, keyof PublicPages][] = [
  [/^\/priser$/, 'Pricing'],
  [/^\/handelsbetingelser$/, 'Terms'],
  [/^\/privatlivspolitik$/, 'Privacy'],
  [/^\/cookies$/, 'Cookies'],
  [/^\/om$/, 'About'],
  [/^\/fortryd$/, 'Withdraw'],
  [/^\/tilbud$/, 'TermHub'],
  [/^\/tilbud\/[^/]+$/, 'Term'],
  [/^\/butikker$/, 'StoresHub'],
  [/^\/butik\/[^/]+$/, 'Store'],
  [/^\/kategori\/[^/]+$/, 'Category'],
  [/^\/ugens-bedste-tilbud$/, 'WeeklyBest'],
  [/^\/metode$/, 'Method'],
];

/**
 * Henter siden for stien, før React hydrerer den server-renderede HTML. Så er
 * koden klar, og siden blinker ikke. Fejler hentningen, hydrerer React alligevel
 * og beholder serverens HTML, indtil siden er hentet.
 */
export async function preloadPublicPage(pathname: string): Promise<void> {
  const path = pathname.replace(/\/+$/, '') || '/';
  const name = PAGE_FOR_PATH.find(([pattern]) => pattern.test(path))?.[1];
  if (!name) return;
  try {
    await loaders[name]();
  } catch {
    // Håndteres af lazyWithReload, når React selv henter siden.
  }
}
