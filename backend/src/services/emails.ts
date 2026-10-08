import { PLAN, termsAsText, WITHDRAWAL_DAYS, type CompanyInfo } from '@tilbudsradar/shared';
import { env } from '../env';
import type { Mail } from './mailer';

/**
 * Transaktionsmails på dansk i appens design: varm grå baggrund, hvidt kort,
 * sort knap med limegrøn prik. Alle mails har både HTML og ren tekst.
 */

export function company(): CompanyInfo {
  return { name: env.COMPANY_NAME, cvr: env.COMPANY_CVR, address: env.COMPANY_ADDRESS, email: env.CONTACT_EMAIL, appUrl: env.APP_URL };
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const dateFmt = new Intl.DateTimeFormat('da-DK', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Copenhagen' });
const dateTimeFmt = new Intl.DateTimeFormat('da-DK', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Europe/Copenhagen',
});
export const formatDate = (d: Date) => dateFmt.format(d);
export const formatDateTime = (d: Date) => dateTimeFmt.format(d);

export const appLink = (p: string) => `${env.APP_URL}${p}`;

/** Et afsnit: ren tekst, eller { strong } for fremhævet tekst. */
type Part = string | { strong: string };
type Paragraph = Part[] | string;

interface Layout {
  subject: string;
  preheader: string;
  title: string;
  paragraphs: Paragraph[];
  button?: { label: string; url: string };
  after?: Paragraph[];
  /** Forklaring nederst – fx hvorfor man får mailen. */
  note?: string;
}

const partsOf = (p: Paragraph): Part[] => (typeof p === 'string' ? [p] : p);
const htmlParagraph = (p: Paragraph) =>
  `<p style="margin:0 0 14px;font-size:15px;line-height:1.55;color:#4f4f4f">${partsOf(p)
    .map((x) => (typeof x === 'string' ? esc(x) : `<strong style="color:#1a1a1a;font-weight:600">${esc(x.strong)}</strong>`))
    .join('')}</p>`;
const textParagraph = (p: Paragraph) => partsOf(p).map((x) => (typeof x === 'string' ? x : x.strong)).join('');

function render(l: Layout): Pick<Mail, 'subject' | 'html' | 'text'> {
  const c = company();
  const footer = `${c.name} · CVR ${c.cvr} · ${c.address} · ${c.email}`;
  const html = `<!doctype html>
<html lang="da"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(l.subject)}</title></head>
<body style="margin:0;padding:0;background:#e7e7e5;font-family:'Inter Tight','Helvetica Neue',Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(l.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#e7e7e5"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">
<tr><td style="padding:0 8px 18px">
  <table role="presentation" cellpadding="0" cellspacing="0"><tr>
    <td style="width:26px;height:26px;background:#1a1a1a;border-radius:9px;text-align:center;vertical-align:middle"><span style="display:inline-block;width:8px;height:8px;border-radius:8px;background:#e2f33b"></span></td>
    <td style="padding-left:9px;font-size:18px;font-weight:600;letter-spacing:-0.4px;color:#1a1a1a">tilbudsradar</td>
  </tr></table>
</td></tr>
<tr><td style="background:#fbfbfa;border-radius:28px;padding:32px 28px">
  <h1 style="margin:0 0 16px;font-size:26px;line-height:1.15;letter-spacing:-0.8px;font-weight:500;color:#1a1a1a">${esc(l.title)}</h1>
  ${l.paragraphs.map(htmlParagraph).join('\n  ')}
  ${
    l.button
      ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0 18px"><tr><td style="background:#1a1a1a;border-radius:999px">
    <a href="${esc(l.button.url)}" style="display:inline-block;padding:13px 24px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none">${esc(l.button.label)}</a>
  </td></tr></table>
  <p style="margin:0 0 14px;font-size:12px;line-height:1.5;color:#969694">Virker knappen ikke, så kopiér linket: <br><a href="${esc(l.button.url)}" style="color:#4f4f4f;word-break:break-all">${esc(l.button.url)}</a></p>`
      : ''
  }
  ${(l.after ?? []).map(htmlParagraph).join('\n  ')}
</td></tr>
<tr><td style="padding:18px 12px 0;font-size:12px;line-height:1.5;color:#969694">
  ${l.note ? `${esc(l.note)}<br><br>` : ''}${esc(footer)}<br>
  <a href="${esc(appLink('/privatlivspolitik'))}" style="color:#969694">Privatlivspolitik</a> · <a href="${esc(appLink('/handelsbetingelser'))}" style="color:#969694">Handelsbetingelser</a>
</td></tr>
</table></td></tr></table></body></html>`;

  const text = [
    l.title,
    '',
    ...l.paragraphs.map(textParagraph).flatMap((p) => [p, '']),
    ...(l.button ? [`${l.button.label}: ${l.button.url}`, ''] : []),
    ...(l.after ?? []).map(textParagraph).flatMap((p) => [p, '']),
    '--',
    ...(l.note ? [l.note, ''] : []),
    footer,
    `Privatlivspolitik: ${appLink('/privatlivspolitik')}`,
  ].join('\n');

  return { subject: l.subject, html, text };
}

const price = `${PLAN.priceDkk} kr/md`;

/* ------------------------------------------------------------------ */
/* Konto                                                              */
/* ------------------------------------------------------------------ */

export function verifyEmailMail(to: string, link: string): Mail {
  return {
    to,
    ...render({
      subject: 'Bekræft din e-mail til Tilbudsradar',
      preheader: 'Ét klik, så er din konto klar.',
      title: 'Bekræft din e-mail',
      paragraphs: [
        `Tak fordi du oprettede en konto. Din gratis prøveperiode på ${PLAN.trialDays} dage er allerede startet.`,
        'Bekræft din e-mail, så vi ved at den er din. Det er et krav, før du kan tegne et abonnement.',
      ],
      button: { label: 'Bekræft e-mail', url: link },
      after: ['Linket virker i 48 timer.'],
      note: 'Har du ikke oprettet en konto, kan du se bort fra denne mail.',
    }),
  };
}

export function changeEmailMail(to: string, link: string): Mail {
  return {
    to,
    ...render({
      subject: 'Bekræft din nye e-mail til Tilbudsradar',
      preheader: 'Bekræft adressen for at skifte e-mail på din konto.',
      title: 'Bekræft din nye e-mail',
      paragraphs: ['Du har bedt om at skifte e-mail på din Tilbudsradar-konto til denne adresse. Skiftet sker, når du bekræfter.'],
      button: { label: 'Bekræft ny e-mail', url: link },
      after: ['Linket virker i 48 timer.'],
      note: 'Har du ikke bedt om det, kan du se bort fra denne mail – intet bliver ændret.',
    }),
  };
}

export function emailChangedMail(to: string): Mail {
  return {
    to,
    ...render({
      subject: 'Din e-mail på Tilbudsradar er ændret',
      preheader: 'Kontoen bruger nu en anden e-mailadresse.',
      title: 'Din e-mail er ændret',
      paragraphs: [
        'E-mailadressen på din Tilbudsradar-konto er netop blevet ændret, og denne adresse bruges ikke længere.',
        `Var det ikke dig, så skriv straks til ${env.CONTACT_EMAIL}.`,
      ],
    }),
  };
}

export function resetPasswordMail(to: string, link: string): Mail {
  return {
    to,
    ...render({
      subject: 'Nulstil din adgangskode til Tilbudsradar',
      preheader: 'Linket virker i 1 time og kan kun bruges én gang.',
      title: 'Nulstil adgangskode',
      paragraphs: ['Vi har fået en anmodning om at nulstille adgangskoden til din konto. Vælg en ny adgangskode med knappen herunder.'],
      button: { label: 'Vælg ny adgangskode', url: link },
      after: ['Linket virker i 1 time og kan kun bruges én gang. Når du vælger en ny adgangskode, bliver du logget ud på alle andre enheder.'],
      note: 'Har du ikke bedt om at nulstille adgangskoden, kan du se bort fra denne mail.',
    }),
  };
}

export function passwordChangedMail(to: string): Mail {
  return {
    to,
    ...render({
      subject: 'Din adgangskode til Tilbudsradar er ændret',
      preheader: 'Du er logget ud på dine andre enheder.',
      title: 'Adgangskoden er ændret',
      paragraphs: [
        'Adgangskoden til din konto er netop blevet ændret, og du er logget ud på dine andre enheder.',
        `Var det ikke dig, så nulstil adgangskoden med det samme på ${appLink('/app/konto')} og skriv til ${env.CONTACT_EMAIL}.`,
      ],
    }),
  };
}

/* ------------------------------------------------------------------ */
/* Prøveperiode og abonnement                                         */
/* ------------------------------------------------------------------ */

export function trialEndingSoonMail(to: string, trialEndsAt: Date): Mail {
  return {
    to,
    ...render({
      subject: 'Din prøveperiode på Tilbudsradar slutter om 3 dage',
      preheader: `Prøveperioden slutter ${formatDate(trialEndsAt)}. Der trækkes ingen penge automatisk.`,
      title: 'Din prøveperiode slutter snart',
      paragraphs: [
        ['Din gratis prøveperiode slutter ', { strong: formatDate(trialEndsAt) }, '.'],
        `Vil du beholde indkøbslister, prisalarmer, kvitteringsscanneren og prishistorikken, kan du tegne et abonnement til ${price} inkl. moms. Ingen binding – du kan opsige når som helst.`,
        'Gør du ingenting, sker der intet: vi trækker ingen penge, og dine data bliver liggende, så du kan se dem igen, hvis du abonnerer senere.',
      ],
      button: { label: `Se abonnementet – ${price}`, url: appLink('/priser') },
      note: 'Du får denne mail, fordi du har en prøveperiode på Tilbudsradar.',
    }),
  };
}

export function trialEndedMail(to: string): Mail {
  return {
    to,
    ...render({
      subject: 'Din prøveperiode på Tilbudsradar er slut',
      preheader: 'Dine data er gemt – abonnér for at fortsætte.',
      title: 'Prøveperioden er slut',
      paragraphs: [
        'Tak fordi du prøvede Tilbudsradar. Din gratis prøveperiode er nu slut, og der er ikke trukket nogen penge.',
        'Dine lister, kvitteringer og alarmer er ikke slettet. Du kan stadig se dem, men ikke ændre dem, før du abonnerer. Søgning og ugens tilbud er fortsat gratis.',
      ],
      button: { label: `Start abonnement – ${price}`, url: appLink('/priser') },
      note: 'Du får denne mail, fordi din prøveperiode på Tilbudsradar er slut. Det er den sidste mail om prøveperioden.',
    }),
  };
}

export function subscriptionStartedMail(
  to: string,
  opts: { startedAt: Date; firstChargeAt: Date | null; currentPeriodEnd: Date | null },
): Mail {
  const c = company();
  const firstCharge =
    opts.firstChargeAt && opts.firstChargeAt.getTime() > Date.now() + 60_000
      ? `Første betaling på ${PLAN.priceDkk} kr. trækkes ${formatDate(opts.firstChargeAt)}, når din gratis prøveperiode slutter.`
      : `Første betaling på ${PLAN.priceDkk} kr. er trukket.`;
  return {
    to,
    attachments: [{ filename: 'handelsbetingelser-tilbudsradar.txt', content: termsAsText(c), contentType: 'text/plain; charset=utf-8' }],
    ...render({
      subject: 'Ordrebekræftelse: dit abonnement på Tilbudsradar',
      preheader: `${price} inkl. moms, ingen binding.`,
      title: 'Tak for dit abonnement',
      paragraphs: [
        ['Ydelse: ', { strong: 'Tilbudsradar-abonnement' }, ' – indkøbslister med butiks-splitting, prisalarmer, kvitteringsscanner, prishistorik og community-vurderinger.'],
        ['Pris: ', { strong: `${PLAN.priceDkk} kr. pr. måned inkl. moms` }, '. Betales forud for én måned ad gangen og fornyes automatisk, indtil du opsiger.'],
        firstCharge,
        ['Binding: ', { strong: 'ingen' }, '. Du kan opsige når som helst under Konto → "Administrér eller opsig". Opsigelsen gælder fra udløbet af den betalte måned.'],
        ['Aftalen er indgået: ', { strong: formatDateTime(opts.startedAt) }, '.'],
      ],
      button: { label: 'Gå til din konto', url: appLink('/app/konto') },
      after: [
        [
          { strong: `Fortrydelsesret: ` },
          `Du kan fortryde aftalen inden for ${WITHDRAWAL_DAYS} dage fra i dag uden at give en grund. Brug knappen "Fortryd aftale" på ${appLink('/fortryd')} eller under Konto, eller skriv til ${c.email}. Fortryder du, stopper abonnementet med det samme, og vi refunderer det fulde beløb, du har betalt.`,
        ],
        'Handelsbetingelserne inkl. standardfortrydelsesformularen er vedhæftet denne mail. Gem den gerne.',
      ],
      note: 'Du får denne mail som bekræftelse på dit køb.',
    }),
  };
}

export function paymentFailedMail(to: string, graceEndsAt: Date | null): Mail {
  return {
    to,
    ...render({
      subject: 'Betalingen til Tilbudsradar fejlede',
      preheader: 'Opdatér dit kort for at beholde adgangen.',
      title: 'Betalingen fejlede',
      paragraphs: [
        'Vi kunne ikke trække betalingen for dit Tilbudsradar-abonnement. Det skyldes typisk et udløbet kort eller manglende dækning.',
        graceEndsAt
          ? ['Vi prøver igen automatisk. Du beholder adgangen til ', { strong: formatDate(graceEndsAt) }, '. Opdatér dit kort for at undgå afbrydelse.']
          : 'Vi prøver igen automatisk. Opdatér dit kort for at undgå afbrydelse.',
      ],
      button: { label: 'Opdatér betalingskort', url: appLink('/app/konto#abonnement') },
      note: 'Du får denne mail, fordi du har et abonnement på Tilbudsradar.',
    }),
  };
}

export function subscriptionCanceledMail(to: string, endsAt: Date | null): Mail {
  return {
    to,
    ...render({
      subject: 'Dit abonnement på Tilbudsradar er opsagt',
      preheader: endsAt ? `Du har adgang til ${formatDate(endsAt)}.` : 'Abonnementet er stoppet.',
      title: 'Abonnementet er opsagt',
      paragraphs: [
        endsAt && endsAt.getTime() > Date.now()
          ? ['Dit abonnement er opsagt. Du har adgang til alle funktioner til og med ', { strong: formatDate(endsAt) }, ', og der trækkes ikke flere betalinger.']
          : 'Dit abonnement er stoppet, og der trækkes ikke flere betalinger.',
        'Dine data bliver liggende. Fortryder du, kan du genoptage abonnementet under Konto.',
      ],
      button: { label: 'Gå til din konto', url: appLink('/app/konto#abonnement') },
      note: 'Du får denne mail som bekræftelse på din opsigelse.',
    }),
  };
}

export function withdrawalReceiptMail(
  to: string,
  opts: { name: string; submittedAt: Date; accountEmail: string | null; refundDkk: number; matched: boolean },
): Mail {
  return {
    to,
    ...render({
      subject: 'Kvittering for din fortrydelse – Tilbudsradar',
      preheader: 'Vi har modtaget din fortrydelse.',
      title: 'Vi har modtaget din fortrydelse',
      paragraphs: [
        ['Indsendt: ', { strong: formatDateTime(opts.submittedAt) }],
        ['Navn: ', { strong: opts.name }],
        ['Aftale: ', { strong: `Tilbudsradar-abonnement${opts.accountEmail ? ` på kontoen ${opts.accountEmail}` : ''}` }],
        'Indhold: Jeg ønsker at gøre min fortrydelsesret gældende og fortryde aftalen om abonnementet.',
      ],
      after: [
        opts.matched
          ? opts.refundDkk > 0
            ? `Abonnementet er stoppet, og vi refunderer ${opts.refundDkk.toFixed(2).replace('.', ',')} kr. til det betalingsmiddel, du betalte med. Pengene er normalt på kontoen inden for 5-10 bankdage.`
            : 'Abonnementet er stoppet. Der var ikke trukket nogen betaling, så der trækkes intet.'
          : `Vi kunne ikke automatisk finde et abonnement, der kan fortrydes, på de oplysninger du gav. Vi behandler din fortrydelse manuelt og vender tilbage. Du kan også skrive til ${env.CONTACT_EMAIL}.`,
      ],
      note: 'Denne mail er din kvittering efter forbrugeraftalelovens § 20 a. Gem den gerne.',
    }),
  };
}

/* ------------------------------------------------------------------ */
/* Prisalarm                                                          */
/* ------------------------------------------------------------------ */

export function priceAlertMail(
  to: string,
  opts: { query: string; message: string; validTo: Date; sourceUrl: string; price: string },
): Mail {
  return {
    to,
    ...render({
      subject: `Prisalarm: ${opts.query} til ${opts.price} kr`,
      preheader: opts.message,
      title: 'Din vare er på tilbud',
      paragraphs: [opts.message, ['Gyldig til ', { strong: formatDate(opts.validTo) }, '.']],
      button: { label: 'Se tilbuddet', url: opts.sourceUrl },
      note: `Du får denne mail, fordi du følger "${opts.query}" i Tilbudsradar. Slet alarmen under Alarmer for at stoppe mails om varen.`,
    }),
  };
}
