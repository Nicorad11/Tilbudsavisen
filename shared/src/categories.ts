/**
 * Fælles kategorier for alle kæder. Scrapere mapper deres egne kategorier
 * (eller produktnavne via nøgleord) ind i disse id'er.
 */
export const CATEGORIES = [
  { id: 'kod-fisk', label: 'Kød & fisk', icon: 'beef' },
  { id: 'mejeri', label: 'Mejeri & æg', icon: 'milk' },
  { id: 'frugt-gront', label: 'Frugt & grønt', icon: 'apple' },
  { id: 'brod', label: 'Brød & bageri', icon: 'croissant' },
  { id: 'frost', label: 'Frost', icon: 'snowflake' },
  { id: 'kolonial', label: 'Kolonial', icon: 'wheat' },
  { id: 'drikkevarer', label: 'Drikkevarer', icon: 'cup-soda' },
  { id: 'snacks', label: 'Snacks & slik', icon: 'candy' },
  { id: 'husholdning', label: 'Husholdning', icon: 'spray-can' },
  { id: 'pleje', label: 'Personlig pleje', icon: 'sparkles' },
  { id: 'baby', label: 'Baby & børn', icon: 'baby' },
  { id: 'dyr', label: 'Dyr', icon: 'paw-print' },
  { id: 'elektronik', label: 'Elektronik', icon: 'monitor-smartphone' },
  { id: 'bolig-have', label: 'Bolig, have & byg', icon: 'hammer' },
  { id: 'tekstil', label: 'Tøj & tekstil', icon: 'shirt' },
  { id: 'andet', label: 'Andet', icon: 'shapes' },
] as const;

export type CategoryId = (typeof CATEGORIES)[number]['id'];

export const CATEGORY_IDS = CATEGORIES.map((c) => c.id) as CategoryId[];

export const FOOD_CATEGORIES: CategoryId[] = [
  'kod-fisk',
  'mejeri',
  'frugt-gront',
  'brod',
  'frost',
  'kolonial',
  'drikkevarer',
  'snacks',
];

/**
 * Kategorier der er skåret fra for nu – appen fokuserer på dagligvarer.
 * Tilbud i disse kategorier gemmes ikke (de rå data bevares, så de kan
 * genskabes med `npm run reprocess`). Fjern et id her for at slå det til igen.
 */
export const PAUSED_CATEGORIES: CategoryId[] = ['bolig-have', 'elektronik'];

export const VISIBLE_CATEGORIES = CATEGORIES.filter((c) => !PAUSED_CATEGORIES.includes(c.id));

export function isPausedCategory(id: string): boolean {
  return (PAUSED_CATEGORIES as string[]).includes(id);
}

export function categoryLabel(id: string): string {
  return CATEGORIES.find((c) => c.id === id)?.label ?? 'Andet';
}

export function isCategoryId(value: unknown): value is CategoryId {
  return typeof value === 'string' && (CATEGORY_IDS as string[]).includes(value);
}
