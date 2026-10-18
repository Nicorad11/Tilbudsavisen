import { lazy, type ComponentType } from 'react';

/**
 * Nye versioner af appen: Vite giver kodefilerne nye navne ved hvert build, og
 * serveren har kun den nyeste version. En fane, der har stået åben siden før
 * en deploy, kan derfor ikke hente de dele af appen, den ikke har brugt endnu.
 * Så henter vi siden igen – højst én gang pr. 30 sekunder, så en reel fejl
 * ikke giver en uendelig løkke.
 */
const KEY = 'tr:reload';
const MIN_INTERVAL_MS = 30_000;

/** Fejlbeskeder fra Safari, Chrome og Firefox, når en kodefil ikke kan hentes. */
export function isChunkLoadError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /Importing a module script failed|Failed to fetch dynamically imported module|error loading dynamically imported module|Unable to preload CSS/i.test(
    message,
  );
}

/** Genindlæser siden for at få den nye version. Returnerer false, hvis det lige er sket. */
export function reloadForNewVersion(): boolean {
  try {
    const last = Number(sessionStorage.getItem(KEY) ?? 0);
    if (Date.now() - last < MIN_INTERVAL_MS) return false;
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch {
    return false; // uden sessionStorage kan vi ikke undgå en løkke – vis fejlsiden i stedet
  }
  window.location.reload();
  return true;
}

/** React.lazy, der henter den nye version, hvis kodefilen er forsvundet efter en deploy. */
// Samme typeparameter som React.lazy, så komponenter med egne props kan bruges.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyWithReload<T extends ComponentType<any>>(load: () => Promise<{ default: T }>) {
  return lazy(() =>
    load().catch((err: unknown) => {
      // Siden genindlæses – vent i stedet for at vise en fejl imens.
      if (isChunkLoadError(err) && reloadForNewVersion()) return new Promise<never>(() => undefined);
      throw err;
    }),
  );
}

/** Vite melder også om filer, der ikke kunne hentes på forhånd (fx CSS til en side). */
export function listenForNewVersions(): void {
  window.addEventListener('vite:preloadError', (event) => {
    if (reloadForNewVersion()) event.preventDefault();
  });
}
