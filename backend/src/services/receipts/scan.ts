import { mkdirSync } from 'node:fs';
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import type { ParsedReceipt } from '@tilbudsradar/shared';
import { CHAINS } from '@tilbudsradar/scrapers';
import sharp, { type OutputInfo } from 'sharp';
import { createWorker, PSM, type Worker } from 'tesseract.js';
import { z } from 'zod';
import { env, log } from '../../env';
import { HttpError } from '../../http/errors';
import { ACTIVE_CHAIN_IDS } from '../scope';
import { finalizeReceipt, localDateTimeToIso, parseReceiptText } from './parseText';

/**
 * Aflæser et foto af en kvittering. Med ANTHROPIC_API_KEY læser Claude billedet
 * (klarer krøllet papir, skygger og fingre over teksten); ellers bruges
 * tekstgenkendelse (tesseract) på serveren efterfulgt af tekst-parseren.
 * Billedet behandles kun i hukommelsen og gemmes aldrig.
 */
export async function scanReceiptImage(buffer: Buffer): Promise<ParsedReceipt> {
  let oriented: { data: Buffer; info: OutputInfo };
  try {
    // rotate() uden argument retter telefonens EXIF-orientering.
    oriented = await sharp(buffer, { failOn: 'none' }).rotate().toBuffer({ resolveWithObject: true });
  } catch {
    throw new HttpError(415, 'Billedet kunne ikke læses. Brug et JPEG- eller PNG-billede.');
  }

  if (env.ANTHROPIC_API_KEY) {
    try {
      const parsed = await readWithClaude(oriented.data);
      if (parsed) return parsed;
    } catch (err) {
      if (err instanceof HttpError) throw err;
      log.warn(`Claude kunne ikke læse kvitteringen – bruger tekstgenkendelse: ${(err as Error).message}`);
    }
  }
  return readWithOcr(oriented.data, oriented.info.width);
}

/* ------------------------------------------------------------------ */
/* Claude                                                             */
/* ------------------------------------------------------------------ */

const CHAIN_IDS = ACTIVE_CHAIN_IDS as [string, ...string[]];

const ScanSchema = z.object({
  isReceipt: z.boolean(),
  chain: z.enum([...CHAIN_IDS, 'andet']),
  purchasedAt: z.string().nullable(),
  total: z.number().nullable(),
  lines: z.array(
    z.object({
      kind: z.enum(['item', 'discount', 'deposit']),
      name: z.string(),
      quantity: z.number(),
      unit: z.enum(['stk', 'kg']),
      unitPrice: z.number().nullable(),
      amount: z.number(),
      uncertain: z.boolean(),
    }),
  ),
});

const SYSTEM_PROMPT = `Du aflæser fotos af danske kassebonner fra supermarkeder. Skriv det der står – gæt ikke.

Linjer:
- Tag varelinjerne med i den rækkefølge de står, fra første vare til linjen før SUM/TOTAL.
- kind "item" er en vare. name er teksten som trykt, uden momskoden (fx "B" eller "A") til højre.
- "12,00 x 2" betyder unitPrice 12 og quantity 2. Står der kun et beløb, er quantity 1 og unitPrice beløbet.
- En vægtvare ("0,979 kg x 149,90 DKK/kg") er én linje med unit "kg", quantity = vægten, unitPrice = kiloprisen
  og amount = linjens beløb. Vægtangivelsen er ikke en linje for sig.
- kind "discount" er en rabat ("Rabat", "Lidl Plus-tilbud", "Mængderabat", "Kupon") med negativt amount. Den står
  lige under den vare den hører til – bevar rækkefølgen.
- kind "deposit" er pant.
- Udelad SUM/TOTAL, betalingslinjer (kontant, kort, MobilePay, byttepenge), moms og tekster om hvad man har sparet.
- uncertain er true, hvis navn eller beløb ikke kan læses sikkert, fx fordi det er skjult af en finger, sløret eller krøllet.

Øvrige felter:
- chain er kæden bag kvitteringen ud fra logo, navn eller CVR; "andet" hvis det ikke er en af de kendte kæder.
- purchasedAt er købets tidspunkt i lokal tid som "YYYY-MM-DDTHH:mm" (to-cifrede årstal er 20xx), ellers null.
- total er beløbet ud for SUM/TOTAL/I ALT, ellers null.
- isReceipt er false, hvis billedet ikke viser en kvittering.`;

