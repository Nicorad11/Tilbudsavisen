import { env, log } from '../env';

/** Sender e-mail hvis SMTP_URL er sat – ellers logges beskeden blot. */
export async function sendMail(to: string, subject: string, text: string): Promise<boolean> {
  if (!env.SMTP_URL) {
    log.info(`(e-mail ikke konfigureret) til ${to}: ${subject}`);
    return false;
  }
  try {
    const nodemailer = await import('nodemailer');
    await nodemailer.createTransport(env.SMTP_URL).sendMail({ from: env.MAIL_FROM, to, subject, text });
    return true;
  } catch (err) {
    log.warn('E-mail kunne ikke sendes', { err: String(err) });
    return false;
  }
}
