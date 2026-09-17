import { describe, expect, it } from 'vitest';
import {
  MATCH_THRESHOLD,
  categorize,
  computeUnitPrice,
  coreName,
  detectBrand,
  matchScore,
  normalizeProductName,
  parseQuantity,
  splitLeadingBrand,
  trigramSimilarity,
} from '../src/normalize';

describe('parseQuantity', () => {
  it.each([
    ['400 g 72.50 pr. kg', { unit: 'kg', min: 0.4, max: 0.4, pieces: 1 }],
    ['300-400 g Partivare. Max. 40.00 pr. kg', { unit: 'kg', min: 0.3, max: 0.4, pieces: 1 }],
    ['1,5 liter', { unit: 'l', min: 1.5, max: 1.5, pieces: 1 }],
    ['PR. ½ KG Partivare', { unit: 'kg', min: 0.5, max: 0.5, pieces: 1 }],
    ['6 x 33 cl', { unit: 'l', min: 0.33, max: 0.33, pieces: 6 }],
    ['95 GR. / SNURRE', { unit: 'kg', min: 0.095, max: 0.095, pieces: 1 }],
    ['Str. M/L, 6 stk.', { unit: 'stk', min: 6, max: 6, pieces: 1 }],
  ])('%s', (text, expected) => {
    const q = parseQuantity(text)!;
    expect(q.unit).toBe(expected.unit);
    expect(q.min).toBeCloseTo(expected.min, 6);
    expect(q.max).toBeCloseTo(expected.max, 6);
    expect(q.pieces).toBe(expected.pieces);
  });

  it('foretrækker vægt frem for stykantal', () => {
    expect(parseQuantity('2 stk./225 g Partivare')).toMatchObject({ unit: 'kg', min: 0.225 });
  });

  it('forveksler ikke ord med enheder', () => {
    expect(parseQuantity('12 gange bedre')).toBeNull();
    expect(parseQuantity('REMA 1000 lasagne')).toBeNull();
  });
});

describe('computeUnitPrice', () => {
  it('beregner kr/kg ud fra gennemsnit og worst case', () => {
    expect(computeUnitPrice(35, { min: 0.75, max: 1.3 })).toEqual({ unitPrice: 34.15, unitPriceMax: 46.67 });
  });
  it('tager højde for antal pakninger', () => {
    expect(computeUnitPrice(50, { min: 0.5, max: 0.5 }, 2)).toEqual({ unitPrice: 50, unitPriceMax: 50 });
  });
  it('returnerer null uden mængde', () => {
    expect(computeUnitPrice(10, null)).toEqual({ unitPrice: null, unitPriceMax: null });
  });
});

describe('normalizeProductName', () => {
  it('matcher samme vare på tværs af kæders skrivemåde', () => {
    const a = normalizeProductName('Arla Mælk 1L', { unit: 'l', amount: 1 });
    const b = normalizeProductName('Mælk, 1 liter, Arla', { unit: 'l', amount: 1 });
    expect(a).toBe('mælk 1l');
    expect(b).toBe(a);
  });

  it('fjerner mærker, mængder og fyldord', () => {
    expect(coreName('REMA 1000 Hakket dansk oksekød 8-12%, 500 g')).toBe('hakket oksekød 8-12%');
    expect(coreName('HK. OKSE 8-12%')).toBe('hakket oksekød 8-12%');
  });

  it('genkender versal-mærker forrest (Lidl-stil)', () => {
    expect(splitLeadingBrand('MADVÆRKET Hakket oksekød')).toEqual({ brand: 'madværket', rest: 'Hakket oksekød' });
    expect(splitLeadingBrand('COCA-COLA/FANTA Sodavand').brand).toBe('coca-cola/fanta');
    expect(splitLeadingBrand('LED pære').brand).toBeNull();
    expect(splitLeadingBrand('HK. OKSE 8-12%').brand).toBeNull();
    expect(splitLeadingBrand('KiMs chips').brand).toBeNull();
    expect(coreName('HENRIETTELUND Skrabeæg')).toBe('skrabeæg');
    expect(detectBrand('SÆBY Makrelfilet i tomat')).toBe('sæby');
  });

  it('beholder mærket når resten kun er generiske ord', () => {
    expect(coreName('Coca-Cola eller Tuborg Classic')).toBe('coca-cola tuborg classic');
    expect(coreName('Lavazza Qualità Rossa')).toBe('qualità rossa');
  });

  it('finder mærket', () => {
    expect(detectBrand('Tulip Spareribs, pulled pork')).toBe('tulip');
    expect(detectBrand('REMA 1000 Yoghurt')).toBe('rema 1000');
    expect(detectBrand('Hakket oksekød')).toBeNull();
  });
});

