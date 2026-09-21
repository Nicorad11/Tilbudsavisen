import type { ListSummaryDTO } from '@tilbudsradar/shared';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { Router, type Request } from 'express';
import { z } from 'zod';
import { query } from '../../db/client';
import {
  notifications,
  shoppingListItems,
  shoppingLists,
  users,
  watchlist,
} from '../../db/schema';
import { getListDetail, optimizeList } from '../../services/lists';
import { listNotifications, listWatches } from '../../services/watch';
import type { AppContext } from '../app';
import { requireAuth, userId } from '../auth';
import { HttpError, notFound, parse } from '../errors';

const idParam = z.object({ id: z.coerce.number().int().positive() });
const itemParams = z.object({ id: z.coerce.number().int().positive(), itemId: z.coerce.number().int().positive() });
const csv = z
  .string()
  .optional()
  .transform((v) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : undefined));

/** Indkøbslister, watchlist og notifikationer – kræver login eller gæstesession. */
export function userRoutes({ db }: AppContext): Router {
  const r = Router();
  r.use(['/lists', '/watchlist', '/notifications'], requireAuth);

  async function ownList(req: Request, listId: number) {
    const [list] = await db
      .select()
      .from(shoppingLists)
      .where(and(eq(shoppingLists.id, listId), eq(shoppingLists.userId, userId(req))))
      .limit(1);
    if (!list) throw notFound('Listen');
    return list;
  }

  async function preferredStores(req: Request, override?: string[]): Promise<string[] | null> {
    if (override?.length) return override;
    const [u] = await db.select({ s: users.preferredStoreIds }).from(users).where(eq(users.id, userId(req)));
    return u?.s.length ? u.s : null;
  }

  const touch = (listId: number) =>
    db.update(shoppingLists).set({ updatedAt: new Date() }).where(eq(shoppingLists.id, listId));

  /* ---------------- Indkøbslister ---------------- */

  r.get('/lists', async (req, res) => {
    const rows = await query<{ id: number; name: string; item_count: number; updated_at: Date }>(
      db,
      sql`SELECT l.id, l.name, l.updated_at, count(i.id)::int AS item_count
          FROM shopping_lists l LEFT JOIN shopping_list_items i ON i.list_id = l.id
          WHERE l.user_id = ${userId(req)}::uuid
          GROUP BY l.id ORDER BY l.updated_at DESC`,
    );
    res.json(
      rows.map(
        (l): ListSummaryDTO => ({
          id: l.id,
          name: l.name,
          itemCount: l.item_count,
          updatedAt: new Date(l.updated_at).toISOString(),
        }),
      ),
    );
  });

  r.post('/lists', async (req, res) => {
    const { name } = parse(z.object({ name: z.string().trim().min(1).max(80).default('Min indkøbsliste') }), req.body ?? {});
    const [list] = await db.insert(shoppingLists).values({ userId: userId(req), name }).returning();
    res.status(201).json({ id: list!.id, name: list!.name, itemCount: 0, updatedAt: list!.updatedAt.toISOString() });
  });

  r.get('/lists/:id', async (req, res) => {
    const { id } = parse(idParam, req.params);
    await ownList(req, id);
    const { stores } = parse(z.object({ stores: csv }), req.query);
    res.json(await getListDetail(db, id, await preferredStores(req, stores)));
  });

  r.patch('/lists/:id', async (req, res) => {
    const { id } = parse(idParam, req.params);
    await ownList(req, id);
    const { name } = parse(z.object({ name: z.string().trim().min(1).max(80) }), req.body);
    await db.update(shoppingLists).set({ name, updatedAt: new Date() }).where(eq(shoppingLists.id, id));
    res.status(204).end();
  });

  r.delete('/lists/:id', async (req, res) => {
    const { id } = parse(idParam, req.params);
    await ownList(req, id);
    await db.delete(shoppingLists).where(eq(shoppingLists.id, id));
    res.status(204).end();
  });

  r.post('/lists/:id/items', async (req, res) => {
    const { id } = parse(idParam, req.params);
    await ownList(req, id);
    const body = parse(
      z.object({
        text: z.string().trim().min(1).max(120),
        productId: z.number().int().positive().nullable().optional(),
        quantity: z.number().int().min(1).max(99).default(1),
      }),
      req.body,
    );
    const [item] = await db
      .insert(shoppingListItems)
      .values({ listId: id, text: body.text, productId: body.productId ?? null, quantity: body.quantity })
      .returning();
    await touch(id);
    res.status(201).json(item);
  });

  r.patch('/lists/:id/items/:itemId', async (req, res) => {
    const { id, itemId } = parse(itemParams, req.params);
    await ownList(req, id);
    const body = parse(
      z.object({
        text: z.string().trim().min(1).max(120).optional(),
        quantity: z.number().int().min(1).max(99).optional(),
        checked: z.boolean().optional(),
      }),
      req.body,
    );
    await db
      .update(shoppingListItems)
      .set(body)
      .where(and(eq(shoppingListItems.id, itemId), eq(shoppingListItems.listId, id)));
    await touch(id);
    res.status(204).end();
  });

  r.delete('/lists/:id/items/:itemId', async (req, res) => {
    const { id, itemId } = parse(itemParams, req.params);
    await ownList(req, id);
    await db.delete(shoppingListItems).where(and(eq(shoppingListItems.id, itemId), eq(shoppingListItems.listId, id)));
    await touch(id);
    res.status(204).end();
  });

  /** Butiks-splitting: billigste kombination af kæder for listen. */
  r.get('/lists/:id/optimize', async (req, res) => {
    const { id } = parse(idParam, req.params);
    await ownList(req, id);
    const q = parse(z.object({ stores: csv, maxStores: z.coerce.number().int().min(1).max(4).default(2) }), req.query);
    res.json(await optimizeList(db, id, { storeIds: await preferredStores(req, q.stores), maxStores: q.maxStores }));
  });

  /* ---------------- Watchlist & notifikationer ---------------- */

  r.get('/watchlist', async (req, res) => {
    res.json(await listWatches(db, userId(req)));
  });

  r.post('/watchlist', async (req, res) => {
    const body = parse(
      z.object({
        query: z.string().trim().min(2).max(80),
        productId: z.number().int().positive().nullable().optional(),
        targetPrice: z.number().positive().max(100_000),
      }),
      req.body,
    );
    const count = await query<{ n: number }>(db, sql`SELECT count(*)::int AS n FROM watchlist WHERE user_id = ${userId(req)}::uuid`);
    if ((count[0]?.n ?? 0) >= 50) throw new HttpError(400, 'Du kan højst følge 50 varer');
    const [w] = await db
      .insert(watchlist)
      .values({ userId: userId(req), query: body.query, productId: body.productId ?? null, targetPrice: body.targetPrice })
      .returning();
    res.status(201).json(w);
  });

  r.patch('/watchlist/:id', async (req, res) => {
    const { id } = parse(idParam, req.params);
    const { targetPrice } = parse(z.object({ targetPrice: z.number().positive().max(100_000) }), req.body);
    await db.update(watchlist).set({ targetPrice }).where(and(eq(watchlist.id, id), eq(watchlist.userId, userId(req))));
    res.status(204).end();
  });

  r.delete('/watchlist/:id', async (req, res) => {
    const { id } = parse(idParam, req.params);
    await db.delete(watchlist).where(and(eq(watchlist.id, id), eq(watchlist.userId, userId(req))));
    res.status(204).end();
  });

  r.get('/notifications', async (req, res) => {
    res.json(await listNotifications(db, userId(req)));
  });

  r.post('/notifications/read', async (req, res) => {
    const { ids } = parse(z.object({ ids: z.array(z.number().int()).max(200).optional() }), req.body ?? {});
    const mine = and(eq(notifications.userId, userId(req)), isNull(notifications.readAt));
    await db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(ids?.length ? and(mine, inArray(notifications.id, ids)) : mine);
    res.status(204).end();
  });

  return r;
}
