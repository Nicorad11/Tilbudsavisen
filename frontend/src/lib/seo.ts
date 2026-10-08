import { metaForPath } from '@tilbudsradar/shared';
import { useEffect } from 'react';
import { useLocation } from 'react-router';

function setMeta(selector: string, attr: string, value: string, create: () => HTMLElement) {
  let el = document.head.querySelector<HTMLElement>(selector);
  if (!el) {
    el = create();
    document.head.appendChild(el);
  }
  el.setAttribute(attr, value);
}

/**
 * Opdaterer titel, beskrivelse, canonical og robots ved navigation. Serveren
 * har allerede indsat de samme tags i HTML'en til crawlere og delingslinks.
 */
export function useSeo(): void {
  const { pathname } = useLocation();
  useEffect(() => {
    const meta = metaForPath(pathname);
    document.title = meta.title;
    setMeta('meta[name="description"]', 'content', meta.description, () => Object.assign(document.createElement('meta'), { name: 'description' }));
    setMeta('meta[property="og:title"]', 'content', meta.title, () => {
      const m = document.createElement('meta');
      m.setAttribute('property', 'og:title');
      return m;
    });
    setMeta('link[rel="canonical"]', 'href', `${window.location.origin}${pathname === '/' ? '/' : pathname.replace(/\/+$/, '')}`, () =>
      Object.assign(document.createElement('link'), { rel: 'canonical' }),
    );
    const robots = document.head.querySelector('meta[name="robots"]');
    if (meta.noindex && !robots) document.head.appendChild(Object.assign(document.createElement('meta'), { name: 'robots', content: 'noindex' }));
    if (!meta.noindex && robots) robots.remove();
  }, [pathname]);
}
