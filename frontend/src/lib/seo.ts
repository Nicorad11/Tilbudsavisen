import { absoluteUrl, DEFAULT_OG_IMAGE, jsonForScript, seoForPath, type SeoMeta } from '@tilbudsradar/shared';
import { createContext, useContext, useEffect } from 'react';
import { useLocation } from 'react-router';
import { CONFIG } from './config';

/**
 * Under server-rendering samler siden sin meta her, så serveren kan skrive
 * den i <head> og sætte statuskoden. I browseren er værdien null.
 */
export interface HeadCollector {
  meta: SeoMeta | null;
}
export const HeadContext = createContext<HeadCollector | null>(null);

function setMeta(selector: string, attr: string, value: string, create: () => HTMLElement) {
  let el = document.head.querySelector<HTMLElement>(selector);
  if (!el) {
    el = create();
    document.head.appendChild(el);
  }
  el.setAttribute(attr, value);
}

const property = (name: string) => () => {
  const m = document.createElement('meta');
  m.setAttribute('property', name);
  return m;
};

function applyMeta(meta: SeoMeta): void {
  document.title = meta.title;
  setMeta('meta[name="description"]', 'content', meta.description, () => Object.assign(document.createElement('meta'), { name: 'description' }));
  setMeta('meta[property="og:title"]', 'content', meta.title, property('og:title'));
  setMeta('meta[property="og:description"]', 'content', meta.description, property('og:description'));
  setMeta('meta[property="og:image"]', 'content', absoluteUrl(CONFIG.appUrl, meta.image ?? DEFAULT_OG_IMAGE), property('og:image'));

  const canonical = document.head.querySelector('link[rel="canonical"]');
  if (meta.path) {
    const url = absoluteUrl(CONFIG.appUrl, meta.path);
    setMeta('link[rel="canonical"]', 'href', url, () => Object.assign(document.createElement('link'), { rel: 'canonical' }));
    setMeta('meta[property="og:url"]', 'content', url, property('og:url'));
  } else canonical?.remove();

  const robots = document.head.querySelector('meta[name="robots"]');
  if (meta.noindex && !robots) document.head.appendChild(Object.assign(document.createElement('meta'), { name: 'robots', content: 'noindex' }));
  if (!meta.noindex && robots) robots.remove();

  // Strukturerede data følger siden (de udføres ikke, så CSP'en er uberørt).
  for (const el of document.head.querySelectorAll('script[data-tr-jsonld]')) el.remove();
  for (const data of meta.jsonLd ?? []) {
    const el = document.createElement('script');
    el.type = 'application/ld+json';
    el.dataset.trJsonld = '';
    el.textContent = jsonForScript(data);
    document.head.appendChild(el);
  }
}

/**
 * Sidens titel, beskrivelse, canonical, robots, delingsbillede og strukturerede
 * data. Uden argument bruges de faste sider (`seoForPath`). Datasider giver
 * deres egen meta, bygget af de samme data som serveren brugte – så server og
 * browser altid sætter de samme tags.
 */
export function useSeo(meta?: SeoMeta): void {
  const { pathname } = useLocation();
  const resolved = meta ?? seoForPath(pathname);
  const collector = useContext(HeadContext);
  if (collector) collector.meta = resolved;
  // Nøglen dækker hele meta-objektet, så et nyt objekt med samme indhold ikke giver et nyt kald.
  const key = JSON.stringify(resolved);
  useEffect(() => applyMeta(resolved), [key]);
}
