import type { ScraperConfig } from './config';
import type { Logger } from './log';

export interface ScraperAlert {
  level: 'warn' | 'error';
  sourceId: string;
  title: string;
  message: string;
}

export interface Notifier {
  notify(alert: ScraperAlert): Promise<void>;
}

/**
 * Sender fejl fra scrapere til log + Slack-webhook og/eller e-mail.
 * Samme fejl fra samme kilde sendes højst én gang pr. `cooldownMs`, så en
 * kæde der har ændret sin side ikke spammer ved hver kørsel.
 */
export function createNotifier(
  config: Pick<ScraperConfig, 'slackWebhookUrl' | 'smtpUrl' | 'alertEmailTo' | 'mailFrom'>,
  log: Logger,
  cooldownMs = 6 * 60 * 60 * 1000,
): Notifier {
  const lastSent = new Map<string, number>();

  return {
    async notify(alert) {
      const line = `[${alert.sourceId}] ${alert.title}: ${alert.message}`;
      if (alert.level === 'error') log.error(line);
      else log.warn(line);

      const key = `${alert.sourceId}|${alert.title}`;
      const now = Date.now();
      if (now - (lastSent.get(key) ?? 0) < cooldownMs) return;
      lastSent.set(key, now);

      const tasks: Promise<unknown>[] = [];
      if (config.slackWebhookUrl) {
        tasks.push(
          fetch(config.slackWebhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              text: `${alert.level === 'error' ? ':rotating_light:' : ':warning:'} *TilbudsRadar – ${alert.title}*\nKilde: \`${alert.sourceId}\`\n${alert.message}`,
            }),
            signal: AbortSignal.timeout(10_000),
          }),
        );
      }
      if (config.smtpUrl && config.alertEmailTo) {
        tasks.push(
          (async () => {
            const nodemailer = await import('nodemailer');
            const transport = nodemailer.createTransport(config.smtpUrl!);
            await transport.sendMail({
              from: config.mailFrom,
              to: config.alertEmailTo!,
              subject: `TilbudsRadar: ${alert.title} (${alert.sourceId})`,
              text: `${alert.message}\n\nKilde: ${alert.sourceId}\nTidspunkt: ${new Date().toISOString()}`,
            });
          })(),
        );
      }
      const results = await Promise.allSettled(tasks);
      for (const r of results) {
        if (r.status === 'rejected') log.warn('Kunne ikke sende scraper-notifikation', { err: String(r.reason) });
      }
    },
  };
}
