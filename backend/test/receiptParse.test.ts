import { readFileSync } from 'node:fs';
import path from 'node:path';
import { groupReceiptLines, sumLines } from '@tilbudsradar/shared';
import { describe, expect, it } from 'vitest';
import { cleanName, detectChain, detectDate, parseReceiptText } from '../src/services/receipts/parseText';

const fixture = (name: string) => readFileSync(path.resolve(import.meta.dirname, 'fixtures/receipts', name), 'utf8');
const chains = ['rema1000', 'netto', 'foetex', 'bilka', 'lidl'];
const now = new Date('2026-09-19T14:00:00Z');
const parse = (text: string) => parseReceiptText(text, { chains, now });
const byName = (lines: ReturnType<typeof parse>['lines'], re: RegExp) => lines.find((l) => re.test(l.name));

describe('kvitteringstekst', () => {
  it('læser en Lidl-kvittering linje for linje', () => {
    const r = parse(fixture('lidl-clean.txt'));
    expect(r.storeId).toBe('lidl');
    expect(r.purchasedAt).toBe('2026-09-19T10:18:00.000Z'); // 12:18 dansk sommertid
    expect(r.total).toBe(973.15);
    expect(r.lines).toHaveLength(46);
    expect(sumLines(r.lines)).toBe(973.15);
    expect(r.warnings).toEqual([]);

    // Vægtvare: navnet og beløbet står over vægtlinjen.
    expect(byName(r.lines, /laksefilet/)).toMatchObject({ unit: 'kg', quantity: 0.979, unitPrice: 149.9, amount: 146.75 });
    expect(byName(r.lines, /^Løg/)).toMatchObject({ quantity: 2, unitPrice: 12, amount: 24 });
    expect(byName(r.lines, /Lidl Plus/)).toMatchObject({ kind: 'discount', amount: -16.4 });
    expect(byName(r.lines, /Pant/)).toMatchObject({ kind: 'deposit', amount: 3 });

    const groups = groupReceiptLines(r.lines);
    expect(groups).toHaveLength(35);
    const melon = groups.find((g) => /Vandmelon/.test(g.item.name))!;
    expect(melon.discounts.map((d) => d.amount)).toEqual([-7]);
    const kefir = groups.find((g) => /Kefir/i.test(g.item.name))!;
    expect(kefir.discounts[0]!.name).toBe('Lidl Plus-tilbud');
  });

  it('tåler støj fra tekstgenkendelse og markerer usikre linjer', () => {
    const r = parse(fixture('lidl-ocr.txt'));
    expect(r.storeId).toBe('lidl');
    expect(r.total).toBe(973.15);
    expect(r.lines.length).toBeGreaterThanOrEqual(45);
    // "Øko.baby spinat" læst som "| 3,00": 1-tallet er faldet ud → usikker.
    expect(byName(r.lines, /spinat/)).toMatchObject({ amount: 3, uncertain: true });
    // Rabatten står der, men beløbet er ulæseligt.
    expect(r.lines.some((l) => l.kind === 'discount' && l.amount === 0 && l.uncertain)).toBe(true);
    // "18,20 x 2  253,40": antal × pris vinder over det forkert læste beløb.
    expect(byName(r.lines, /kefir/i)).toMatchObject({ quantity: 2, amount: 36.4, uncertain: true });
    // "10,00 x 3 230,00": et "=" læst som "2" rettes sikkert.
    expect(byName(r.lines, /Auberginer/)).toMatchObject({ quantity: 3, amount: 30 });
    expect(byName(r.lines, /Auberginer/)!.uncertain).toBeFalsy();
    // "6,10 x ?": antallet udledes af beløbet.
    expect(byName(r.lines, /Tomatpur/)).toMatchObject({ quantity: 2, unitPrice: 6.1, amount: 12.2 });
    // Støj foran navnene fjernes.
    expect(r.lines.map((l) => l.name)).toEqual(
      expect.arrayContaining(['Bredbladet persille', 'Skyr naturel', 'Pant C', 'Hele lår med ryg', 'Lidl Plus-tilbud']),
    );
    expect(r.warnings.some((w) => w.startsWith('Linjerne giver'))).toBe(true);
    expect(r.warnings.some((w) => /usikre/.test(w))).toBe(true);
  });

  it('finder totalen og vægtvarer i en anden aflæsning', () => {
    const r = parse(fixture('lidl-ocr-server.txt'));
    expect(r.total).toBe(973.18); // "SU  973, 18"
    // "0;079 kø x 149,90 DKK/kO" – vægten udledes af beløb og kilopris.
    expect(byName(r.lines, /laksefilet/)).toMatchObject({ unit: 'kg', quantity: 0.979 });
    expect(byName(r.lines, /Ik9/)).toMatchObject({ quantity: 2, amount: 24 });
    // Betalingslinjerne efter SUM kommer ikke med.
    expect(r.lines.some((l) => l.amount > 500)).toBe(false);
  });

  it('læser Salling-formatet med navn og beløb på hver sin linje', () => {
    const r = parse(`NETTO
Eksempelvej 1
KYLLINGEBRYST
0,512 kg x 89,95 kr/kg          46,05
LETMÆLK 1 L
2 x 12,95                       25,90
RUGBRØD                         18,00
RABAT                            5,00-
PANT A                           1,00
TOTAL                           85,95
DANKORT                         85,95
19-09-2026 12:18`);
    expect(r.storeId).toBe('netto');
    expect(r.purchasedAt).toBe('2026-09-19T10:18:00.000Z');
    expect(r.total).toBe(85.95);
    expect(r.lines).toEqual([
      { kind: 'item', name: 'KYLLINGEBRYST', quantity: 0.512, unit: 'kg', unitPrice: 89.95, amount: 46.05 },
      { kind: 'item', name: 'LETMÆLK 1 L', quantity: 2, unit: 'stk', unitPrice: 12.95, amount: 25.9 },
      { kind: 'item', name: 'RUGBRØD', quantity: 1, unit: 'stk', unitPrice: 18, amount: 18 },
      { kind: 'discount', name: 'RABAT', quantity: 1, unit: 'stk', unitPrice: null, amount: -5 },
      { kind: 'deposit', name: 'PANT A', quantity: 1, unit: 'stk', unitPrice: null, amount: 1 },
    ]);
    expect(r.warnings).toEqual([]);
  });

  it('dropper en forvansket betalingslinje når totalen mangler', () => {
    const r = parse(`LIDL
Mælk            12,00 B
Brød            20,00 B
Smør            25,00 B
Ost             40,00 B
tæent          761,65`);
    expect(r.lines.map((l) => l.name)).toEqual(['Mælk', 'Brød', 'Smør', 'Ost']);
    expect(r.warnings.some((w) => /ligner betaling/.test(w))).toBe(true);
  });

  it('genkender betalingslinjer på at de summer til varerne', () => {
    const r = parse(`LIDL
Mælk            12,00 B
Brød            20,00 B
Smør            25,00 B
Kxntxnt         30,00
Kxrt            27,00`);
    expect(r.lines.map((l) => l.name)).toEqual(['Mælk', 'Brød', 'Smør']);
    expect(r.total).toBe(57);
  });

  it('genkender kæde, dato og navne', () => {
    expect(detectChain('xx\nREMA 1000\nNetto-kupon', chains)).toBe('rema1000');
    expect(detectChain('Tak for besøget i føtex', chains)).toBe('foetex');
    expect(detectChain('Lidl', ['netto'])).toBeNull();
    expect(detectDate('Dato 02.01.26 08:05', now)).toBe('2026-01-02T07:05:00.000Z'); // vintertid
    expect(detectDate('Dato 01.12.29', now)).toBeNull(); // fremtiden
    expect(cleanName('fo:   BY   Bredbladet persille', true)).toBe('Bredbladet persille');
    expect(cleanName('på 0 Sør naturel', true)).toBe('Sør naturel');
    expect(cleanName('ÆG FRITGÅENDE', false)).toBe('ÆG FRITGÅENDE');
    expect(cleanName('Is vanilje', true)).toBe('Is vanilje');
  });
});
