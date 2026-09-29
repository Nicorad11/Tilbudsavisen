import { describe, expect, it } from 'vitest';
import { conceptKey, conceptWords, extractConcepts, matchConcept, queryTokens, typoMatch } from '../src/services/concepts';

const matches = (q: string, concept: string, typing = false) =>
  matchConcept(conceptWords(concept), queryTokens(q), { typing }) > 0;

describe('varetyper fra avistitler', () => {
  it.each([
    ['MADVÆRKET Hakket oksekød', ['hakket oksekød']],
    ['Hakket okse- eller grise/kalvekød', ['hakket oksekød', 'hakket grisekød', 'hakket kalvekød']],
    ['Hakket okse/grisekød', ['hakket oksekød', 'hakket grisekød']],
    ['Kyllingebrystfilet eller -inderfilet', ['kyllingebrystfilet', 'kyllingeinderfilet']],
    [
      'MADVÆRKET Kyllingevinger, -lårfilet, -underlår eller -overlår med ryg',
      ['kyllingevinger', 'kyllingelårfilet', 'kyllingeunderlår', 'kyllingeoverlår'],
    ],
    ['STEFF HOULBERG Hotdog-, grill- eller bayerske pølser', ['hotdogpølser', 'grillpølser', 'bayerske pølser']],
    ['DULANO Hotdog-, eller bayerske pølser', ['hotdogpølser', 'bayerske pølser']],
    ['REMA 1000 Okse- eller hønsekødssuppe', ['oksesuppe', 'hønsekødssuppe']],
    ['DANISH CROWN Hakket oksekød med 35 % grøntsager', ['hakket oksekød']],
    ['Grønlandske rejer, gravad, kold- eller varmrøget laks', ['grønlandske rejer', 'gravad', 'koldrøget laks', 'varmrøget laks']],
    ['Dava danske frilandsæg', ['frilandsæg']],
    ["Stryhn's Leverpostej", ['leverpostej']],
    ['Tuborg eller Carlsberg øl', ['øl']],
    ['Laks med røræg og asparges', ['laks']],
    ['Is i bæger', ['is']],
    ['Ølmarked', []],
    ['Luksus julefrokost', []],
  ])('%s', (title, expected) => {
    expect(extractConcepts(title)).toEqual(expected);
  });

  it('samler ental og flertal', () => {
    expect(conceptKey('laksefileter')).toBe(conceptKey('laksefilet'));
    expect(conceptKey('bananer')).toBe(conceptKey('banan'));
    expect(conceptKey('pølser')).toBe(conceptKey('pølse'));
  });
});

describe('matching', () => {
  it('rammer ordstart og sammensatte ord', () => {
    expect(matches('okse', 'hakket oksekød')).toBe(true);
    expect(matches('hakket gris', 'hakket grisekød')).toBe(true);
    expect(matches('æg', 'skrabeæg')).toBe(true);
    expect(matches('mælk', 'kakaomælk')).toBe(true);
    expect(matches('tomater', 'tomat')).toBe(true);
  });

  it('undgår falske venner', () => {
    expect(matches('æg', 'pålæg')).toBe(false);
    expect(matches('ost', 'leverpostej')).toBe(false);
    expect(matches('ost', 'burger boost')).toBe(false);
    expect(matches('is', 'hakket gris')).toBe(false);
    expect(matches('is', 'islandsk torsk')).toBe(false);
    expect(matches('svin', 'multi vinkelmåler')).toBe(false);
  });

  it('forstår at svin og gris er det samme – men ikke grissini', () => {
    expect(matches('svin', 'hakket grisekød')).toBe(true);
    expect(matches('svin', 'mørbrad gris')).toBe(true);
    expect(matches('svin', 'grissini')).toBe(false);
  });

  it('lader et kort ord være et præfiks, mens man skriver', () => {
    expect(matches('ok', 'hakket oksekød')).toBe(false);
    expect(matches('ok', 'hakket oksekød', true)).toBe(true);
  });

  it('retter stavefejl som sidste udvej', () => {
    expect(typoMatch(['kaffe'], queryTokens('kafe'))).toBeGreaterThan(0);
    expect(typoMatch(['bandana'], queryTokens('banan'))).toBe(0);
  });
});
