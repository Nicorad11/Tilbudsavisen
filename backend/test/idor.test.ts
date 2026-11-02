import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { AuthResponse } from '@tilbudsradar/shared';
import { mapTjekOffer, silentLogger } from '@tilbudsradar/scrapers';
import { eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, query, type Database } from '../src/db/client';
import {
  communityReports,
  notifications,
  receipts,
  shoppingListItems,
  shoppingLists,
  watchlist,
} from '../src/db/schema';
import { createApp } from '../src/http/app';
import { ingestOffers } from '../src/services/ingest';
import { ScrapeManager } from '../src/services/scrapeJobs';

/**
 * IDOR: ingen bruger må kunne læse, ændre eller slette en andens data ved at
 * skifte et id ud. Fremmede ressourcer svarer 404 – ligesom ressourcer, der
 * ikke findes – så svaret heller ikke afslører, at id'et er i brug.
 */

const fixtures = path.resolve(import.meta.dirname, '../../scrapers/test/fixtures');
const DAY = 86_400_000;
const iso = (d: Date) => d.toISOString().replace('.000Z', '+0000');

let database: Database;
let app: ReturnType<typeof createApp>;

interface Session {
  id: string;
  auth: { Authorization: string };
}

async function member(email: string): Promise<Session> {
  const res = await request(app).post('/api/auth/register').send({ email, password: 'hemmelig123', acceptTerms: true }).expect(201);
  const body = res.body as AuthResponse;
  return { id: body.user.id, auth: { Authorization: `Bearer ${body.accessToken}` } };
}

async function guest(): Promise<Session> {
  const body = (await request(app).post('/api/auth/guest').expect(201)).body as AuthResponse;
  return { id: body.user.id, auth: { Authorization: `Bearer ${body.accessToken}` } };
}

/** Brugerens egne data, oprettet direkte i databasen (gæster kan ikke oprette via API'et). */
async function seed(userId: string, offerId: number) {
  const db = database.db;
  const [list] = await db.insert(shoppingLists).values({ userId, name: 'Privat liste' }).returning();
  const [item] = await db.insert(shoppingListItems).values({ listId: list!.id, text: 'hemmelig vare' }).returning();
  const [watch] = await db.insert(watchlist).values({ userId, query: 'kaffe', targetPrice: 30 }).returning();
  const [note] = await db.insert(notifications).values({ userId, watchId: watch!.id, message: 'Kaffe er på tilbud' }).returning();
  const [report] = await db.insert(communityReports).values({ offerId, userId, verdict: 'real' }).returning();
  const [receipt] = await db
    .insert(receipts)
    .values({
      userId,
      storeId: null,
      purchasedAt: null,
      source: 'manual',
      total: 8,
      printedTotal: null,
      saved: 0,
      itemCount: 1,
      lines: [{ kind: 'item', name: 'Agurk', quantity: 1, unit: 'stk', unitPrice: 8, amount: 8 }],
    })
    .returning();
  return { listId: list!.id, itemId: item!.id, watchId: watch!.id, notificationId: note!.id, reportId: report!.id, receiptId: receipt!.id };
}

type Owned = Awaited<ReturnType<typeof seed>>;

let a: Session;
let b: Session;
let g: Session;
let ofB: Owned;
let ofG: Owned;
let ofA: Owned;

beforeAll(async () => {
  database = await createDatabase({ url: null, dataDir: 'memory://' });
  await database.migrate();
  const scrape = new ScrapeManager(database.db, silentLogger);
  await scrape.syncRegistry();
  app = createApp({ db: database.db, scrape, stripe: null });

  const now = Date.now();
  const raw = JSON.parse(readFileSync(path.join(fixtures, 'tjek-offers.json'), 'utf8')) as Record<string, unknown>[];
  const offers = raw
    .map((o) => mapTjekOffer({ ...o, run_from: iso(new Date(now - DAY)), run_till: iso(new Date(now + 5 * DAY)) }, {
      storeId: 'rema1000',
      sourceId: 'rema1000',
      dealerSlug: 'REMA-1000',
    }))
    .filter((o) => o !== null);
  await ingestOffers(database.db, offers);
  const [offer] = await query<{ id: number }>(database.db, sql`SELECT id FROM offers ORDER BY id LIMIT 1`);

  a = await member('a@idor.test');
  b = await member('b@idor.test');
  g = await guest();
  ofA = await seed(a.id, offer!.id);
  ofB = await seed(b.id, offer!.id);
  ofG = await seed(g.id, offer!.id);
});

