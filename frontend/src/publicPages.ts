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
};

/** De offentlige sider som lazy komponenter til browseren. */
export const lazyPublicPages = Object.fromEntries(
  Object.entries(loaders).map(([name, load]) => [name, lazyWithReload(async () => ({ default: await load() }))]),
) as unknown as PublicPages;

/** Hvilken side en sti viser (kun de faste offentlige sider – forsiden er altid med i hovedfilen). */
const PAGE_FOR_PATH: Record<string, keyof PublicPages> = {
  '/priser': 'Pricing',
  '/handelsbetingelser': 'Terms',
  '/privatlivspolitik': 'Privacy',
  '/cookies': 'Cookies',
  '/om': 'About',
  '/fortryd': 'Withdraw',
};

/**
 * Henter siden for stien, før React hydrerer den server-renderede HTML. Så er
 * koden klar, og siden blinker ikke. Fejler hentningen, hydrerer React alligevel
 * og beholder serverens HTML, indtil siden er hentet.
 */
export async function preloadPublicPage(pathname: string): Promise<void> {
  const name = PAGE_FOR_PATH[pathname.replace(/\/+$/, '') || '/'];
  if (!name) return;
  try {
    await loaders[name]();
  } catch {
    // Håndteres af lazyWithReload, når React selv henter siden.
  }
}
