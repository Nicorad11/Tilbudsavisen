import type { AdminMailResult } from '@tilbudsradar/shared';
import { and, eq, ne } from 'drizzle-orm';
import { Router, type Request } from 'express';
import { z } from 'zod';
import { users } from '../../db/schema';
import { log } from '../../env';
import { revokeAllForUser } from '../../services/auth';
import { cancelForAccountDeletion } from '../../services/billing';
import { customerDetail, findCustomer, listCustomers, logAdminEvent } from '../../services/customers';
import { appLink, changeEmailMail, resetPasswordMail, verifyEmailMail } from '../../services/emails';
import { sendMail } from '../../services/mailer';
import { createEmailToken } from '../../services/tokens';
import type { AppContext } from '../app';
import { HttpError, notFound, parse } from '../errors';

const DAY = 86_400_000;
/** Længste prøveperiode en administrator kan give – i praksis "gratis adgang". */
const MAX_TRIAL_DAYS = 3 * 365;

const listQuery = z.object({
  q: z.string().trim().max(200).optional(),
  filter: z.enum(['all', 'admin', 'launch', 'trial', 'active', 'past_due', 'canceled', 'expired']).default('all'),
  sort: z.enum(['created', 'lastSeen', 'email']).default('created'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(10).max(200).default(50),
});

const update = z
  .object({
    trialEndsAt: z.iso.datetime({ offset: true }).optional(),
    emailVerified: z.literal(true).optional(),
  })
  .refine((b) => b.trialEndsAt !== undefined || b.emailVerified !== undefined, 'Intet at ændre');

const email = z
  .email('Ugyldig e-mail')
  .max(254)
  .transform((v) => v.trim().toLowerCase());

const mailResult = (mailSent: boolean, sent: string): AdminMailResult => ({
  ok: true,
  mailSent,
  message: mailSent ? sent : 'Mailen kunne ikke sendes – e-mail er ikke sat op (SMTP_URL) eller fejlede. Se serverloggen.',
});

/** Kunder i admin-appen: søg, se, redigér, log ud og slet. Kræver administrator (sat i admin.ts). */
export function adminCustomerRoutes({ db, stripe }: AppContext): Router {
  const r = Router();
  const adminId = (req: Request) => req.auth?.sub ?? null;

  async function customer(req: Request) {
    const id = z.uuid().safeParse(req.params.id);
    const u = id.success ? await findCustomer(db, id.data) : null;
    if (!u) throw notFound('Kunden');
    return u;
  }

  r.get('/', async (req, res) => {
    res.json(await listCustomers(db, parse(listQuery, req.query)));
  });

  r.get('/:id', async (req, res) => {
    res.json(await customerDetail(db, await customer(req), adminId(req)));
  });

  /** Prøveperiode og e-mailbekræftelse. Abonnementet ændres i Stripe – webhooks overskriver ellers. */
  r.patch('/:id', async (req, res) => {
    const body = parse(update, req.body);
    const u = await customer(req);
    const now = Date.now();

    if (body.trialEndsAt !== undefined) {
      const end = new Date(body.trialEndsAt);
      if (end.getTime() > now + MAX_TRIAL_DAYS * DAY) throw new HttpError(400, 'Prøveperioden kan højst gå 3 år frem');
      await db
        .update(users)
        .set({
          trialEndsAt: end,
          // Ny slutdato frem i tiden: påmindelserne skal sendes igen op til den nye dato.
          ...(end.getTime() > now && { trialReminderSentAt: null, trialEndedSentAt: null }),
        })
        .where(eq(users.id, u.id));
      await logAdminEvent(db, u.id, adminId(req), 'trial_changed', { from: u.trialEndsAt?.toISOString() ?? null, to: end.toISOString() });
    }

    if (body.emailVerified && !u.emailVerifiedAt) {
      await db.update(users).set({ emailVerifiedAt: new Date() }).where(eq(users.id, u.id));
      await logAdminEvent(db, u.id, adminId(req), 'email_verified');
    }

    res.json(await customerDetail(db, (await findCustomer(db, u.id))!, adminId(req)));
  });

  /**
   * Skift e-mail: kunden får et link på den nye adresse, og e-mailen skiftes først,
   * når det klikkes (samme flow som kundens eget). En tastefejl låser derfor ikke kunden ude.
   */
  r.post('/:id/change-email', async (req, res) => {
    const { email: newEmail } = parse(z.object({ email }), req.body);
    const u = await customer(req);
    if (newEmail === u.email) throw new HttpError(400, 'Det er allerede kundens e-mail');
    const [taken] = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.email, newEmail), ne(users.id, u.id)))
      .limit(1);
    if (taken) throw new HttpError(409, 'E-mailen bruges allerede af en anden konto');
    const token = await createEmailToken(db, u.id, 'change_email', newEmail);
    const sent = await sendMail(changeEmailMail(newEmail, appLink(`/app/bekraeft-email?token=${encodeURIComponent(token)}`)));
    await logAdminEvent(db, u.id, adminId(req), 'email_change_sent', { from: u.email, to: newEmail, mailSent: sent });
    res.json(mailResult(sent, `Link sendt til ${newEmail}. E-mailen skiftes, når kunden klikker på det.`));
  });

  r.post('/:id/resend-verification', async (req, res) => {
    const u = await customer(req);
    if (u.emailVerifiedAt) throw new HttpError(400, 'E-mailen er allerede bekræftet');
    const token = await createEmailToken(db, u.id, 'verify_email', u.email!);
    const sent = await sendMail(verifyEmailMail(u.email!, appLink(`/app/bekraeft-email?token=${encodeURIComponent(token)}`)));
    await logAdminEvent(db, u.id, adminId(req), 'verification_sent', { mailSent: sent });
    res.json(mailResult(sent, `Bekræftelsesmail sendt til ${u.email}.`));
  });

  /** Kunden kan ikke logge ind: send et link til at vælge en ny adgangskode. Administratoren ser aldrig adgangskoden. */
  r.post('/:id/password-reset', async (req, res) => {
    const u = await customer(req);
    const token = await createEmailToken(db, u.id, 'reset_password', u.email!);
    const sent = await sendMail(resetPasswordMail(u.email!, appLink(`/app/nulstil-adgangskode?token=${encodeURIComponent(token)}`)));
    await logAdminEvent(db, u.id, adminId(req), 'password_reset_sent', { mailSent: sent });
    res.json(mailResult(sent, `Link til ny adgangskode sendt til ${u.email}.`));
  });

  /** Log ud på alle enheder. Et allerede udstedt access token virker højst til det udløber (ACCESS_TOKEN_TTL). */
  r.post('/:id/logout', async (req, res) => {
    const u = await customer(req);
    await revokeAllForUser(db, u.id);
    await logAdminEvent(db, u.id, adminId(req), 'logged_out');
    res.json(await customerDetail(db, u, adminId(req)));
  });

  /** Slet kontoen (fx efter en GDPR-henvendelse). Et løbende abonnement opsiges i Stripe først. */
  r.delete('/:id', async (req, res) => {
    const u = await customer(req);
    if (u.id === adminId(req)) throw new HttpError(400, 'Din egen konto sletter du under Konto på hjemmesiden');
    if (u.role === 'admin') throw new HttpError(400, 'Administratorer styres af ADMIN_EMAILS – fjern e-mailen derfra først');
    await cancelForAccountDeletion(stripe, u);
    await revokeAllForUser(db, u.id);
    await db.delete(users).where(eq(users.id, u.id));
    log.info('Kundekonto slettet af administrator', { kunde: u.id, admin: adminId(req) });
    res.status(204).end();
  });

  return r;
}
