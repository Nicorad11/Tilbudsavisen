import type { AuthResponse } from '@tilbudsradar/shared';
import { silentLogger } from '@tilbudsradar/scrapers';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase, type Database } from '../src/db/client';
import { createApp } from '../src/http/app';
import { refreshCookieOptions } from '../src/http/auth';
import { testOutbox } from '../src/services/mailer';
import { ScrapeManager } from '../src/services/scrapeJobs';

let database: Database;
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  database = await createDatabase({ url: null, dataDir: 'memory://' });
  await database.migrate();
  const scrape = new ScrapeManager(database.db, silentLogger);
  await scrape.syncRegistry();
  app = createApp({ db: database.db, scrape, stripe: null });
});

afterAll(async () => {
  await database?.close();
});

beforeEach(() => {
  testOutbox.length = 0;
});

const PASSWORD = 'hemmelig123';
/** Selve cookien ("tr_refresh=…") fra Set-Cookie – det en browser sender tilbage. */
const refreshCookie = (res: request.Response) => {
  const header = ([] as string[]).concat(res.headers['set-cookie'] ?? []).find((c) => c.startsWith('tr_refresh='));
  return header?.split(';')[0];
};
const linkToken = (to: string) => {
  const mail = testOutbox.filter((m) => m.to === to).at(-1)!;
  return decodeURIComponent(/token=([^\s&]+)/.exec(mail.text)![1]!);
};

async function register(email: string) {
  const res = await request(app).post('/api/auth/register').send({ email, password: PASSWORD, acceptTerms: true }).expect(201);
  return { res, cookie: refreshCookie(res)!, auth: { Authorization: `Bearer ${(res.body as AuthResponse).accessToken}` } };
}

async function login(email: string, password = PASSWORD) {
  const res = await request(app).post('/api/auth/login').send({ email, password }).expect(200);
  return refreshCookie(res)!;
}

const refresh = (cookie: string) => request(app).post('/api/auth/refresh').set('Cookie', cookie);

describe('refresh-cookien', () => {
  it('er HttpOnly, SameSite=Strict og kun til /api/auth', async () => {
    const { res } = await register('cookie@session.test');
    const header = ([] as string[]).concat(res.headers['set-cookie'] ?? []).find((c) => c.startsWith('tr_refresh='))!;
    expect(header).toMatch(/; HttpOnly/i);
    expect(header).toMatch(/; SameSite=Strict/i);
    expect(header).toMatch(/; Path=\/api\/auth(;|$)/i);
  });

  it('er Secure i produktion – og når SameSite=None', () => {
    expect(refreshCookieOptions(new Date(), { isProd: true, sameSite: 'strict' })).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      path: '/api/auth',
    });
    expect(refreshCookieOptions(undefined, { isProd: false, sameSite: 'none' }).secure).toBe(true);
    // Sletning bruger samme attributter (ellers sletter browseren den ikke).
    expect(refreshCookieOptions(undefined, { isProd: true, sameSite: 'strict' })).not.toHaveProperty('expires');
  });
});

describe('refresh-tokens', () => {
  it('roteres ved hver fornyelse', async () => {
    const { cookie } = await register('rotation@session.test');
    const first = await refresh(cookie).expect(200);
    const next = refreshCookie(first)!;
    expect(next).toBeDefined();
    expect(next).not.toBe(cookie);
    const again = refreshCookie(await refresh(next).expect(200))!;
    expect(again).not.toBe(next);
  });

  it('ugyldiggøres ved logout', async () => {
    const { cookie } = await register('logout@session.test');
    await request(app).post('/api/auth/logout').set('Cookie', cookie).expect(204);
    await refresh(cookie).expect(401);
  });

  it('ugyldiggøres alle ved skift af adgangskode – den nye session virker', async () => {
    const { cookie, auth } = await register('password@session.test');
    const otherDevice = await login('password@session.test');
    const res = await request(app)
      .post('/api/auth/change-password')
      .set(auth)
      .set('Cookie', cookie)
      .send({ currentPassword: PASSWORD, newPassword: 'ny-hemmelig-456' })
      .expect(200);
    await refresh(cookie).expect(401);
    await refresh(otherDevice).expect(401);
    await refresh(refreshCookie(res)!).expect(200);
  });

  it('ugyldiggøres alle ved nulstilling af adgangskode', async () => {
    const { cookie } = await register('reset@session.test');
    await request(app).post('/api/auth/forgot-password').send({ email: 'reset@session.test' }).expect(200);
    await new Promise((r) => setTimeout(r, 50)); // mailen sendes i baggrunden
    await request(app)
      .post('/api/auth/reset-password')
      .send({ token: linkToken('reset@session.test'), password: 'ny-hemmelig-789' })
      .expect(200);
    await refresh(cookie).expect(401);
  });

  it('ugyldiggøres ved skift af e-mail – browseren der bekræfter, forbliver logget ind', async () => {
    const { cookie, auth } = await register('gammel@session.test');
    const otherDevice = await login('gammel@session.test');
    await request(app).post('/api/auth/change-email').set(auth).send({ newEmail: 'ny@session.test', password: PASSWORD }).expect(200);
    const res = await request(app)
      .post('/api/auth/verify-email')
      .set('Cookie', cookie)
      .send({ token: linkToken('ny@session.test') })
      .expect(200);
    expect(res.body.user.email).toBe('ny@session.test');
    // Den anden enhed er logget ud, også den gamle cookie i denne browser.
    await refresh(otherDevice).expect(401);
    await refresh(cookie).expect(401);
    // Browseren, der klikkede på linket, har fået en ny session.
    const kept = refreshCookie(res);
    expect(kept).toBeDefined();
    await refresh(kept!).expect(200);
  });

  it('bekræftes e-mailskiftet i en anden browser, logges alle ud', async () => {
    const { cookie, auth } = await register('flyt@session.test');
    await request(app).post('/api/auth/change-email').set(auth).send({ newEmail: 'flyttet@session.test', password: PASSWORD }).expect(200);
    const res = await request(app).post('/api/auth/verify-email').send({ token: linkToken('flyttet@session.test') }).expect(200);
    expect(refreshCookie(res)).toBeUndefined();
    await refresh(cookie).expect(401);
  });
});
