/**
 * Fuzzy string matching til at koble produktnavne fra forskellige kæder til
 * samme kanoniske vare. Trigram-varianten svarer til Postgres' pg_trgm, så
 * scorer beregnet i JS og i databasen kan sammenlignes.
 */

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let curr = new Array<number>(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(prev[j]! + 1, curr[j - 1]! + 1, prev[j - 1]! + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length]!;
}

/** 1 = identiske, 0 = helt forskellige. */
export function levenshteinRatio(a: string, b: string): number {
  const max = Math.max(a.length, b.length);
  return max === 0 ? 1 : 1 - levenshtein(a, b) / max;
}

export function trigrams(text: string): Set<string> {
  const set = new Set<string>();
  for (const word of text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean)) {
    const padded = `  ${word} `;
    for (let i = 0; i < padded.length - 2; i++) set.add(padded.slice(i, i + 3));
  }
  return set;
}

/** Samme definition som pg_trgm's similarity(): |A∩B| / |A∪B|. */
export function trigramSimilarity(a: string, b: string): number {
  const ta = trigrams(a);
  const tb = trigrams(b);
  if (!ta.size && !tb.size) return 1;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return shared / (ta.size + tb.size - shared);
}

const tokens = (s: string) => s.split(/\s+/).filter(Boolean);

/** Rækkefølge-uafhængig Levenshtein-ratio ("mælk arla" ≈ "arla mælk"). */
export function sortedTokenRatio(a: string, b: string): number {
  return levenshteinRatio(tokens(a).sort().join(' '), tokens(b).sort().join(' '));
}

export function tokenJaccard(a: string, b: string): number {
  const ta = new Set(tokens(a));
  const tb = new Set(tokens(b));
  if (!ta.size && !tb.size) return 1;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return shared / (ta.size + tb.size - shared);
}

/** Tal i navnet (fedtprocent, "5-pak" …) skal stemme overens for at være samme vare. */
function numbers(s: string): string {
  return (s.match(/\d+(?:[.,]\d+)?/g) ?? []).sort().join('|');
}

/**
 * Samlet matchscore 0-1 mellem to kernenavne. Bevidst konservativ: et forkert
 * match forurener prishistorikken, mens et manglende match blot giver en
 * ekstra kanonisk vare, som kan flettes via mapping-tabellen.
 */
export function matchScore(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  let score = Math.max(trigramSimilarity(a, b), sortedTokenRatio(a, b) * 0.95, tokenJaccard(a, b));
  const na = numbers(a);
  const nb = numbers(b);
  if (na !== nb && (na || nb)) score *= 0.6;
  return score;
}

/** Standardgrænse for hvornår to navne regnes for samme kanoniske vare. */
export const MATCH_THRESHOLD = 0.72;
