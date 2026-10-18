import { CONFIG } from './config';

/**
 * Fejlovervågning med Sentry – kun når VITE_SENTRY_DSN er sat. Indlæses
 * dynamisk, så pakken ikke tynger appen uden DSN. Ingen persondata, ingen
 * session replay og ingen lagring i browseren.
 */
let sentry: typeof import('@sentry/react') | null = null;

export async function initMonitoring(): Promise<void> {
  const dsn = CONFIG.sentryDsn;
  if (!dsn) return;
  const Sentry = await import('@sentry/react');
  sentry = Sentry;
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

/** Fejl der er fanget (fx af AppErrorBoundary) og derfor ikke når Sentrys globale fejlhåndtering. */
export function reportError(error: unknown, componentStack?: string): void {
  if (sentry) sentry.captureException(error, componentStack ? { contexts: { react: { componentStack } } } : undefined);
  else console.error(error);
}
