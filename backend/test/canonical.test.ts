import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { canonicalHost } from '../src/http/canonical';
import { trustProxy } from '../src/http/clientIp';
import { isAdminHost } from '../src/http/site';

// Som i produktion: trust proxy er slået til, så X-Forwarded-Host ville påvirke req.hostname.
const app = express();
app.set('trust proxy', trustProxy);
app.use(canonicalHost('https://tilbudsradaren.dk'));
app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.all('/{*rest}', (req, res) => res.json({ path: req.originalUrl, admin: isAdminHost(req) }));

const on = (host: string, url: string) => request(app).get(url).set('Host', host);

describe('kanonisk domæne', () => {
  it('omdirigerer onrender.com og www permanent til samme sti og query', async () => {
    for (const host of ['tilbudsradar.onrender.com', 'www.tilbudsradaren.dk']) {
      const res = await on(host, '/priser?ref=instagram&x=1').expect(301);
      expect(res.headers.location).toBe('https://tilbudsradaren.dk/priser?ref=instagram&x=1');
    }
    expect((await on('tilbudsradar.onrender.com', '/').expect(301)).headers.location).toBe('https://tilbudsradaren.dk/');
  });

  it('POST bevarer metoden (308)', async () => {
    const res = await request(app).post('/api/auth/login').set('Host', 'tilbudsradar.onrender.com').send({}).expect(308);
    expect(res.headers.location).toBe('https://tilbudsradaren.dk/api/auth/login');
  });

  it('det kanoniske domæne og admin-domænet svarer normalt – også med port', async () => {
    await on('tilbudsradaren.dk', '/priser').expect(200);
    await on('tilbudsradaren.dk:443', '/priser').expect(200);
    await on('TILBUDSRADAREN.DK', '/priser').expect(200);
    await on('admin.tilbudsradaren.dk', '/kunder').expect(200);
  });

  it('/api/health er undtaget, så Renders health check virker på alle værtsnavne', async () => {
    await on('tilbudsradar.onrender.com', '/api/health').expect(200);
    await on('10.0.0.7:10000', '/api/health').expect(200);
  });

  it('X-Forwarded-Host kan hverken undgå omdirigeringen eller åbne admin-appen', async () => {
    const res = await on('tilbudsradar.onrender.com', '/priser').set('X-Forwarded-Host', 'tilbudsradaren.dk').expect(301);
    expect(res.headers.location).toBe('https://tilbudsradaren.dk/priser');
    const main = await on('tilbudsradaren.dk', '/').set('X-Forwarded-Host', 'admin.tilbudsradaren.dk').expect(200);
    expect(main.body.admin).toBe(false);
    expect((await on('admin.tilbudsradaren.dk', '/').expect(200)).body.admin).toBe(true);
  });

  it('omdirigerer aldrig til et andet domæne', async () => {
    const res = await on('evil.example', '//evil.example/x').expect(301);
    expect(res.headers.location).toBe('https://tilbudsradaren.dk//evil.example/x');
  });
});
