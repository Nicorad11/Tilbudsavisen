import type { OfferDTO, StoreRef } from './api';

/**
 * Kvitteringer: en linje er enten en vare, en rabat (negativ, hører til varen
 * lige over) eller pant. Vægtvarer har unit 'kg' og quantity = vægten.
 */
export type ReceiptLineKind = 'item' | 'discount' | 'deposit';

export interface ReceiptLine {
  kind: ReceiptLineKind;
  /** Teksten som den står på kvitteringen, fx "Henriettelund Skrab". */
  name: string;
  quantity: number;
  unit: 'stk' | 'kg';
  /** Pris pr. stk eller pr. kg som trykt – null hvis kun beløbet står der. */
  unitPrice: number | null;
  /** Linjens beløb; negativt for rabatter. */
  amount: number;
  /** Tekstgenkendelsen var i tvivl – vises markeret, så brugeren kan rette. */
  uncertain?: boolean;
}

export type ReceiptSource = 'claude' | 'ocr' | 'text' | 'manual';

/** Kvitteringen som den er aflæst – før den tjekkes mod tilbuddene. */
export interface ParsedReceipt {
  storeId: string | null;
  purchasedAt: string | null;
  /** Totalen der står på kvitteringen (SUM/TOTAL). */
  total: number | null;
  lines: ReceiptLine[];
  source: ReceiptSource;
  warnings: string[];
}

/**
 * Hvordan en vare stemmer med ugens avis:
 *  - match: prisen svarer til avisprisen
 *  - cheaper: du betalte mindre end avisprisen
 *  - overcharged: du betalte mere end avisprisen → mulig fejl
 *  - app_price: avisprisen kræver kædens app/medlemskab, og den blev ikke trukket
 *  - check: avisen har en lignende vare til en lavere pris – tjek om det er samme vare
 *  - no_offer: varen var ikke på tilbud i avisen
 */
export type ReceiptVerdict = 'match' | 'cheaper' | 'overcharged' | 'app_price' | 'check' | 'no_offer';

export interface ReceiptItemCheck {
  /** Varens nummer på kvitteringen (0-baseret, kun varelinjer). */
  index: number;
  name: string;
  quantity: number;
  unit: 'stk' | 'kg';
  /** Beløbet før rabat. */
  normalAmount: number;
  /** Rabatter trukket på kvitteringen (positivt tal). */
  discount: number;
  /** Betalt efter rabat. */
  paid: number;
  /** Betalt pr. stk eller pr. kg. */
  paidPerUnit: number | null;
  verdict: ReceiptVerdict;
  message: string;
  /** Tilbuddet i kædens avis på købsdagen. */
  offer: OfferDTO | null;
  /** Hvad varen burde have kostet i alt ifølge avisen. */
  expectedAmount: number | null;
  /** Betalt minus forventet – positivt betyder for meget. */
  difference: number | null;
  /** Besparelse på varen: kvitteringens rabat eller avisens førpris minus betalt. */
  saved: number;
  /** Samme vare var billigere i en anden kæde samme dag. */
  cheaperElsewhere: { offer: OfferDTO; saving: number } | null;
  /** Lignende vare på tilbud i samme kæde (anden størrelse), der var billigere pr. enhed. */
  similarOffer: OfferDTO | null;
  uncertain: boolean;
}

export interface ReceiptSummaryDTO {
  id: number;
  store: StoreRef | null;
  purchasedAt: string | null;
  createdAt: string;
  total: number;
  saved: number;
  itemCount: number;
  possibleErrors: number;
  possibleRefund: number;
}

export interface ReceiptCheckDTO {
  id: number | null;
  store: StoreRef | null;
  purchasedAt: string | null;
  createdAt: string | null;
  source: ReceiptSource;
  /** Totalen fra kvitteringen, ellers summen af linjerne. */
  total: number;
  /** Summen af alle linjer (varer, rabatter og pant). */
  linesTotal: number;
  /** Kvitteringens total stemmer med linjerne (null når totalen ikke kunne læses). */
  totalMatches: boolean | null;
  deposits: number;
  /** Samlet besparelse (rabatter på kvitteringen og avispriser under førpris). */
  saved: number;
  /** Heraf rabatter trukket direkte på kvitteringen. */
  discountsOnReceipt: number;
  itemCount: number;
  /** Varer der var på tilbud i avisen og blev afregnet korrekt. */
  verifiedOffers: number;
  possibleErrors: number;
  /** Hvad du muligvis har betalt for meget. */
  possibleRefund: number;
  /** Varer brugeren selv bør kigge på (lignende vare eller app-pris). */
  toCheck: number;
  /** Hvad du kunne have sparet ved at købe samme varer i en anden kæde. */
  cheaperElsewhereTotal: number;
  items: ReceiptItemCheck[];
  lines: ReceiptLine[];
  warnings: string[];
}

export interface ReceiptOverviewDTO {
  receipts: ReceiptSummaryDTO[];
  totalSaved: number;
  totalSpent: number;
  possibleRefund: number;
}

/** Samler hver vare med rabatlinjerne lige under den. */
export function groupReceiptLines(lines: ReceiptLine[]): { item: ReceiptLine; discounts: ReceiptLine[] }[] {
  const groups: { item: ReceiptLine; discounts: ReceiptLine[] }[] = [];
  for (const line of lines) {
    if (line.kind === 'item') groups.push({ item: line, discounts: [] });
    else if (line.kind === 'discount' && groups.length) groups[groups.length - 1]!.discounts.push(line);
  }
  return groups;
}

export function sumLines(lines: ReceiptLine[]): number {
  return Math.round(lines.reduce((s, l) => s + l.amount, 0) * 100) / 100;
}
