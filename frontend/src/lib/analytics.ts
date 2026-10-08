import { CONFIG } from './config';

/**
 * Valgfri, cookiefri besøgsstatistik med Plausible (EU-hostet). Aktiveres kun
 * når VITE_PLAUSIBLE_DOMAIN er sat. Plausible sætter ingen cookies og gemmer
 * intet på enheden, så der kræves ikke samtykke. UTM-parametre (fx fra
 * Instagram-links) registreres automatisk fra adressen ved sidevisningen.
 */
const domain = CONFIG.plausibleDomain;
const src = CONFIG.plausibleSrc;

type Plausible = (event: string, opts?: { props?: Record<string, string | number> }) => void;

export function initAnalytics(): void {
  if (!domain || typeof document === 'undefined') return;
  const script = document.createElement('script');
  script.defer = true;
  script.src = src;
  script.dataset.domain = domain;
  document.head.appendChild(script);
}

/** Måler en hændelse (fx "Prøveperiode startet"). Gør intet uden Plausible. */
export function track(event: string, props?: Record<string, string | number>): void {
  const plausible = (window as unknown as { plausible?: Plausible }).plausible;
  plausible?.(event, props ? { props } : undefined);
}
