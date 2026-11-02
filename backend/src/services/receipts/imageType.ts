/**
 * Kvitteringsbilleder genkendes på filens indhold (magic bytes), ikke på
 * Content-Type, som klienten selv bestemmer. Kun de formater, telefoner og
 * appen sender: JPEG, PNG, WebP og HEIC/HEIF/AVIF. Alt andet (SVG, PDF, TIFF,
 * HTML …) afvises, før billedbehandlingen ser filen.
 */
export type ReceiptImageType = 'jpeg' | 'png' | 'webp' | 'heif';

/** Største billede der tages imod (frontenden skalerer normalt ned til ca. 1–2 MB). */
export const MAX_RECEIPT_IMAGE_BYTES = 12 * 1024 * 1024;

/** Største antal pixels der afkodes – beskytter mod "dekompressionsbomber" (lille fil, enormt billede). */
export const MAX_RECEIPT_IMAGE_PIXELS = 100_000_000;

/** ISO-BMFF-brands for HEIC/HEIF (iPhone) og AVIF. */
const HEIF_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1', 'avif', 'avis']);

const startsWith = (buf: Buffer, bytes: number[], offset = 0) =>
  buf.length >= offset + bytes.length && bytes.every((b, i) => buf[offset + i] === b);

export function detectReceiptImage(buf: Buffer): ReceiptImageType | null {
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return 'jpeg';
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  // RIFF....WEBP
  if (startsWith(buf, [0x52, 0x49, 0x46, 0x46]) && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
  // ....ftyp<brand>
  if (buf.length >= 12 && buf.subarray(4, 8).toString('latin1') === 'ftyp' && HEIF_BRANDS.has(buf.subarray(8, 12).toString('latin1'))) {
    return 'heif';
  }
  return null;
}
