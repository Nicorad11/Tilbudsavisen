import type { BaseUnit } from '@tilbudsradar/shared';
import { sizeKey } from './units';

/**
 * Kendte mærker. Fjernes fra det normaliserede navn, så "Arla Mælk 1L" og
 * "Mælk, 1 liter, Arla" ender som samme nøgle ("mælk 1l"). Mærket gemmes
 * separat, så det stadig kan vises og søges på.
 */
export const KNOWN_BRANDS = [
  'rema 1000', 'rema', 'netto', 'føtex', 'bilka', 'salling', 'lidl', 'coop', '365discount', 'kvickly',
  'first price', 'princip', 'budget', 'favorit', 'euroshopper', 'änglamark', 'xtra', 'x-tra', 'irma',
  'milbona', 'chef select', 'deluxe', 'cien', 'formil', 'w5', 'crivit', 'parkside', 'silvercrest', 'livarno',
  'arla', 'lurpak', 'thise', 'naturmælk', 'øllingegaard', 'mammen', 'castello', 'riberhus', 'gram slot',
  'tulip', 'danish crown', 'friland', 'rokkedahl', 'lundsgaard', 'hanegal', 'gøl', 'steff houlberg',
  'schulstad', 'kohberg', 'hatting', 'lantmännen', 'coca-cola', 'coca cola', 'pepsi', 'faxe kondi',
  'carlsberg', 'tuborg', 'harboe', 'royal unibrew', 'jolly', 'naturli', "naturli'", 'alpro', 'oatly',
  'kims', 'estrella', 'haribo', 'toms', 'anthon berg', 'marabou', 'ritter sport', 'lays', 'pringles',
  'knorr', 'maggi', 'heinz', 'kelloggs', "kellogg's", 'nestlé', 'nescafé', 'nescafe', 'bki', 'merrild',
  'gevalia', 'zoégas', 'lavazza', 'barilla', 'dolmio', 'uncle bens', "ben's original", 'santa maria',
  'k-salat', 'graasten', 'stryhns', 'beauvais', 'bähncke', 'urtekram', 'ota', 'quaker', 'kupper',
  'libero', 'pampers', 'neutral', 'omo', 'ariel', 'persil', 'blumøller', 'colgate', 'zendium', 'dove',
  'nivea', 'gillette', 'lambi', 'lotus', 'finish', 'fairy', 'yes', 'vanish', 'whiskas', 'pedigree',
  'felix', 'royal canin', 'vallø', 'hjem-is', 'premier is', 'magnum', 'ben & jerrys', 'rønbjerg',
  'jensens køkken', 'dr. oetker', 'dr oetker', 'findus', 'frosta', 'vitasia', 'polar seafood', 'lerøy',
  'humlum', 'mou', 'løgismose', 'aarstiderne', 'søbogaard', 'ganer', 'øgo', 'pågen', 'peter larsen',
  'café noir', 'matilde', 'cheasy', 'gestus', 'kærgården', 'becel', 'dansukker', 'nutramino', 'fanta', 'sprite',
  'schweppes', 'nikoline', "aqua d'or", 'kildevæld', 'rynkeby', 'cocio', 'galle & jessen', 'royal', 'coop 365',
  'wasa', 'göteborgs', 'karen volf',
];

const BRANDS_SORTED = [...KNOWN_BRANDS].sort((a, b) => b.length - a.length);

/** Almindelige forkortelser i danske avis-/webshoptekster. */
const ABBREVIATIONS: Record<string, string> = {
  hk: 'hakket',
  hakkede: 'hakket',
  hakket: 'hakket',
  øko: 'økologisk',
  økol: 'økologisk',
  økologiske: 'økologisk',
  kyl: 'kylling',
  kyllinge: 'kylling',
  svinek: 'svinekød',
  oksek: 'oksekød',
  okse: 'oksekød',
  grise: 'gris',
  grisekød: 'svinekød',
  mlk: 'mælk',
  letmaelk: 'letmælk',
  sødmaelk: 'sødmælk',
  frugtyog: 'frugtyoghurt',
  bl: 'blandet',
  ass: 'assorteret',
  u: 'uden',
};

const STOP_WORDS = new Set([
  'eller', 'og', 'med', 'i', 'pr', 'ca', 'af', 'fra', 'til', 'flere', 'varianter', 'variant', 'valgfri',
  'udvalgte', 'udvalgt', 'div', 'diverse', 'frit', 'valg', 'mellem', 'ex', 'pant', 'max', 'min', 'str',
  'stk', 'styk', 'pk', 'pakke', 'pakker', 'assorteret', 'sorter', 'sorteret', 'en', 'et', 'the', 'de',
  'dansk', 'danske', 'danskt', 'partivare', 'dybfrost', 'dybfrossen', 'dybfrosne', 'frossen', 'frosne',
  'ny', 'nye', 'ved', 'køb', 'op', 'kun', 'lige', 'nu', 'fx', 'bl', 'a', 'mv',
]);

