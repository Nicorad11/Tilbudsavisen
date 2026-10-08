import nodemailer, { type Transporter } from 'nodemailer';
import { env, log } from '../env';

export interface Mail {
  to: string;
  subject: string;
  html: string;
  text: string;
  attachments?: { filename: string; content: string; contentType?: string }[];
}

/** I test sendes intet – mails lægges her, så testene kan læse links og tokens. */
export const testOutbox: Mail[] = [];

let transporter: Transporter | null = null;

/**
 * Sender en e-mail via SMTP_URL (fx Resend eller Postmark). Uden SMTP_URL
 * logges kun emnet – i udvikling også teksten, så links kan klikkes lokalt.
 * Returnerer false i stedet for at kaste, så en mailfejl aldrig vælter en handling.
 */
export async function sendMail(mail: Mail): Promise<boolean> {
  if (env.isTest) {
    testOutbox.push(mail);
    return true;
  }
  if (!env.SMTP_URL) {
    log.info(`(e-mail ikke konfigureret) ${mail.subject}`);
    if (!env.isProd) console.log(`\n---- e-mail til ${mail.to} ----\n${mail.text}\n----\n`);
    return false;
  }
  try {
    transporter ??= nodemailer.createTransport(env.SMTP_URL);
    await transporter.sendMail({ from: env.MAIL_FROM, ...mail });
    return true;
  } catch (err) {
    log.warn('E-mail kunne ikke sendes', { subject: mail.subject, err: (err as Error).message });
    return false;
  }
}

/** Send uden at vente – til svar der ikke må afsløre, om en e-mail findes. */
export function sendMailInBackground(mail: Mail): void {
  void sendMail(mail).catch(() => undefined);
}
