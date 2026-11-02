/**
 * URL-slugs og datoer til de offentlige datasider (/tilbud, /butik, /kategori).
 */

/** "Hakket oksekød" → "hakket-oksekoed" (æ→ae, ø→oe, å→aa; kun a–z, 0–9 og bindestreger). */
export function slugify(text: string): string {
  return text
    .toLocaleLowerCase('da-DK')
    .replace(/æ/g, 'ae')
    .replace(/ø/g, 'oe')
    .replace(/å/g, 'aa')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export const DK_TIME_ZONE = 'Europe/Copenhagen';
const dkDate = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: DK_TIME_ZONE });

/** ISO-ugenummer (mandag–søndag) for datoen i dansk tid. Uge 1 er ugen med årets første torsdag. */
export function isoWeek(date: Date): { week: number; year: number } {
  const [y, m, d] = dkDate.format(date).split('-').map(Number) as [number, number, number];
  const day = new Date(Date.UTC(y, m - 1, d));
  const weekday = day.getUTCDay() || 7; // mandag = 1 … søndag = 7
  day.setUTCDate(day.getUTCDate() + 4 - weekday); // torsdagen i samme uge afgør året
  const yearStart = Date.UTC(day.getUTCFullYear(), 0, 1);
  return { week: Math.ceil(((day.getTime() - yearStart) / 86_400_000 + 1) / 7), year: day.getUTCFullYear() };
}

/** Kæderne på de offentlige sider – id som i databasen, slug til URL'en og navnet som kæden skriver det. */
export interface SeoStore {
  id: string;
  slug: string;
  name: string;
}

export const SEO_STORES: SeoStore[] = [
  { id: 'rema1000', slug: 'rema-1000', name: 'REMA 1000' },
  { id: 'netto', slug: 'netto', name: 'Netto' },
  { id: 'foetex', slug: 'foetex', name: 'føtex' },
  { id: 'bilka', slug: 'bilka', name: 'Bilka' },
  { id: 'lidl', slug: 'lidl', name: 'Lidl' },
];

export const seoStoreBySlug = (slug: string) => SEO_STORES.find((s) => s.slug === slug);
export const seoStoreById = (id: string) => SEO_STORES.find((s) => s.id === id);
