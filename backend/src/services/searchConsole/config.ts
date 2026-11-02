import { env } from '../../env';

/**
 * Opsætningen af Search Console-integrationen ud fra miljøvariablerne.
 * Ugyldige værdier vælter aldrig serveren – integrationen er så slået fra,
 * og admin viser grunden. Den private nøgle kommer aldrig med i en grund,
 * en log eller et svar til frontenden.
 */

export type GscConfig =
  | { enabled: true; clientEmail: string; privateKey: string; siteUrl: string }
  | { enabled: false; reason: string; clientEmail: string | null; siteUrl: string | null };

const SITE_URL = /^(sc-domain:[a-z0-9.-]+|https?:\/\/[^\s]+\/)$/i;

export function parseGscConfig(input: { serviceAccountJson: string | null; siteUrl: string | null }): GscConfig {
  const siteUrl = input.siteUrl?.trim() || null;
  if (!input.serviceAccountJson && !siteUrl) {
    return { enabled: false, reason: 'GSC_SERVICE_ACCOUNT_JSON og GSC_SITE_URL er ikke sat.', clientEmail: null, siteUrl: null };
  }

  let clientEmail: string | null = null;
  let privateKey: string | null = null;
  let keyProblem: string | null = null;
  if (!input.serviceAccountJson) {
    keyProblem = 'GSC_SERVICE_ACCOUNT_JSON er ikke sat.';
  } else {
    try {
      const raw = input.serviceAccountJson.trim();
      // Base64 som aftalt – men en rå JSON-nøgle accepteres også, så en kopi-fejl ikke stopper alt.
      const text = raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
      const parsed = JSON.parse(text) as { client_email?: unknown; private_key?: unknown; type?: unknown };
      if (typeof parsed.client_email === 'string') clientEmail = parsed.client_email;
      if (typeof parsed.private_key === 'string' && parsed.private_key.includes('PRIVATE KEY')) privateKey = parsed.private_key;
      if (parsed.type !== undefined && parsed.type !== 'service_account') keyProblem = 'Nøglen er ikke en service account-nøgle (type skal være "service_account").';
      else if (!clientEmail || !privateKey) keyProblem = 'Nøglen mangler client_email eller private_key – brug JSON-nøglen fra service accounten.';
    } catch {
      keyProblem = 'GSC_SERVICE_ACCOUNT_JSON kan ikke læses – den skal være JSON-nøglen base64-kodet (se docs/SEARCH_CONSOLE.md).';
    }
  }

  const siteProblem = !siteUrl
    ? 'GSC_SITE_URL er ikke sat (fx sc-domain:tilbudsradaren.dk).'
    : !SITE_URL.test(siteUrl)
      ? 'GSC_SITE_URL skal være "sc-domain:domæne" eller en adresse, der slutter med "/" (fx https://tilbudsradaren.dk/).'
      : null;

  if (keyProblem || siteProblem || !clientEmail || !privateKey || !siteUrl) {
    return { enabled: false, reason: [keyProblem, siteProblem].filter(Boolean).join(' '), clientEmail, siteUrl };
  }
  return { enabled: true, clientEmail, privateKey, siteUrl };
}

let cachedConfig: GscConfig | null = null;

/** Opsætningen fra miljøvariablerne (læses én gang). */
export function gscConfig(): GscConfig {
  cachedConfig ??= parseGscConfig({ serviceAccountJson: env.GSC_SERVICE_ACCOUNT_JSON, siteUrl: env.GSC_SITE_URL });
  return cachedConfig;
}

/** Hvad admin må se om opsætningen – aldrig nøglen. */
export function publicGscStatus(c: GscConfig = gscConfig()) {
  return { configured: c.enabled, reason: c.enabled ? null : c.reason, clientEmail: c.clientEmail, siteUrl: c.siteUrl };
}
