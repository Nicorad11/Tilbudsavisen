import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type Database } from '../src/db/client';
import { configTag, mountSite, publicConfig } from '../src/http/site';
import { createSsr, type Ssr, type SsrModule } from '../src/http/ssr';

/**
 * Server-rendering af de offentlige sider – kørt direkte på frontendens kilde
 * (frontend/src/entry-server.tsx), så testen ikke kræver et build.
 */

// Som index.html efter et Vite-build: SEO-blokken og en tom rod.
const TEMPLATE = `<!doctype html><html lang="da"><head><meta charset="UTF-8" />
    <!--seo--><title>Standard</title><!--/seo-->
  </head><body><div id="root"></div><script type="module" src="/assets/main.js"></script></body></html>`;

let database: Database;
let ssr: Ssr;

/** Den synlige tekst i <body> uden scripts – det en crawler uden JavaScript ser. */
const visibleText = (html: string) =>
  html
    .slice(html.indexOf('<body'))
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
const h1 = (html: string) => /<h1\b[^>]*>([\s\S]*?)<\/h1>/.exec(html)?.[1]?.replace(/<[^>]+>/g, '').trim();

beforeAll(async () => {
  database = await createDatabase({ url: null, dataDir: 'memory://' });
  await database.migrate();
  // Frontendens CONFIG læses ved indlæsning – som i loadSsrModule.
  (globalThis as { __TR_CONFIG__?: unknown }).__TR_CONFIG__ = publicConfig();
  const entry = path.resolve(import.meta.dirname, '../../frontend/src/entry-server.tsx');
  const module = (await import(/* @vite-ignore */ entry)) as SsrModule;
  ssr = createSsr({ db: database.db, module, template: TEMPLATE, configTag: configTag() });
}, 120_000);

afterAll(async () => {
  await database?.close();
});

describe('server-renderede offentlige sider', () => {
  const pages: [string, RegExp][] = [
    ['/', /Alle tilbudsaviser/],
    ['/priser', /Én pris\. Alle funktioner\./],
    ['/om', /Om Tilbudsradar/],
    ['/fortryd', /Fortryd/],
    ['/handelsbetingelser', /Handelsbetingelser/],
    ['/privatlivspolitik', /Privatlivspolitik/],
    ['/cookies', /Cookies/],
  ];

  for (const [url, title] of pages) {
    it(`${url}: H1, brødtekst, links og canonical uden JavaScript`, async () => {
      const page = await ssr.render(url);
      expect(page.status).toBe(200);
      expect(h1(page.html)).toMatch(title);
      expect(visibleText(page.html).length).toBeGreaterThan(400);
      // Interne links (header, footer) findes i HTML'en.
      expect(page.html).toMatch(/<a [^>]*href="\/priser"/);
      expect(page.html).toMatch(/<a [^>]*href="\/handelsbetingelser"/);
      const canonical = url === '/' ? 'https://tilbudsradar.test/' : `https://tilbudsradar.test${url}`;
      expect(page.html).toContain(`<link rel="canonical" href="${canonical}" />`);
      expect(page.html).toContain('<meta name="robots" content="max-image-preview:large, max-snippet:-1" />');
      expect(page.html).not.toContain('<title>Standard</title>');
      // Uden COMPANY_NAME og COMPANY_ADDRESS vises hverken navn, adresse eller pladsholdere.
      expect(page.html).not.toContain('UDFYLD');
      expect(page.html).toMatch(/© (<!-- -->)?\d{4}(<!-- -->)? (<!-- -->)?Tilbudsradar/);
      // Konfiguration og query-data til hydrering ligger som JSON – ikke som kode, der udføres.
      expect(page.html).toContain('<script id="tr-config" type="application/json">');
      expect(page.html).toContain('<script id="tr-state" type="application/json">');
    });
  }

  it('forsiden får statistikken med til hydrering', async () => {
    const page = await ssr.render('/');
    const state = JSON.parse(/<script id="tr-state" type="application\/json">([\s\S]*?)<\/script>/.exec(page.html)![1]!) as {
      queries: { queryKey: unknown[] }[];
    };
    expect(state.queries.map((q) => q.queryKey)).toContainEqual(['stats']);
  });

  it('serveren renderer altid "logget ud" og bruger serverens firmaoplysninger', async () => {
    const page = await ssr.render('/priser');
    expect(page.html).toContain('Log ind');
    expect(page.html).not.toContain('Åbn appen');
    expect(page.html).toContain('kontakt@tilbudsradar.test');
  });

  it('ukendt side: 404 med noindex og uden canonical', async () => {
    const page = await ssr.render('/findes-ikke');
    expect(page.status).toBe(404);
    expect(page.html).toContain('<meta name="robots" content="noindex,follow" />');
    expect(page.html).not.toContain('rel="canonical"');
    expect(visibleText(page.html)).toContain('Siden findes ikke');
  });

  it('data i tr-state kan ikke lukke script-tagget', async () => {
    const page = await ssr.render('/');
    const state = /<script id="tr-state" type="application\/json">([\s\S]*?)<\/script>/.exec(page.html)![1]!;
    expect(state).not.toContain('<');
  });
});

describe('mountSite og SSR-bundlet', () => {
  const dist = mkdtempSync(path.join(tmpdir(), 'tr-ssr-'));
  mkdirSync(path.join(dist, 'server'));
  writeFileSync(path.join(dist, 'index.html'), TEMPLATE);
  writeFileSync(path.join(dist, 'server', 'entry-server.js'), 'export function render() { return { html: "", meta: null, state: {} }; }');
  afterAll(() => rmSync(dist, { recursive: true, force: true }));

  it('SSR-bundlet udleveres aldrig som offentlig fil', async () => {
    const app = express();
    mountSite(app, dist);
    const res = await request(app).get('/server/entry-server.js');
    expect(res.text).not.toContain('export function render');
  });

  it('/app renderes stadig i browseren (tom rod)', async () => {
    const app = express();
    mountSite(app, dist, { db: database.db });
    const res = await request(app).get('/app/sog').expect(200);
    expect(res.text).toContain('<div id="root"></div>');
  });
});
