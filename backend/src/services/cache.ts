/**
 * Enkel proces-cache der nulstilles, når nye tilbud er gemt (bumpDataVersion
 * kaldes fra ingest og admin). Bruges til "ugens bedste tilbud", statistik og
 * søgningens varetype-indeks.
 */
let dataVersion = 0;
const cache = new Map<string, { version: number; at: number; value: unknown }>();
const pending = new Map<string, Promise<unknown>>();

export function bumpDataVersion(): void {
  dataVersion++;
}

export async function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && hit.version === dataVersion && Date.now() - hit.at < ttlMs) return hit.value as T;
  // Samtidige kald (fx søgning mens man skriver) deler én indlæsning.
  const running = pending.get(key);
  if (running) return running as Promise<T>;
  const version = dataVersion;
  const promise = load()
    .then((value) => {
      cache.set(key, { version, at: Date.now(), value });
      return value;
    })
    .finally(() => pending.delete(key));
  pending.set(key, promise);
  return promise;
}