afterAll(async () => {
  await database?.close();
});

describe('IDOR – bruger A kan ikke røre bruger B\'s data', () => {
  it('indkøbslister: læse, omdøbe, slette, tilføje varer og butiks-splitting', async () => {
    await request(app).get(`/api/lists/${ofB.listId}`).set(a.auth).expect(404);
    await request(app).get(`/api/lists/${ofB.listId}/optimize`).set(a.auth).expect(404);
    await request(app).patch(`/api/lists/${ofB.listId}`).set(a.auth).send({ name: 'Overtaget' }).expect(404);
    await request(app).post(`/api/lists/${ofB.listId}/items`).set(a.auth).send({ text: 'snyd' }).expect(404);
    await request(app).delete(`/api/lists/${ofB.listId}`).set(a.auth).expect(404);

    const [list] = await database.db.select().from(shoppingLists).where(eq(shoppingLists.id, ofB.listId));
    expect(list?.name).toBe('Privat liste');
    const items = await database.db.select().from(shoppingListItems).where(eq(shoppingListItems.listId, ofB.listId));
    expect(items.map((i) => i.text)).toEqual(['hemmelig vare']);
    // A's egen liste viser ikke B's liste.
    const mine = (await request(app).get('/api/lists').set(a.auth).expect(200)).body as { id: number }[];
    expect(mine.map((l) => l.id)).toEqual([ofA.listId]);
  });

  it('varer: B\'s vare kan hverken nås via B\'s liste eller via A\'s egen liste', async () => {
    await request(app).patch(`/api/lists/${ofB.listId}/items/${ofB.itemId}`).set(a.auth).send({ checked: true }).expect(404);
    await request(app).delete(`/api/lists/${ofB.listId}/items/${ofB.itemId}`).set(a.auth).expect(404);
    // A's liste-id + B's vare-id: varen ligger ikke på A's liste.
    await request(app).patch(`/api/lists/${ofA.listId}/items/${ofB.itemId}`).set(a.auth).send({ checked: true }).expect(404);
    await request(app).delete(`/api/lists/${ofA.listId}/items/${ofB.itemId}`).set(a.auth).expect(404);

    const [item] = await database.db.select().from(shoppingListItems).where(eq(shoppingListItems.id, ofB.itemId));
    expect(item).toMatchObject({ listId: ofB.listId, checked: false });
    // Ejeren kan stadig.
    await request(app).patch(`/api/lists/${ofB.listId}/items/${ofB.itemId}`).set(b.auth).send({ checked: true }).expect(204);
  });

  it('kvitteringer: læse og slette', async () => {
    await request(app).get(`/api/receipts/${ofB.receiptId}`).set(a.auth).expect(404);
    await request(app).delete(`/api/receipts/${ofB.receiptId}`).set(a.auth).expect(404);
    const overview = (await request(app).get('/api/receipts').set(a.auth).expect(200)).body as { receipts: { id: number }[] };
    expect(overview.receipts.map((r) => r.id)).toEqual([ofA.receiptId]);
    await request(app).get(`/api/receipts/${ofB.receiptId}`).set(b.auth).expect(200);
  });

  it('prisalarmer: ændre og slette', async () => {
    await request(app).patch(`/api/watchlist/${ofB.watchId}`).set(a.auth).send({ targetPrice: 1 }).expect(404);
    await request(app).delete(`/api/watchlist/${ofB.watchId}`).set(a.auth).expect(404);
    const [watch] = await database.db.select().from(watchlist).where(eq(watchlist.id, ofB.watchId));
    expect(watch?.targetPrice).toBe(30);
    const mine = (await request(app).get('/api/watchlist').set(a.auth).expect(200)).body as { id: number }[];
    expect(mine.map((w) => w.id)).toEqual([ofA.watchId]);
  });

  it('community-vurderinger: kan ikke slette andres; stemmer kun på eksisterende', async () => {
    await request(app).delete(`/api/reports/${ofB.reportId}`).set(a.auth).expect(404);
    const [report] = await database.db.select().from(communityReports).where(eq(communityReports.id, ofB.reportId));
    expect(report).toBeDefined();
    // At stemme på andres vurderinger er selve funktionen – men et ukendt id giver 404.
    await request(app).post(`/api/reports/${ofB.reportId}/vote`).set(a.auth).send({ value: 1 }).expect(204);
    await request(app).post('/api/reports/999999/vote').set(a.auth).send({ value: 1 }).expect(404);
  });

  it('notifikationer: B\'s id\'er markeres ikke som læst', async () => {
    await request(app).post('/api/notifications/read').set(a.auth).send({ ids: [ofB.notificationId] }).expect(204);
    // Også "markér alle som læst" rammer kun A's egne.
    await request(app).post('/api/notifications/read').set(a.auth).send({}).expect(204);
    const [note] = await database.db.select().from(notifications).where(eq(notifications.id, ofB.notificationId));
    expect(note?.readAt).toBeNull();
    const [own] = await database.db.select().from(notifications).where(eq(notifications.id, ofA.notificationId));
    expect(own?.readAt).not.toBeNull();
  });

  it('dataudtræk indeholder kun brugerens egne data', async () => {
    const data = (await request(app).get('/api/auth/me/export').set(a.auth).expect(200)).body as Record<string, { id: number; userId?: string }[]>;
    expect(data.shoppingLists!.map((l) => l.id)).toEqual([ofA.listId]);
    expect(data.watchlist!.map((w) => w.id)).toEqual([ofA.watchId]);
    expect(data.receipts!.map((r) => r.id)).toEqual([ofA.receiptId]);
    expect(data.notifications!.map((n) => n.id)).toEqual([ofA.notificationId]);
    expect(data.communityReports!.map((r) => r.id)).toEqual([ofA.reportId]);
    const all = JSON.stringify(data);
    expect(all).not.toContain(b.id);
    expect(all).not.toContain('b@idor.test');
  });
});

