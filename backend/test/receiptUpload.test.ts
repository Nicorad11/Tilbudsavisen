import type { AuthResponse } from '@tilbudsradar/shared';
import { silentLogger } from '@tilbudsradar/scrapers';
import sharp from 'sharp';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type Database } from '../src/db/client';
import { createApp } from '../src/http/app';
import { detectReceiptImage, MAX_RECEIPT_IMAGE_BYTES } from '../src/services/receipts/imageType';
import { prepareReceiptImage } from '../src/services/receipts/scan';
import { ScrapeManager } from '../src/services/scrapeJobs';

const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><rect width="10" height="10"/></svg>');
const HTML = Buffer.from('<!doctype html><script>alert(1)</script>');
const PDF = Buffer.from('%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\n');
const GIF = Buffer.from('GIF89a\x01\x00\x01\x00\x00\x00\x00;', 'latin1');

/** Et lille, rigtigt JPEG med kamera- og GPS-oplysninger i EXIF. */
const jpegWithGps = () =>
  sharp({ create: { width: 40, height: 20, channels: 3, background: '#ffffff' } })
    .jpeg()
    .withExif({ IFD0: { Make: 'Telefon', Model: 'Kamera 1' }, IFD3: { GPSLatitudeRef: 'N', GPSMapDatum: 'WGS-84' } })
    .toBuffer();

describe('filtype genkendes på indholdet', () => {
  it('kender JPEG, PNG, WebP og HEIC', async () => {
    const image = sharp({ create: { width: 4, height: 4, channels: 3, background: '#fff' } });
    expect(detectReceiptImage(await image.clone().jpeg().toBuffer())).toBe('jpeg');
    expect(detectReceiptImage(await image.clone().png().toBuffer())).toBe('png');
    expect(detectReceiptImage(await image.clone().webp().toBuffer())).toBe('webp');
    const heic = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypheic'), Buffer.alloc(12)]);
    expect(detectReceiptImage(heic)).toBe('heif');
  });

  it('afviser SVG, HTML, PDF, GIF og tomme filer', () => {
    for (const file of [SVG, HTML, PDF, GIF, Buffer.alloc(0)]) expect(detectReceiptImage(file)).toBeNull();
  });

  it('fjerner EXIF/GPS, før billedet sendes videre', async () => {
    const input = await jpegWithGps();
    expect((await sharp(input).metadata()).exif).toBeDefined();
    const prepared = await prepareReceiptImage(input);
    const meta = await sharp(prepared.data).metadata();
    expect(meta.exif).toBeUndefined();
    expect(prepared.info.width).toBe(40);
  });
});

describe('POST /api/receipts/scan', () => {
  let database: Database;
  let app: ReturnType<typeof createApp>;
  let auth: { Authorization: string };

  beforeAll(async () => {
    database = await createDatabase({ url: null, dataDir: 'memory://' });
    await database.migrate();
    const scrape = new ScrapeManager(database.db, silentLogger);
    await scrape.syncRegistry();
    app = createApp({ db: database.db, scrape, stripe: null });
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'scan@upload.test', password: 'hemmelig123', acceptTerms: true })
      .expect(201);
    auth = { Authorization: `Bearer ${(res.body as AuthResponse).accessToken}` };
  });

  afterAll(async () => {
    await database?.close();
  });

  const upload = (body: Buffer, type = 'image/png') => request(app).post('/api/receipts/scan').set(auth).set('Content-Type', type).send(body);

  it('afviser filer der udgiver sig for at være billeder – svaret er JSON, aldrig filen', async () => {
    for (const file of [SVG, HTML, PDF, GIF]) {
      const res = await upload(file);
      expect(res.status).toBe(415);
      expect(res.headers['content-type']).toMatch(/^application\/json/);
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.text).not.toContain('<script');
      expect(res.text).not.toContain('<svg');
    }
  });

  it('afviser filer over størrelsesgrænsen', async () => {
    const big = Buffer.alloc(MAX_RECEIPT_IMAGE_BYTES + 1, 0xff);
    big.set([0xff, 0xd8, 0xff], 0);
    await upload(big, 'image/jpeg').expect(413);
  });

  it('tager kun imod billed-Content-Types', async () => {
    await upload(await jpegWithGps(), 'text/html').expect(400);
  });
});
