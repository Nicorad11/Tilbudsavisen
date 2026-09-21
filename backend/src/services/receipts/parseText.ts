import type { ParsedReceipt, ReceiptLine, ReceiptSource } from '@tilbudsradar/shared';
import { sumLines } from '@tilbudsradar/shared';

/**
 * Tolker teksten fra en dansk kvittering – enten fra tekstgenkendelse (med
 * støj fra kanten af billedet, "B" læst som "8" osv.) eller indsat fra en
 * e-kvittering. Formater der dækkes:
 *
 *   Lidl:     "Løg 1kg          12,00 x 2   24,00 B"
 *             "Hel laksefilet               146,75 B"
 *             "0,979 kg x 149,90 DKK/kg"
 *             "Rabat                        -7,00"
 *   Salling:  "KYLLINGEBRYST"  +  "2 x 24,95    49,90"
 *             "0,512 kg x 89,95 kr/kg       46,05"
 *   REMA:     "RABAT                        5,00-"
 *
 * Alt der ikke kan læses sikkert markeres `uncertain`, så brugeren kan rette
 * det, før kvitteringen tjekkes.
 */

const r2 = (n: number) => Math.round(n * 100) / 100;

/* ------------------------------------------------------------------ */
/* Kæde og dato                                                       */
/* ------------------------------------------------------------------ */

const CHAIN_PATTERNS: [string, RegExp][] = [
  ['lidl', /\bl[i1l|!]dl\b/i],
  ['rema1000', /\brema(?:\s*1000)?\b/i],
  ['netto', /\bnetto\b/i],
  ['foetex', /\bf[øo]tex\b/i],
  ['bilka', /\bbilka\b/i],
];

/** Kæden der nævnes først (logoet/overskriften står øverst). */
export function detectChain(text: string, allowed: readonly string[]): string | null {
  let best: { id: string; at: number } | null = null;
  for (const [id, re] of CHAIN_PATTERNS) {
    if (!allowed.includes(id)) continue;
    const m = re.exec(text);
    if (m && (!best || m.index < best.at)) best = { id, at: m.index };
  }
  return best?.id ?? null;
}

/** Lokal dansk tid → ISO (UTC). Tager højde for sommertid. */
export function copenhagenToIso(y: number, mo: number, d: number, h = 12, mi = 0): string {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const part = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Copenhagen', timeZoneName: 'shortOffset' })
    .formatToParts(new Date(guess))
    .find((p) => p.type === 'timeZoneName')?.value;
  const offset = Number(part?.match(/GMT([+-]\d+)/)?.[1] ?? 1);
  return new Date(guess - offset * 3_600_000).toISOString();
}

/** "2026-09-19T12:18" (lokal tid) → ISO. Bruges også til Claudes svar. */
export function localDateTimeToIso(value: string | null | undefined): string | null {
  const m = value?.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
  if (!m) return null;
  const [y, mo, d, h, mi] = [m[1], m[2], m[3], m[4], m[5]].map((v) => (v === undefined ? undefined : Number(v)));
  if (!y || !mo || !d || mo > 12 || d > 31) return null;
  return copenhagenToIso(y, mo, d, h ?? 12, mi ?? 0);
}