describe('IDOR – gæster', () => {
  it('en gæst kan ikke nå en kontos data', async () => {
    await request(app).get(`/api/lists/${ofB.listId}`).set(g.auth).expect(404);
    await request(app).delete(`/api/lists/${ofB.listId}`).set(g.auth).expect(404);
    await request(app).delete(`/api/lists/${ofB.listId}/items/${ofB.itemId}`).set(g.auth).expect(404);
    await request(app).get(`/api/receipts/${ofB.receiptId}`).set(g.auth).expect(404);
    await request(app).delete(`/api/receipts/${ofB.receiptId}`).set(g.auth).expect(404);
    await request(app).delete(`/api/watchlist/${ofB.watchId}`).set(g.auth).expect(404);
    await request(app).delete(`/api/reports/${ofB.reportId}`).set(g.auth).expect(404);
  });

  it('en konto kan ikke nå en gæsts data', async () => {
    await request(app).get(`/api/lists/${ofG.listId}`).set(a.auth).expect(404);
    await request(app).delete(`/api/lists/${ofG.listId}`).set(a.auth).expect(404);
    await request(app).get(`/api/receipts/${ofG.receiptId}`).set(a.auth).expect(404);
    await request(app).delete(`/api/watchlist/${ofG.watchId}`).set(a.auth).expect(404);
    // Gæsten selv kan stadig se og slette sine egne data.
    await request(app).get(`/api/lists/${ofG.listId}`).set(g.auth).expect(200);
    await request(app).delete(`/api/receipts/${ofG.receiptId}`).set(g.auth).expect(204);
  });

  it('uden login: 401 – ingen data', async () => {
    await request(app).get(`/api/lists/${ofB.listId}`).expect(401);
    await request(app).get(`/api/receipts/${ofB.receiptId}`).expect(401);
    await request(app).delete(`/api/watchlist/${ofB.watchId}`).expect(401);
    await request(app).get('/api/auth/me/export').expect(401);
  });
});