async function readWithClaude(image: Buffer): Promise<ParsedReceipt | null> {
  // Opus 5 læser op til 2576 px på den lange led – nok til en hel bon i ét billede.
  const jpeg = await sharp(image)
    .resize({ width: 2576, height: 2576, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 88 })
    .toBuffer();
  const chains = CHAINS.map((c) => `${c.id} = ${c.name}`).join(', ');
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const response = await client.beta.messages.parse(
    {
      model: env.ANTHROPIC_MODEL,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: jpeg.toString('base64') } },
            { type: 'text', text: `Aflæs kvitteringen. Kendte kæder: ${chains}.` },
          ],
        },
      ],
      output_config: {
        format: betaZodOutputFormat(ScanSchema),
        ...(env.ANTHROPIC_EFFORT ? { effort: env.ANTHROPIC_EFFORT } : {}),
      },
    },
    { timeout: 180_000 },
  );

  if (response.stop_reason === 'refusal' || response.stop_reason === 'max_tokens') {
    log.warn(`Kvitteringen blev ikke aflæst af Claude (${response.stop_reason})`);
    return null;
  }
  const out = response.parsed_output;
  if (!out) return null;
  if (!out.isReceipt) throw new HttpError(422, 'Billedet ligner ikke en kvittering. Prøv med et nyt billede.');

  return finalizeReceipt({
    storeId: out.chain === 'andet' ? null : out.chain,
    purchasedAt: localDateTimeToIso(out.purchasedAt),
    total: out.total,
    lines: out.lines.map((l) => ({ ...l, uncertain: l.uncertain || undefined })),
    source: 'claude',
    warnings: [],
  });
}

/* ------------------------------------------------------------------ */
/* Tekstgenkendelse                                                   */
/* ------------------------------------------------------------------ */

let workerPromise: Promise<Worker> | null = null;
let queue: Promise<unknown> = Promise.resolve();

function getWorker(): Promise<Worker> {
  workerPromise ??= (async () => {
    mkdirSync(env.OCR_CACHE_DIR, { recursive: true });
    const worker = await createWorker('dan', 1, { cachePath: env.OCR_CACHE_DIR });
    await worker.setParameters({
      tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
      preserve_interword_spaces: '1',
      user_defined_dpi: '300',
    });
    return worker;
  })().catch((err: unknown) => {
    workerPromise = null;
    throw err;
  });
  return workerPromise;
}

async function readWithOcr(image: Buffer, width: number): Promise<ParsedReceipt> {
  // Små billeder forstørres (tesseract vil have ~30 px høje bogstaver); store skaleres ned.
  const target = width < 1400 ? Math.min(width * 2, 2400) : Math.min(width, 2600);
  const png = await sharp(image).grayscale().normalize().resize({ width: target }).sharpen().png().toBuffer();

  let worker: Worker;
  try {
    worker = await getWorker();
  } catch (err) {
    log.error(`Tekstgenkendelsen kunne ikke starte: ${(err as Error).message}`);
    throw new HttpError(503, 'Tekstgenkendelsen kunne ikke starte. Prøv igen, eller indsæt teksten fra en e-kvittering.');
  }
  // Én genkendelse ad gangen pr. worker.
  const run = queue.then(() => worker.recognize(png));
  queue = run.catch(() => undefined);
  const { data } = await run;

  const parsed = parseReceiptText(data.text, { chains: ACTIVE_CHAIN_IDS, source: 'ocr' });
  if (!parsed.lines.length) {
    throw new HttpError(422, 'Der kunne ikke læses nogen varer. Tag billedet lige oppefra i godt lys.');
  }
  return parsed;
}
