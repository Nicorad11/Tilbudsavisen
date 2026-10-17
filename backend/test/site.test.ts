import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { configTag, mountSite, robotsTxt, seoTags, sitemapXml } from '../src/http/site';

const dist = mkdtempSync(path.join(tmpdir(), 'tr-site-'));
writeFileSync(
  path.join(dist, 'index.html'),
  '<html><head><!--seo--><title>Standard</title><!--/seo--></head><body><div id="root"></div></body></html>',
);
writeFileSync(path.join(dist, 'sw.js'), 'self.addEventListener("fetch", () => {});');
writeFileSync(path.join(dist, 'admin.html'), '<html><head><title>Admin</title><!--config--></head><body><div id="root"></div></body></html>');

const app = express();
mountSite(app, dist);

afterAll(() => rmSync(dist, { recursive: true, force: true }));

describe('SEO og statiske sider', () => {
  it('indsætter titel, canonical og Open Graph pr. side', async () => {
    const res = await request(app).get('/priser');
    expect(res.status).toBe(200);
    expect(res.text).not.toContain('<title>Standard</title>');
    expect(res.text).toContain('<title>Priser – 49 kr/md, 14 dage gratis | Tilbudsradar</title>');
    expect(res.text).toContain('<link rel="canonical" href="https://tilbudsradar.test/priser" />');
    expect(res.text).toContain('<meta property="og:image" content="https://tilbudsradar.test/og-image.png" />');
    expect(res.headers['cache-control']).toBe('no-cache');
  });

  it('giver frontenden firmaoplysninger m.m. som JSON uden hemmeligheder', async () => {
    const res = await request(app).get('/');
    const match = /<script id="tr-config" type="application\/json">(.*?)<\/script>/.exec(res.text);
    expect(match).not.toBeNull();
    const config = JSON.parse(match![1]!);
    expect(config).toMatchObject({ contactEmail: 'kontakt@tilbudsradar.test', appUrl: 'https://tilbudsradar.test' });
    expect(res.text).not.toContain('sk_test_');
    expect(res.text).not.toContain('whsec_');
    expect(configTag()).not.toMatch(/<(?!script|\/script)/);
  });

  it('private app-sider får noindex, ukendte sider får 404', async () => {
    expect(seoTags('/app/konto')).toContain('noindex');
    expect(seoTags('/app/betaling/gennemfoert')).toContain('noindex');
    expect(seoTags('/app/sog')).not.toContain('noindex');

    const missing = await request(app).get('/findes-ikke');
    expect(missing.status).toBe(404);
    expect(missing.text).toContain('noindex');
    expect((await request(app).get('/app/kvitteringer/abc')).status).toBe(200);
  });

  it('escaper ikke-betroede stier i canonical', () => {
    expect(seoTags('/app/"><script>')).not.toContain('<script>');
  });

  it('omdirigerer gamle adresser permanent til /app med query', async () => {
    const res = await request(app).get('/konto?opret=1');
    expect(res.status).toBe(301);
    expect(res.headers.location).toBe('/app/konto?opret=1');
    expect((await request(app).get('/kvitteringer/42')).headers.location).toBe('/app/kvitteringer/42');
    expect((await request(app).get('/kontakt')).status).toBe(404);
  });

  it('robots.txt og sitemap.xml bruger APP_URL og skjuler private sider', async () => {
    expect(robotsTxt()).toContain('Sitemap: https://tilbudsradar.test/sitemap.xml');
    expect(robotsTxt()).toContain('Disallow: /api/');
    const xml = sitemapXml();
    expect(xml).toContain('<loc>https://tilbudsradar.test/priser</loc>');
    expect(xml).not.toContain('/app/konto');
    const res = await request(app).get('/robots.txt');
    expect(res.status).toBe(200);
    expect(res.type).toBe('text/plain');
  });

  it('service worker caches aldrig af browseren', async () => {
    const res = await request(app).get('/sw.js');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-cache');
  });
});

describe('admin-appen på admin-domænet', () => {
  const admin = (url: string) => request(app).get(url).set('Host', 'admin.tilbudsradar.test');

  it('admin-domænet viser admin-appen på alle stier – med konfiguration og noindex', async () => {
    for (const url of ['/', '/kunder', '/kunder/123', '/konto']) {
      const res = await admin(url);
      expect(res.status).toBe(200);
      expect(res.text).toContain('<title>Admin</title>');
      expect(res.text).toContain('<script id="tr-config"');
      expect(res.headers['x-robots-tag']).toBe('noindex, nofollow');
    }
    expect((await admin('/robots.txt')).text).toContain('Disallow: /\n');
    expect((await admin('/sitemap.xml')).status).toBe(404);
  });

  it('hjemmesiden udleverer aldrig admin-appen', async () => {
    const res = await request(app).get('/admin.html');
    expect(res.status).toBe(404);
    expect(res.text).not.toContain('<title>Admin</title>');
    expect((await request(app).get('/kunder')).status).toBe(404);
    // Kilder-siden er flyttet til admin-appen – den gamle adresse findes ikke længere.
    expect((await request(app).get('/kilder')).status).toBe(404);
  });
});