describe('categorize', () => {
  it.each([
    ['REMA 1000 Dansk kyllingebrystfilet eller -inderfilet', 'kod-fisk'],
    ['Rønbjerg flødeis', 'frost'],
    ['Saftig kylling', 'kod-fisk'],
    ['KiMs chips eller snacks', 'snacks'],
    ['Tuborg eller Carlsberg øl', 'drikkevarer'],
    ['Gram Slot Letmælk eller sødmælk', 'mejeri'],
    ['Gram Slot Kartofler', 'frugt-gront'],
    ['Humlum Tærtedej, pizzadej eller pølsehornsdej', 'kolonial'],
    ['REMA 1000 Burgerboller, pølse- eller hotdogbrød', 'brod'],
    ['Persille', 'frugt-gront'],
    ['Whiskas kattemad med kylling', 'dyr'],
    ['Samsung 55" QLED TV', 'elektronik'],
    ['Bosch boremaskine 18V', 'bolig-have'],
    ['Colgate tandpasta', 'pleje'],
    ['SILVERCREST Køkkenmaskine', 'elektronik'],
    ['AEG Induktionskogeplade', 'elektronik'],
    ['Sodastream Art sodavandsmaskine', 'elektronik'],
    ['Lammeroast med hvidløgssmør', 'kod-fisk'],
    ['Buko Reje- eller skinkeost', 'mejeri'],
    ['Rosti Margrethe skålesæt eller osteboks', 'bolig-have'],
    ['Smørrebrød', 'brod'],
    ['Dansk spidskål', 'frugt-gront'],
    ['Kål', 'frugt-gront'],
    ['Frosne ærter', 'frost'],
    ['Æblemost', 'drikkevarer'],
  ])('%s → %s', (title, expected) => {
    expect(categorize(title)).toBe(expected);
  });

  it('bruger beskrivelsen som fallback og tvungen kategori først', () => {
    expect(categorize('Findus Familiens Favorit', { secondary: 'Dybfrost 500 g' })).toBe('frost');
    expect(categorize('Ukendt vare', { fallback: 'elektronik' })).toBe('elektronik');
    expect(categorize('Chips', { forced: 'baby' })).toBe('baby');
  });
});

describe('matchScore', () => {
  it('matcher identiske og omrokerede navne', () => {
    expect(matchScore('mælk', 'mælk')).toBe(1);
    expect(matchScore('letmælk økologisk', 'økologisk letmælk')).toBeGreaterThanOrEqual(MATCH_THRESHOLD);
  });

  it('tåler små stavefejl', () => {
    expect(matchScore('hakket oksekød', 'hakket oksekøb')).toBeGreaterThanOrEqual(MATCH_THRESHOLD);
  });

  it('holder varianter adskilt', () => {
    expect(matchScore('mælk', 'mælk økologisk')).toBeLessThan(MATCH_THRESHOLD);
    expect(matchScore('hakket oksekød 8-12%', 'hakket oksekød 4-7%')).toBeLessThan(MATCH_THRESHOLD);
    expect(matchScore('bananer', 'kyllingebryst')).toBeLessThan(0.3);
  });

  it('trigram-lighed svarer til pg_trgm', () => {
    // pg_trgm: similarity('word', 'two words') = 0.36363637
    expect(trigramSimilarity('word', 'two words')).toBeCloseTo(0.3636, 3);
  });
});
