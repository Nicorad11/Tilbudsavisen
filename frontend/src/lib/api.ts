import type { ApiErrorCode, AuthResponse } from '@tilbudsradar/shared';
import { useAuth } from './store';

const BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? '';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: unknown,
    /** Fx PLAN_REQUIRED – så betalingsmuren kan vises. */
    readonly code?: ApiErrorCode,
  ) {
    super(message);
  }
}

/** Fejl der betyder "kræver konto eller abonnement" – vis betalingsmuren i stedet for en fejl. */
export const isPaywallError = (err: unknown): err is ApiError =>
  err instanceof ApiError && (err.code === 'PLAN_REQUIRED' || err.code === 'ACCOUNT_REQUIRED');

type Query = Record<string, string | number | boolean | undefined | null | string[]>;

function buildUrl(path: string, query?: Query): string {
  const url = new URL(`${BASE}/api${path}`, window.location.origin);
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)) continue;
    url.searchParams.set(k, Array.isArray(v) ? v.join(',') : String(v));
  }
  return BASE ? url.toString() : `${url.pathname}${url.search}`;
}

let refreshing: Promise<boolean> | null = null;

/** Forsøger at forny access token via refresh-cookien (deles af samtidige kald). */
export function refreshSession(): Promise<boolean> {
  refreshing ??= (async () => {
    try {
      const res = await fetch(buildUrl('/auth/refresh'), { method: 'POST', credentials: 'include' });
      if (!res.ok || res.status === 204) {
        useAuth.getState().clear();
        return false;
      }
      const body = (await res.json()) as AuthResponse;
      useAuth.getState().setAuth(body.accessToken, body.user);
      return true;
    } catch {
      return false;
    } finally {
      useAuth.getState().markChecked();
      setTimeout(() => (refreshing = null), 0);
    }
  })();
  return refreshing;
}

export async function api<T>(
  path: string,
  opts: { method?: string; body?: unknown; query?: Query; auth?: boolean; signal?: AbortSignal } = {},
): Promise<T> {
  // Billeder (kvitteringer) sendes som rå data med deres egen Content-Type.
  const blob = opts.body instanceof Blob ? opts.body : null;
  const doFetch = () => {
    const token = useAuth.getState().accessToken;
    return fetch(buildUrl(path, opts.query), {
      method: opts.method ?? 'GET',
      credentials: 'include',
      signal: opts.signal,
      headers: {
        ...(blob ? { 'Content-Type': blob.type || 'application/octet-stream' } : {}),
        ...(opts.body !== undefined && !blob ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: blob ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
    });
  };

  let res = await doFetch();
  if (res.status === 401 && opts.auth !== false && !path.startsWith('/auth/')) {
    if (await refreshSession()) res = await doFetch();
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const data = text ? (JSON.parse(text) as unknown) : undefined;
  if (!res.ok) {
    const err = data as { error?: string; details?: unknown; code?: ApiErrorCode } | undefined;
    throw new ApiError(res.status, err?.error ?? `Fejl ${res.status}`, err?.details, err?.code);
  }
  return data as T;
}

/**
 * Sørger for en session før brugerdata hentes: refresh-cookien forsøges.
 * Der oprettes ikke længere gæster – betalte funktioner kræver en konto,
 * så uden session vises betalingsmuren (ACCOUNT_REQUIRED).
 */
export async function ensureSession(): Promise<void> {
  if (useAuth.getState().accessToken) return;
  if (await refreshSession()) return;
  throw new ApiError(401, 'Opret en gratis konto eller log ind for at bruge denne funktion.', undefined, 'ACCOUNT_REQUIRED');
}

export async function authed<T>(path: string, opts: Parameters<typeof api>[1] = {}): Promise<T> {
  await ensureSession();
  return api<T>(path, opts);
}
