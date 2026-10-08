import * as Sentry from '@sentry/node';
import { env } from './env';

/**
 * Fejlovervågning – kun aktiv når SENTRY_DSN er sat. Der sendes ingen
 * persondata: ingen IP, cookies, headers eller request-body.
 */
export const sentryEnabled = Boolean(env.SENTRY_DSN);

if (env.SENTRY_DSN) {
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.SENTRY_ENVIRONMENT ?? env.NODE_ENV,
    sendDefaultPii: false,
    tracesSampleRate: 0,
    beforeSend(event) {
      if (event.request) {
        delete event.request.cookies;
        delete event.request.headers;
        delete event.request.data;
        delete event.request.query_string;
      }
      delete event.user;
      return event;
    },
  });
}
