import { CONFIG } from './config';

/**
 * Fejlovervågning med Sentry – kun når VITE_SENTRY_DSN er sat. Indlæses
 * dynamisk, så pakken ikke tynger appen uden DSN. Ingen persondata, ingen
 * session replay og ingen lagring i browseren.
 */
export async function initMonitoring(): Promise<void> {
  const dsn = CONFIG.sentryDsn;
  if (!dsn) return;
  const Sentry = await import('@sentry/react');
  Sentry.init({
    dsn,
    environment: CONFIG.sentryEnvironment,
    sendDefaultPii: false,
    tracesSampleRate: 0,
    // Ingen sessionsmåling – den kræver ikke lagring, men vi har ikke brug for den.
    integrations: (defaults) => defaults.filter((i) => i.name !== 'BrowserSession'),
    beforeSend(event) {
      delete event.user;
      if (event.request?.url) event.request.url = event.request.url.replace(/token=[^&]+/g, 'token=[fjernet]');
      return event;
    },
  });
}
