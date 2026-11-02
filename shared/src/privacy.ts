/**
 * Fjerner persondata og hemmeligheder fra fejlrapporter (Sentry), før de
 * forlader browseren eller serveren: login-headere, cookies, adgangskoder,
 * tokens og e-mailadresser – også inde i fejlbeskeder, URL'er og breadcrumbs.
 */

/** Feltnavne hvis værdi aldrig sendes. */
const SENSITIVE_KEY = /pass(word|wd)?|secret|token|authorization|cookie|session|api[-_]?key|credential|e-?mail|cvc|card/i;
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const BEARER = /\bBearer\s+[A-Za-z0-9._~+/=-]+/g;
const SECRET_PARAMS = /((?:^|[?&#;])(?:token|access_token|refresh_token|session_id|code|key|email|password)=)[^&#;\s]*/gi;
const REMOVED = '[fjernet]';

export function scrubText(text: string): string {
  return text.replace(BEARER, `Bearer ${REMOVED}`).replace(SECRET_PARAMS, `$1${REMOVED}`).replace(EMAIL, '[e-mail]');
}

export function scrubValue(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return scrubText(value);
  if (value === null || typeof value !== 'object') return value;
  if (depth > 8) return REMOVED;
  if (Array.isArray(value)) return value.map((v) => scrubValue(v, depth + 1));
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, v]) => [key, SENSITIVE_KEY.test(key) ? REMOVED : scrubValue(v, depth + 1)]),
  );
}

/** Den del af en Sentry-event, der kan indeholde persondata (uden afhængighed af Sentrys typer). */
interface ScrubbableEvent {
  user?: unknown;
  message?: string;
  request?: { url?: string; query_string?: unknown; headers?: unknown; cookies?: unknown; data?: unknown };
  exception?: { values?: { value?: string }[] };
  breadcrumbs?: { message?: string; data?: unknown }[];
  extra?: unknown;
  contexts?: unknown;
  tags?: unknown;
}

/** Til `beforeSend` i Sentry.init – i både frontend og backend. */
export function scrubSentryEvent<T>(event: T): T {
  const e = event as T & ScrubbableEvent;
  delete e.user;
  if (e.message) e.message = scrubText(e.message);
  if (e.request) {
    // Headere, cookies og body sendes aldrig; URL og query renses.
    delete e.request.headers;
    delete e.request.cookies;
    delete e.request.data;
    if (e.request.url) e.request.url = scrubText(e.request.url);
    if (e.request.query_string !== undefined) e.request.query_string = scrubValue(e.request.query_string);
  }
  for (const ex of e.exception?.values ?? []) if (ex.value) ex.value = scrubText(ex.value);
  for (const crumb of e.breadcrumbs ?? []) {
    if (crumb.message) crumb.message = scrubText(crumb.message);
    if (crumb.data !== undefined) crumb.data = scrubValue(crumb.data);
  }
  if (e.extra !== undefined) e.extra = scrubValue(e.extra);
  if (e.contexts !== undefined) e.contexts = scrubValue(e.contexts);
  if (e.tags !== undefined) e.tags = scrubValue(e.tags);
  return event;
}
