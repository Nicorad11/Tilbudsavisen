import type { BaseUnit } from '@tilbudsradar/shared';

export interface ParsedQuantity {
  unit: BaseUnit;
  /** Pakningsstørrelse i basisenheden (kg, l eller stk). */
  min: number;
  max: number;
  /** Antal pakninger, fx "6 x 33 cl" → 6. */
  pieces: number;
}

/** Faktor fra enhedstekst til basisenhed. */
const UNIT_TABLE: Record<string, { unit: BaseUnit; factor: number }> = {
  mg: { unit: 'kg', factor: 1e-6 },
  g: { unit: 'kg', factor: 1e-3 },
  gr: { unit: 'kg', factor: 1e-3 },
  gram: { unit: 'kg', factor: 1e-3 },
  kg: { unit: 'kg', factor: 1 },
  kilo: { unit: 'kg', factor: 1 },
  ml: { unit: 'l', factor: 1e-3 },
  cl: { unit: 'l', factor: 1e-2 },
  dl: { unit: 'l', factor: 1e-1 },
  l: { unit: 'l', factor: 1 },
  ltr: { unit: 'l', factor: 1 },
  liter: { unit: 'l', factor: 1 },
  stk: { unit: 'stk', factor: 1 },
  styk: { unit: 'stk', factor: 1 },
  styks: { unit: 'stk', factor: 1 },
  pcs: { unit: 'stk', factor: 1 },
  rl: { unit: 'stk', factor: 1 },
  ruller: { unit: 'stk', factor: 1 },
  rulle: { unit: 'stk', factor: 1 },
  par: { unit: 'stk', factor: 1 },
  pk: { unit: 'stk', factor: 1 },
  bdt: { unit: 'stk', factor: 1 },
  bundt: { unit: 'stk', factor: 1 },
  bakke: { unit: 'stk', factor: 1 },
};

export function unitFromSymbol(symbol: string | null | undefined): { unit: BaseUnit; factor: number } | null {
  if (!symbol) return null;
  return UNIT_TABLE[symbol.toLowerCase().replace(/\.$/, '')] ?? null;
}

const NUM = String.raw`\d+(?:[.,]\d+)?|½|¼|¾`;
const UNITS = Object.keys(UNIT_TABLE)
  .sort((a, b) => b.length - a.length)
  .join('|');
// "300-400 g", "1,5 liter", "PR. ½ KG", "6 x 33 cl", "2 stk./225 g"
const QTY_RE = new RegExp(String.raw`(?:(\d+)\s*[x×]\s*)?(${NUM})(?:\s*[-–]\s*(${NUM}))?\s*(${UNITS})\.?(?![a-zæøå])`, 'gi');

export function parseNumber(raw: string): number {
  if (raw === '½') return 0.5;
  if (raw === '¼') return 0.25;
  if (raw === '¾') return 0.75;
  return Number(raw.replace(/\.(?=\d{3}\b)/g, '').replace(',', '.'));
}

/**
 * Finder pakningsstørrelsen i en fritekst. Vægt/volumen foretrækkes frem for
 * stykantal, da kr/kg og kr/l er det mest retvisende sammenligningsgrundlag.
 */
export function parseQuantity(text: string | null | undefined): ParsedQuantity | null {
  if (!text) return null;
  const candidates: ParsedQuantity[] = [];
  for (const m of text.matchAll(QTY_RE)) {
    const [, multi, a, b, sym] = m;
    const def = unitFromSymbol(sym);
    if (!def || !a) continue;
    const from = parseNumber(a) * def.factor;
    const to = b ? parseNumber(b) * def.factor : from;
    if (!Number.isFinite(from) || from <= 0) continue;
    candidates.push({
      unit: def.unit,
      min: Math.min(from, to),
      max: Math.max(from, to),
      pieces: multi ? Number(multi) : 1,
    });
  }
  if (!candidates.length) return null;
  return candidates.find((c) => c.unit !== 'stk') ?? candidates[0]!;
}

export interface UnitPrice {
  unitPrice: number | null;
  unitPriceMax: number | null;
}

export function computeUnitPrice(
  price: number,
  quantity: { min: number; max: number } | null | undefined,
  pieces = 1,
): UnitPrice {
  if (!quantity || quantity.min <= 0 || !Number.isFinite(price)) return { unitPrice: null, unitPriceMax: null };
  const p = Math.max(1, pieces);
  const avg = (quantity.min + quantity.max) / 2;
  const round = (n: number) => Math.round(n * 100) / 100;
  return {
    unitPrice: round(price / (avg * p)),
    unitPriceMax: round(price / (quantity.min * p)),
  };
}

/** "0.4 kg" → "400g", "1 l" → "1l", "6 stk" → "6stk" – bruges i normaliserede navne. */
export function sizeKey(unit: BaseUnit, amount: number): string {
  const fmt = (n: number) => String(Math.round(n * 100) / 100);
  if (unit === 'kg') return amount < 1 ? `${fmt(amount * 1000)}g` : `${fmt(amount)}kg`;
  if (unit === 'l') return amount < 1 ? `${fmt(amount * 100)}cl` : `${fmt(amount)}l`;
  return `${fmt(amount)}stk`;
}