export function detectDate(text: string, now = new Date()): string | null {
  const re = /(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4}|\d{2})(?:\D{1,12}?(\d{1,2})[:.](\d{2}))?/g;
  for (const m of text.matchAll(re)) {
    const d = Number(m[1]);
    const mo = Number(m[2]);
    let y = Number(m[3]);
    if (y < 100) y += 2000;
    if (d < 1 || d > 31 || mo < 1 || mo > 12 || y < 2020) continue;
    const h = m[4] === undefined ? 12 : Number(m[4]);
    const mi = m[5] === undefined ? 0 : Number(m[5]);
    if (h > 23 || mi > 59) continue;
    const iso = copenhagenToIso(y, mo, d, h, mi);
    // En kvittering kan ikke være fra fremtiden (små ure-forskelle tolereres).
    if (new Date(iso).getTime() > now.getTime() + 36 * 3_600_000) continue;
    return iso;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Beløb                                                              */
/* ------------------------------------------------------------------ */

// Et beløb: "146,75", "-7,00", "5,00-", "1.234,50". Et "8" lige efter decimalerne
// er næsten altid momskoden "B" læst forkert ("14,008" = "14,00 B").
// "973, 18": tekstgenkendelsen sætter nogle gange et mellemrum efter kommaet.
const AMOUNT_RE = /(-\s?|−\s?)?(\d{1,5}(?:\.\d{3})*(?:[,.]\d{1,2}|,\s\d{2}(?!\d)))([83](?![\d,]))?(\s?-(?!\d))?/g;
// "12,00 x 2" og "12,00. x 2"
const QTY_AFTER_RE = /(\d{1,4}[,.]\d{2})\.?\s*[xX×*]\s*(\d{1,3})(?!\d|[,.]\d)/;
const QTY_BEFORE_RE = /^\s*(\d{1,3})\s*(?:stk\.?|st\.?)?\s*[xX×*]\s*(\d{1,4}[,.]\d{2})/i; // "2 x 12,95"
// "0,979 kg x 149,90 DKK/kg" – "kg" læses tit som "kø", "k9" eller "ka".
// (\b virker ikke efter "ø" i JavaScript, derfor et eksplicit lookahead.)
const WEIGHT_RE = /(\d+(?:[,.]\d+)?)?\s*k[gq9aøo0](?![\p{L}\d])\.?\s*[xX×*]\s*(\d{1,4}[,.]\d{2})\s*(?:dkk|kr)?\.?\s*\/\s*k/iu;
const UNIT_TIMES_RE = /(\d{1,4}[,.]\d{2})\.?\s*[xX×*]\s*\S{0,2}\s*$/; // "6,10 x ?" – antallet er ulæseligt

const num = (s: string) => Number(s.replace(/\s/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.'));

interface Amount {
  value: number;
  /** Kun én decimal læst ("19,9") – det rigtige beløb kan være 19,90 eller 19,95. */
  shaky: boolean;
  /** Hvor beløbet (inkl. fortegn) starter og slutter i linjen. */
  index: number;
  end: number;
  raw: string;
}

/** Linjens beløb = det sidste beløb, hvis der ikke står flere beløb efter det. */
function lastAmount(line: string): Amount | null {
  let last: Amount | null = null;
  for (const m of line.matchAll(AMOUNT_RE)) {
    const digits = m[2]!;
    const negative = Boolean(m[1] || m[4]);
    const value = num(digits) * (negative ? -1 : 1);
    last = { value, shaky: /[,.]\d$/.test(digits), index: m.index, end: m.index + m[0].length, raw: digits };
  }
  if (!last || /\d[,.]\d/.test(line.slice(last.end))) return null;
  return last;
}

/* ------------------------------------------------------------------ */
/* Navne                                                              */
/* ------------------------------------------------------------------ */

const letters = (t: string) => (t.match(/\p{L}/gu) ?? []).length;
const isUpperWord = (t: string) => letters(t) > 0 && t === t.toLocaleUpperCase('da-DK');
const startsUpper = (t: string) => /^\p{Lu}/u.test(t);

/**
 * Fjerner støj fra venstre kant: enkelte bogstaver, tal og tegn som
 * tekstgenkendelsen har fundet i baggrunden eller på en tommelfinger.
 */
export function cleanName(raw: string, mixedCase: boolean): string {
  const tokens = raw
    .replace(/[“”"'’`´|]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  while (tokens.length > 1) {
    const t = tokens[0]!;
    const n = letters(t);
    const hasDigit = /\d/.test(t);
    const nextWord = tokens.slice(1).find((x) => letters(x) >= 3 && !/[:;!<>=+_\\]/.test(x));
    if (n === 0) {
      tokens.shift();
    } else if (n <= 3 && /\p{Ll}\p{Lu}/u.test(t)) {
      // "aL", "tØk": små bogstaver før store findes ikke i varenavne.
      tokens.shift();
    } else if (n === 1 && !hasDigit) {
      tokens.shift();
    } else if (n <= 2 && /[:;!<>=+_\\]/.test(t)) {
      tokens.shift();
    } else if (n === 2 && !hasDigit && mixedCase && nextWord) {
      // "BY Bredbladet", "HE utturaketir", "på Sør naturel": to bogstaver foran et rigtigt ord.
      const drop = isUpperWord(t) ? !isUpperWord(nextWord) : !startsUpper(t) && startsUpper(nextWord);
      if (!drop) break;
      tokens.shift();
    } else {
      break;
    }
  }
  return tokens
    .join(' ')
    .replace(/\s+[^\p{L}\p{N}%)]+$/u, '')
    .replace(/[\s,.;:+>=-]+$/, '')
    .trim();
}

const DISCOUNT_RE =
  /^(?:(?:ra)?bat\b|rabat|lidl\s*plus|plus[- ]?(?:tilbud|rabat|pris)|mængderabat|kupon|rabatkupon|bonus|medlemsrabat|tilbud\b|kampagne|nedslag|prisnedsættelse)/i;
/** Rabattens navn, selv med støj foran: "Er Lidl Plus-tilbud" → "Lidl Plus-tilbud". */
const DISCOUNT_NAME_RE =
  /lidl\s*plus[- ]?\p{L}*|plus[- ]?(?:tilbud|rabat|pris)|mængderabat|rabatkupon|kupon|medlemsrabat|rabat|(?<!\p{L})bat\b/iu;
const DEPOSIT_RE = /\bpant\b/i;
const TOTAL_RE = /^(?:sum?|total|totalt|i\s*alt|at\s*betale|til\s*betaling|beløb\s*i\s*alt)\b/i;
const STOP_RE =
  /^(?:kontant|kort|dankort|visa|mastercard|maestro|mobilepay|byttepenge|retur|betalt|kortholders|bonuskunde|moms)\b|\bmoms\b|\bink\.|\binkl\.|momsgrundlag/i;

/* ------------------------------------------------------------------ */
/* Tolkning                                                           */
/* ------------------------------------------------------------------ */

export interface ParseOptions {
  chains: readonly string[];
  source?: ReceiptSource;
  now?: Date;
}

export function parseReceiptText(text: string, opts: ParseOptions): ParsedReceipt {
  const rawLines = text
    .replace(/\r/g, '')
    .split('\n')
    .map((l) => l.replace(/\t/g, '   ').trimEnd())
    .filter((l) => l.trim());
  const letterChars = text.match(/\p{L}/gu) ?? [];
  const lower = letterChars.filter((c) => c !== c.toLocaleUpperCase('da-DK')).length;
  const mixedCase = lower > letterChars.length * 0.3;

  const lines: ReceiptLine[] = [];
  let total: number | null = null;
  let pendingName: string | null = null;
  const lastItem = () => {
    for (let i = lines.length - 1; i >= 0; i--) if (lines[i]!.kind === 'item') return lines[i]!;
    return null;
  };
  const lastLineIsItem = () => lines.length > 0 && lines[lines.length - 1]!.kind === 'item';

  for (const raw of rawLines) {
    const amount = lastAmount(raw);
    const weight = WEIGHT_RE.exec(raw);

    /* Vægtlinje: "0,979 kg x 149,90 DKK/kg" – hører til varen over eller under. */
    if (weight) {
      const perKg = num(weight[2]!);
      // Et beløb efter "DKK/kg" er linjens beløb; beløbet inde i vægtangivelsen er kilo-prisen.
      const lineAmount = amount && amount.index >= weight.index + weight[0].length ? amount : null;
      const ocrWeight = weight[1] && /[,.]/.test(weight[1]) ? num(weight[1]) : null;
      if (lineAmount && pendingName) {
        // Salling: navnet står alene, beløbet på vægtlinjen.
        const kg = ocrWeight ?? r2(lineAmount.value / perKg);
        lines.push({ kind: 'item', name: pendingName, quantity: kg, unit: 'kg', unitPrice: perKg, amount: r2(lineAmount.value) });
        pendingName = null;
        continue;
      }
      const item = lastLineIsItem() ? lastItem() : null;
      if (item) {
        // Lidl: navn og beløb over, vægten her. Vægten udledes af beløbet, hvis den er ulæselig.
        const derived = Math.round((item.amount / perKg) * 1000) / 1000;
        const fits = ocrWeight !== null && Math.abs(ocrWeight * perKg - item.amount) <= 0.05;
        item.unit = 'kg';
        item.unitPrice = perKg;
        item.quantity = fits ? ocrWeight! : derived;
        if (!fits && (derived <= 0 || derived > 25)) item.uncertain = true;
      }
      continue;
    }

    /* "2 x 12,95   25,90" på sin egen linje (Salling/REMA). */
    const before = QTY_BEFORE_RE.exec(raw);
    if (before && amount) {
      const qty = Number(before[1]);
      const unitPrice = num(before[2]!);
      const target = pendingName
        ? null
        : lastLineIsItem() && Math.abs(lastItem()!.amount - r2(qty * unitPrice)) <= 0.02
          ? lastItem()
          : null;
      const value = fixAmount(qty, unitPrice, amount);
      if (pendingName) {
        lines.push({ kind: 'item', name: pendingName, quantity: qty, unit: 'stk', unitPrice, amount: value.amount, uncertain: value.uncertain || undefined });
        pendingName = null;
      } else if (target) {
        target.quantity = qty;
        target.unitPrice = unitPrice;
      } else if (lastLineIsItem()) {
        const item = lastItem()!;
        item.quantity = qty;
        item.unitPrice = unitPrice;
        item.amount = value.amount;
        item.uncertain = value.uncertain || item.uncertain;
      }
      continue;
    }

    const head = amount ? raw.slice(0, amount.index) : raw;
    const qtyAfter = QTY_AFTER_RE.exec(head);
    const namePart = qtyAfter ? head.slice(0, qtyAfter.index) : head;
    const name = cleanName(namePart.replace(/[-−]\s*$/, ''), mixedCase);

    if (STOP_RE.test(name) || STOP_RE.test(raw.trim())) {
      if (lines.length) break;
      continue;
    }
    if (TOTAL_RE.test(name)) {
      if (amount) total = r2(Math.abs(amount.value));
      if (lines.length) break;
      continue;
    }

    if (!amount) {
      if (/(?<!\p{L})r?abat\b/iu.test(name) && lastLineIsItem()) {
        // Rabatten står der, men beløbet er ulæseligt – brugeren skal skrive det ind.
        lines.push({ kind: 'discount', name: 'Rabat', quantity: 1, unit: 'stk', unitPrice: null, amount: 0, uncertain: true });
        continue;
      }
      // Navn uden beløb: enten en overskrift eller en vare hvis beløb står på næste linje.
      pendingName = letters(name) >= 3 ? name : pendingName;
      continue;
    }
    // "| 3,00" er tit "13,00" hvor 1-tallet er læst som en streg.
    const droppedOne = /[|Il]\s?$/.test(raw.slice(0, amount.index));
    pendingName = null;

    // Et beløb der svarer til summen af linjerne indtil nu er totalen, selv hvis "SUM" er ulæseligt.
    const running = sumLines(lines);
    if (lines.length >= 3 && amount.value >= 20 && letters(name) <= 6 && Math.abs(amount.value - running) <= Math.max(0.05, running * 0.003)) {
      total = r2(amount.value);
      break;
    }

    if (letters(name) < 3) continue; // "Fr 761,65" – støj eller betalingslinje uden navn

    if (DEPOSIT_RE.test(name)) {
      lines.push({ kind: 'deposit', name, quantity: 1, unit: 'stk', unitPrice: null, amount: r2(Math.abs(amount.value)) });
      continue;
    }

    const isDiscount = amount.value < 0 || DISCOUNT_RE.test(name);
    if (isDiscount) {
      if (!lines.some((l) => l.kind === 'item')) continue;
      const phrase = name.match(DISCOUNT_NAME_RE)?.[0];
      lines.push({
        kind: 'discount',
        name: phrase
          ? /^bat$/i.test(phrase)
            ? 'Rabat'
            : phrase.charAt(0).toUpperCase() + phrase.slice(1)
          : letters(name) <= 6
            ? 'Rabat'
            : name,
        quantity: 1,
        unit: 'stk',
        unitPrice: null,
        amount: -r2(Math.abs(amount.value)),
        uncertain: amount.shaky || undefined,
      });
      continue;
    }

    if (qtyAfter) {
      const unitPrice = num(qtyAfter[1]!);
      const qty = Number(qtyAfter[2]);
      const value = fixAmount(qty, unitPrice, amount);
      lines.push({ kind: 'item', name, quantity: qty, unit: 'stk', unitPrice, amount: value.amount, uncertain: value.uncertain || undefined });
      continue;
    }

    // "6,10 x ?": antallet kan udledes, når beløbet går op i stykprisen.
    const times = UNIT_TIMES_RE.exec(head);
    if (times) {
      const unitPrice = num(times[1]!);
      const qty = amount.value / unitPrice;
      if (unitPrice > 0 && Math.abs(qty - Math.round(qty)) < 0.01 && Math.round(qty) >= 1) {
        lines.push({
          kind: 'item',
          name: cleanName(head.slice(0, times.index), mixedCase) || name,
          quantity: Math.round(qty),
          unit: 'stk',
          unitPrice,
          amount: r2(amount.value),
          uncertain: amount.shaky || undefined,
        });
        continue;
      }
    }

    lines.push({
      kind: 'item',
      name,
      quantity: 1,
      unit: 'stk',
      unitPrice: r2(amount.value),
      amount: r2(amount.value),
      uncertain: amount.shaky || droppedOne || undefined,
    });
  }

  // Uden en læselig total kan forvanskede betalingslinjer ("Kort 761,65") snige sig med
  // som de sidste varer.
  const warnings: string[] = [];
  const dropped = (tail: ReceiptLine[]) =>
    warnings.push(
      `${tail.map((l) => `"${l.name} ${l.amount.toFixed(2).replace('.', ',')}"`).join(' og ')} efter varerne ligner betaling og er udeladt.`,
    );
  if (total == null) {
    // Kontant + kort summer til varernes total – så er det betalingen, og totalen kendes.
    for (let k = 1; k <= 3 && lines.length - k >= 3; k++) {
      const tail = lines.slice(-k);
      const paid = sumLines(tail);
      const items = sumLines(lines.slice(0, -k));
      if (tail.every((l) => l.kind === 'item') && Math.abs(paid - items) <= Math.max(0.1, items * 0.01)) {
        lines.splice(-k);
        total = paid;
        dropped(tail);
        break;
      }
    }
  }
  // En sidste "vare" der koster mere end alle de andre tilsammen er næsten altid en betalingslinje.
  while (total == null && lines.length > 3) {
    const last = lines[lines.length - 1]!;
    if (last.kind !== 'item' || last.amount <= sumLines(lines.slice(0, -1))) break;
    lines.pop();
    dropped([last]);
  }

  return finalizeReceipt({
    storeId: detectChain(text, opts.chains),
    purchasedAt: detectDate(text, opts.now),
    total,
    lines,
    source: opts.source ?? 'text',
    warnings,
  });
}

/**
 * "10,00 x 3  230,00" → 30,00: stemmer antal × pris ikke med beløbet, er det
 * næsten altid beløbet der er læst forkert (et "=" blev til "2", et ciffer faldt ud).
 */
function fixAmount(qty: number, unitPrice: number, amount: Amount): { amount: number; uncertain: boolean } {
  const expected = r2(qty * unitPrice);
  const read = r2(Math.abs(amount.value));
  if (Math.abs(expected - read) <= 0.02) return { amount: read, uncertain: amount.shaky };
  const expectedText = expected.toFixed(2).replace('.', ',');
  if (amount.raw.endsWith(expectedText)) return { amount: expected, uncertain: false };
  return { amount: expected, uncertain: true };
}

/** Fælles efterbehandling for alle aflæsninger: afrunding, sum-tjek og advarsler. */
export function finalizeReceipt(receipt: ParsedReceipt): ParsedReceipt {
  const lines = receipt.lines
    .filter((l) => l.name.trim() && Number.isFinite(l.amount))
    .map((l) => ({
      ...l,
      name: l.name.trim().slice(0, 120),
      amount: r2(l.kind === 'discount' ? -Math.abs(l.amount) : l.amount),
      quantity: l.quantity > 0 ? Math.round(l.quantity * 1000) / 1000 : 1,
      unitPrice: l.unitPrice == null ? null : r2(l.unitPrice),
    }));
  const warnings = [...receipt.warnings];
  if (!lines.some((l) => l.kind === 'item')) warnings.push('Der blev ikke fundet nogen varelinjer.');
  if (!receipt.storeId) warnings.push('Kæden kunne ikke genkendes – vælg den selv.');
  if (!receipt.purchasedAt) warnings.push('Købsdatoen kunne ikke læses – tjek datoen.');
  const sum = sumLines(lines);
  if (receipt.total == null) {
    warnings.push('Totalen kunne ikke læses – skriv den ind, så vi kan tjekke linjerne.');
  } else if (Math.abs(sum - receipt.total) > 0.05) {
    warnings.push(
      `Linjerne giver ${sum.toFixed(2).replace('.', ',')} kr, men kvitteringen siger ${receipt.total.toFixed(2).replace('.', ',')} kr.`,
    );
  }
  const uncertain = lines.filter((l) => l.uncertain).length;
  if (uncertain) warnings.push(`${uncertain} ${uncertain === 1 ? 'linje er usikker' : 'linjer er usikre'} – tjek de markerede.`);
  return { ...receipt, lines, warnings };
}
