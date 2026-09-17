export interface ScraperConfig {
  userAgent: string;
  minDelayMs: number;
  maxDelayMs: number;
  maxRequestsPerMinute: number;
  timeoutMs: number;
  maxRetries: number;
  defaultGeo: { lat: number; lng: number };
  disabledChains: string[];
  slackWebhookUrl: string | null;
  smtpUrl: string | null;
  alertEmailTo: string | null;
  mailFrom: string;
}

const num = (value: string | undefined, fallback: number) => {
  const n = Number(value);
  return value !== undefined && value !== '' && Number.isFinite(n) ? n : fallback;
};

const str = (value: string | undefined) => (value && value.trim() ? value.trim() : null);

export function loadScraperConfig(env: NodeJS.ProcessEnv = process.env): ScraperConfig {
  const minDelayMs = Math.max(250, num(env.SCRAPER_MIN_DELAY_MS, 1000));
  return {
    userAgent:
      str(env.SCRAPER_USER_AGENT) ??
      'TilbudsRadar/0.1 (+https://github.com/tilbudsradar; kontakt: tilbudsradar@example.com)',
    minDelayMs,
    maxDelayMs: Math.max(minDelayMs, num(env.SCRAPER_MAX_DELAY_MS, 3000)),
    maxRequestsPerMinute: Math.max(1, num(env.SCRAPER_MAX_REQUESTS_PER_MINUTE, 30)),
    timeoutMs: num(env.SCRAPER_TIMEOUT_MS, 20_000),
    maxRetries: num(env.SCRAPER_MAX_RETRIES, 3),
    defaultGeo: {
      lat: num(env.SCRAPER_DEFAULT_LAT, 55.6761),
      lng: num(env.SCRAPER_DEFAULT_LNG, 12.5683),
    },
    disabledChains: (env.DISABLED_CHAINS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    slackWebhookUrl: str(env.SLACK_WEBHOOK_URL),
    smtpUrl: str(env.SMTP_URL),
    alertEmailTo: str(env.ALERT_EMAIL_TO),
    mailFrom: str(env.MAIL_FROM) ?? 'TilbudsRadar <noreply@tilbudsradar.local>',
  };
}
