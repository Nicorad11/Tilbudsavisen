import * as Sentry from '@sentry/node';
import { scrubSentryEvent } from '@tilbudsradar/shared';
import { env } from './env';

/**
 * Fejlovervågning – kun aktiv når SENTRY_DSN er sat. Der sendes ingen
 * persondata: ingen IP, cookies, headers eller request-body, og adgangskoder,
 * tokens og e-mailadresser fjernes fra beskeder, URL'er og breadcrumbs.
 */
export const sentryEnabled = Boolean(env.SENTRY_DSN);

if (env.SENTRY_DSN) {
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.SENTRY_ENVIRONMENT ?? env.NODE_ENV,
    sendDefaultPii: false,
    tracesSampleRate: 0,
    beforeSend: (event) => scrubSentryEvent(event),
    beforeSendTransaction: (event) => scrubSentryEvent(event),
  });
}
