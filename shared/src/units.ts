import type { BaseUnit } from './scraping';

export function unitPriceLabel(unit: BaseUnit): string {
  return unit === 'stk' ? 'kr/stk' : `kr/${unit}`;
}

/** Afrunder til øre. */
export function roundKr(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Procentvis rabat fra førpris til tilbudspris, eller null. */
export function discountPct(offerPrice: number, originalPrice: number | null | undefined): number | null {
  if (!originalPrice || originalPrice <= offerPrice) return null;
  return Math.round(((originalPrice - offerPrice) / originalPrice) * 1000) / 10;
}
