import type { ScrapedOffer } from '@tilbudsradar/shared';
import { z } from 'zod';

const finitePositive = z.number().positive().finite();

const scrapedOfferSchema = z
  .object({
    storeId: z.string().min(1),
    sourceId: z.string().min(1),
    externalId: z.string().min(1).max(500),
    productName: z.string().trim().min(2).max(500),
    normalizedProductName: z.string().min(1).max(500),
    category: z.string().min(1),
    originalPrice: finitePositive.nullable(),
    offerPrice: finitePositive.max(500_000),
    unit: z.enum(['stk', 'kg', 'l']),
    validFrom: z.date(),
    validTo: z.date(),
    imageUrl: z.url().nullable(),
    sourceUrl: z.url(),
    quantity: z.object({ min: finitePositive, max: finitePositive }).nullish(),
    unitPrice: finitePositive.max(1_000_000).nullish(),
    unitPriceMax: finitePositive.max(1_000_000).nullish(),
  })
  .refine((o) => o.validTo.getTime() >= o.validFrom.getTime(), { message: 'validTo ligger før validFrom' })
  .refine((o) => o.originalPrice === null || o.originalPrice < o.offerPrice * 20, {
    message: 'førprisen er urealistisk høj',
  });

export type ValidationResult = { ok: true } | { ok: false; reason: string };

export function validateOffer(offer: ScrapedOffer): ValidationResult {
  const result = scrapedOfferSchema.safeParse(offer);
  if (result.success) return { ok: true };
  const issue = result.error.issues[0];
  return { ok: false, reason: issue ? `${issue.path.join('.') || 'tilbud'}: ${issue.message}` : 'ugyldigt tilbud' };
}
