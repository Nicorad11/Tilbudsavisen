import type { PageViewRequest } from '@tilbudsradar/shared';
import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router';
import { buildUrl } from '../lib/api';
import { useAuth } from '../lib/store';

/** Respektér "Do Not Track" og "Global Privacy Control" i browseren. */
function optedOut(): boolean {
  if (typeof navigator === 'undefined') return true;
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
  return nav.doNotTrack === '1' || nav.globalPrivacyControl === true;
}

/**
 * Cookiefri besøgsstatistik: sender én sidevisning pr. navigation til vores
 * egen server (se backend/src/services/analytics.ts). Administratorer tælles
 * ikke med, og der gemmes intet i browseren.
 */
export function PageViewTracker() {
  const { pathname, search } = useLocation();
  const checked = useAuth((s) => s.checked);
  const user = useAuth((s) => s.user);
  const first = useRef(true);

  useEffect(() => {
    // Vent på at sessionen er tjekket, så administratorer kan sorteres fra.
    if (!checked || optedOut() || user?.access.isAdmin) return;
    const body: PageViewRequest = { path: pathname, member: Boolean(user && !user.isGuest) };
    if (first.current) {
      // Hvor besøget kom fra, giver kun mening ved den første side.
      first.current = false;
      const params = new URLSearchParams(search);
      body.referrer = document.referrer || null;
      body.utmSource = params.get('utm_source');
      body.utmMedium = params.get('utm_medium');
      body.utmCampaign = params.get('utm_campaign');
    }
    void fetch(buildUrl('/analytics/pageview'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      keepalive: true,
      credentials: 'omit',
    }).catch(() => undefined);
    // Kun ved skift af side – ikke når brugerobjektet opdateres.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, checked]);

  return null;
}