const QTY_TOKEN_RE =
  /(?:\d+\s*[x×]\s*)?(?:\d+(?:[.,]\d+)?|½|¼|¾)(?:\s*[-–]\s*(?:\d+(?:[.,]\d+)?))?\s*(?:kg|kilo|gram|gr|g|mg|liter|ltr|l|ml|cl|dl|stk|styk|pcs|rl|par|pk)\b\.?/gi;

export function basicClean(text: string): string {
  return text
    .normalize('NFC')
    .toLowerCase()
    .replace(/&/g, ' og ')
    .replace(/[’'`´]/g, '')
    .replace(/[^\p{L}\p{N}%\-\s.,/]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Versaler der ikke er mærker, selvom de står forrest ("LED pære", "TV 55\""). */
const CAPS_NOT_BRAND = new Set(['tv', 'led', 'usb', 'xl', 'xxl', 'bbq', 'diy', 'hdmi', 'oled', 'qled', 'pc', 'gps', 'dab', 'uv', 'ok', 'pr', 'max']);

/**
 * Mange kæder (fx Lidl) skriver mærket med versaler forrest:
 * "MADVÆRKET Hakket oksekød" → mærke "madværket", rest "Hakket oksekød".
 */
export function splitLeadingBrand(text: string): { brand: string | null; rest: string } {
  const m = text.match(/^\s*((?:[\p{Lu}\p{N}][\p{Lu}\p{N}&'’./+-]*\s+)+)(?=\p{Lu}?\p{Ll})/u);
  const raw = m?.[1]?.trim();
  if (!m || !raw) return { brand: null, rest: text };
  const brand = raw.toLocaleLowerCase('da-DK');
  if (!/\p{Lu}{2,}/u.test(raw) || CAPS_NOT_BRAND.has(brand) || /\d\s*(?:kg|g|l|ml|cl|stk)\b/i.test(raw)) {
    return { brand: null, rest: text };
  }
  return { brand, rest: text.slice(m[0].length) };
}

export function detectBrand(text: string): string | null {
  const t = ` ${basicClean(text)} `;
  for (const brand of BRANDS_SORTED) {
    if (t.includes(` ${brand} `) || t.includes(` ${brand},`) || t.includes(` ${brand}.`)) return brand;
  }
  return splitLeadingBrand(text).brand;
}

function stripBrands(text: string): string {
  let t = ` ${text} `;
  for (const brand of BRANDS_SORTED) {
    t = t.split(` ${brand} `).join(' ');
  }
  return t.trim();
}

/** Ord der alene ikke beskriver en vare ("Coca-Cola eller Tuborg Classic"). */
const GENERIC_WORDS = new Set(['classic', 'original', 'light', 'zero', 'max', 'gold', 'premium', 'extra', 'special',
  'mini', 'maxi', 'plus', 'sukkerfri', 'free', 'lys', 'mørk', 'økologisk', 'vegansk', 'glutenfri', 'laktosefri']);

function words(t: string): string[] {
  const list = t
    .split(' ')
    .map((w) => w.replace(/^-+|-+$/g, ''))
    .filter(Boolean)
    .map((w) => ABBREVIATIONS[w] ?? w)
    .filter((w) => !STOP_WORDS.has(w) && !/^\d+$/.test(w));
  // Fjern dubletter men bevar rækkefølgen.
  return [...new Set(list)];
}

/**
 * Kernenavn uden mærke, mængde og fyldord – bruges til fuzzy matching.
 * "REMA 1000 Hakket dansk oksekød 8-12%, 500 g" → "hakket oksekød 8-12%"
 */
export function coreName(text: string): string {
  const { rest } = splitLeadingBrand(text);
  const cleaned = ` ${basicClean(rest).replace(QTY_TOKEN_RE, ' ').replace(/[.,/]/g, ' ').replace(/\s+/g, ' ')} `;
  const core = words(stripBrands(cleaned));
  // Består resten kun af generiske ord, er mærket selve varen ("Coca-Cola Classic").
  if (core.every((w) => GENERIC_WORDS.has(w))) {
    const withBrands = words(cleaned);
    if (withBrands.length > core.length) return withBrands.join(' ');
  }
  return core.join(' ');
}

/** Normaliseret produktnavn inkl. størrelse, fx "mælk 1l". */
export function normalizeProductName(
  text: string,
  quantity?: { unit: BaseUnit; amount: number } | null,
): string {
  const core = coreName(text) || basicClean(text);
  return quantity && quantity.amount > 0 ? `${core} ${sizeKey(quantity.unit, quantity.amount)}` : core;
}

/** "HK. OKSE 8-12%" → "Hk. okse 8-12%" */
export function sentenceCase(text: string): string {
  const lower = text.toLocaleLowerCase('da-DK').replace(/\s+/g, ' ').trim();
  return lower.charAt(0).toLocaleUpperCase('da-DK') + lower.slice(1);
}
