import type { ReceiptCheckDTO, ReceiptOverviewDTO, ReceiptSummaryDTO } from '@tilbudsradar/shared';
import { and, eq, sql } from 'drizzle-orm';
import express, { Router, type Request } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { query } from '../../db/client';
import { receipts } from '../../db/schema';
import { env } from '../../env';
import { checkReceipt } from '../../services/receipts/check';
import { finalizeReceipt, parseReceiptText } from '../../services/receipts/parseText';
import { scanReceiptImage } from '../../services/receipts/scan';
import { ACTIVE_CHAIN_IDS } from '../../services/scope';
import type { AppContext } from '../app';
import { requireAuth, userId } from '../auth';
import { HttpError, notFound, parse } from '../errors';

const idParam = z.object({ id: z.coerce.number().int().positive() });

const LineSchema = z.object({
  kind: z.enum(['item', 'discount', 'deposit']),
  name: z.string().trim().min(1).max(120),
  quantity: z.number().positive().max(10_000),
  unit: z.enum(['stk', 'kg']),
  unitPrice: z.number().min(-100_000).max(100_000).nullable(),
  amount: z.number().min(-100_000).max(100_000),
  uncertain: z.boolean().optional(),
});

const ReceiptInput = z.object({
  storeId: z
    .string()
    .nullable()
    .refine((v) => v === null || ACTIVE_CHAIN_IDS.includes(v), 'Ukendt kæde'),
  purchasedAt: z
    .string()
    .nullable()
    .refine((v) => v === null || !Number.isNaN(Date.parse(v)), 'Ugyldig dato'),
  total: z.number().min(0).max(1_000_000).nullable(),
  lines: z.array(LineSchema).min(1).max(300),
  source: z.enum(['claude', 'ocr', 'text', 'manual']),
});

/** Kvitteringer: scan, tjek mod ugens aviser og gem oversigten. Kræver login eller gæstesession. */
export function receiptRoutes({ db }: AppContext): Router {
  const r = Router();
  r.use('/receipts', requireAuth);

  // Aflæsning koster CPU (tekstgenkendelse) eller et Claude-kald – begræns pr. bruger.
  const scanLimit = rateLimit({
    windowMs: 60 * 60_000,
    limit: env.isTest ? 1000 : 40,
    keyGenerator: (req) => userId(req),
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Du har scannet mange kvitteringer den seneste time. Prøv igen lidt senere.' },
  });

  r.post(
    '/receipts/scan',
    scanLimit,
    express.raw({ type: ['image/*', 'application/octet-stream'], limit: '15mb' }),
    async (req, res) => {
      if (!Buffer.isBuffer(req.body) || !req.body.length) {
        throw new HttpError(400, 'Send billedet af kvitteringen som JPEG eller PNG.');
      }
      res.json(await scanReceiptImage(req.body));
    },
  );

  /** E-kvitteringer (fx fra kædens app) kan indsættes som tekst. */
  r.post('/receipts/parse-text', async (req, res) => {
    const { text } = parse(z.object({ text: z.string().min(1).max(20_000) }), req.body);
    res.json(parseReceiptText(text, { chains: ACTIVE_CHAIN_IDS, source: 'text' }));
  });

  r.post('/receipts', async (req, res) => {
    const input = parse(ReceiptInput, req.body);
    // Sum-tjek og advarsler beregnes igen på de (evt. rettede) linjer.
    const cleaned = finalizeReceipt({ ...input, warnings: [] });
    const check = await checkReceipt(db, cleaned);
    const [row] = await db
      .insert(receipts)
      .values({
        userId: userId(req),
        storeId: cleaned.storeId,
        purchasedAt: cleaned.purchasedAt ? new Date(cleaned.purchasedAt) : null,
        source: cleaned.source,
        total: check.total,
        printedTotal: cleaned.total,
        saved: check.saved,
        itemCount: check.itemCount,
        possibleErrors: check.possibleErrors,
        possibleRefund: check.possibleRefund,
        lines: cleaned.lines,
      })
      .returning({ id: receipts.id, createdAt: receipts.createdAt });
    res.status(201).json({ ...check, id: row!.id, createdAt: row!.createdAt.toISOString() } satisfies ReceiptCheckDTO);
  });

  r.get('/receipts', async (req, res) => {
    const rows = await query<{
      id: number;
      store_id: string | null;
      store_name: string | null;
      store_color: string | null;
      store_logo: string | null;
      purchased_at: Date | null;
      created_at: Date;
      total: number;
      saved: number;
      item_count: number;
      possible_errors: number;
      possible_refund: number;
    }>(
      db,
      sql`SELECT r.id, r.store_id, s.name AS store_name, s.color AS store_color, s.logo_url AS store_logo,
                 r.purchased_at, r.created_at, r.total, r.saved, r.item_count, r.possible_errors, r.possible_refund
          FROM receipts r LEFT JOIN stores s ON s.id = r.store_id
          WHERE r.user_id = ${userId(req)}
          ORDER BY coalesce(r.purchased_at, r.created_at) DESC, r.id DESC
          LIMIT 200`,
    );
    const list: ReceiptSummaryDTO[] = rows.map((x) => ({
      id: x.id,
      store: x.store_id
        ? { id: x.store_id, name: x.store_name ?? x.store_id, color: x.store_color ?? '#999', logoUrl: x.store_logo }
        : null,
      purchasedAt: x.purchased_at ? new Date(x.purchased_at).toISOString() : null,
      createdAt: new Date(x.created_at).toISOString(),
      total: x.total,
      saved: x.saved,
      itemCount: x.item_count,
      possibleErrors: x.possible_errors,
      possibleRefund: x.possible_refund,
    }));
    const sum = (f: (x: ReceiptSummaryDTO) => number) => Math.round(list.reduce((s, x) => s + f(x), 0) * 100) / 100;
    res.json({
      receipts: list,
      totalSaved: sum((x) => x.saved),
      totalSpent: sum((x) => x.total),
      possibleRefund: sum((x) => x.possibleRefund),
    } satisfies ReceiptOverviewDTO);
  });

  async function ownReceipt(req: Request) {
    const { id } = parse(idParam, req.params);
    const [row] = await db
      .select()
      .from(receipts)
      .where(and(eq(receipts.id, id), eq(receipts.userId, userId(req))))
      .limit(1);
    if (!row) throw notFound('Kvitteringen');
    return row;
  }

  /** Tjekket genberegnes, så forbedret matching også gælder gamle kvitteringer. */
  r.get('/receipts/:id', async (req, res) => {
    const row = await ownReceipt(req);
    const check = await checkReceipt(db, {
      id: row.id,
      createdAt: row.createdAt,
      storeId: row.storeId,
      purchasedAt: row.purchasedAt?.toISOString() ?? null,
      total: row.printedTotal,
      lines: row.lines,
      source: row.source as ReceiptCheckDTO['source'],
    });
    if (check.saved !== row.saved || check.possibleErrors !== row.possibleErrors || check.possibleRefund !== row.possibleRefund) {
      await db
        .update(receipts)
        .set({ saved: check.saved, possibleErrors: check.possibleErrors, possibleRefund: check.possibleRefund })
        .where(eq(receipts.id, row.id));
    }
    res.json(check);
  });

  r.delete('/receipts/:id', async (req, res) => {
    const row = await ownReceipt(req);
    await db.delete(receipts).where(eq(receipts.id, row.id));
    res.status(204).end();
  });

  return r;
}
