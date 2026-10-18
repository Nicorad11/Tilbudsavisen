import { PLAN, WITHDRAWAL_DAYS } from '@tilbudsradar/shared';
import { Plus } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { VAT } from '../../lib/company';

export interface FaqItem {
  q: string;
  a: ReactNode;
}

export const FAQ: Record<string, FaqItem> = {
  launch: {
    q: 'Hvorfor er det gratis lige nu?',
    a: `Tilbudsradar er i lanceringsperiode, så alle funktioner er gratis for alle med en konto. Når betaling åbner, får du besked på e-mail og ${PLAN.trialDays} dage gratis, før det koster ${PLAN.priceDkk} kr. om måneden. Der trækkes aldrig penge automatisk.`,
  },
  price: {
    q: 'Hvad koster Tilbudsradar?',
    a: `${PLAN.priceDkk} kr. om måneden${VAT}. Du starter med ${PLAN.trialDays} dages gratis prøveperiode med alle funktioner. Søgning og ugens tilbud er altid gratis – også uden konto.`,
  },
  card: {
    q: 'Skal jeg give mit betalingskort for at prøve?',
    a: 'Nej. Prøveperioden kræver kun en e-mail og en adgangskode. Du giver først kortoplysninger, hvis du selv vælger at tegne et abonnement.',
  },
  after: {
    q: `Hvad sker der efter de ${PLAN.trialDays} dage?`,
    a: 'Ingenting automatisk. Prøveperioden bliver ikke til et betalt abonnement af sig selv – vi trækker ingen penge. Vi sender en mail 3 dage før, så du kan nå at beslutte dig. Dine lister og kvitteringer bliver gemt.',
  },
  cancel: {
    q: 'Hvordan opsiger jeg?',
    a: (
      <>
        Under{' '}
        <Link to="/app/konto#abonnement" className="text-ink underline">
          Konto
        </Link>{' '}
        → "Administrér eller opsig", eller via "Opsig abonnement" nederst på alle sider. Der er ingen binding, og opsigelsen gælder fra
        udløbet af den måned, du har betalt for.
      </>
    ),
  },
  withdraw: {
    q: 'Kan jeg fortryde?',
    a: (
      <>
        Ja, inden for {WITHDRAWAL_DAYS} dage efter du har tegnet abonnementet – og du får hele beløbet tilbage. Brug{' '}
        <Link to="/fortryd" className="text-ink underline">
          Fortryd aftale
        </Link>
        .
      </>
    ),
  },
  chains: {
    q: 'Hvilke kæder er med?',
    a: 'REMA 1000, Netto, føtex, Bilka og Lidl. Aviserne hentes automatisk to gange om dagen, også næste uges aviser, så snart de udkommer.',
  },
  real: {
    q: 'Hvordan ved I, om et tilbud er reelt?',
    a: 'Vi sammenligner tilbuddets pris pr. kilo, liter eller stk. med varens gennemsnit de seneste 90 dage. Er den mindst 10 % lavere, er det et reelt tilbud. Reklamerer kæden med en stor rabat, men er prisen næsten den samme som normalt, advarer vi om en mulig opskrevet førpris.',
  },
  data: {
    q: 'Hvad gør I med mine data?',
    a: (
      <>
        Vi gemmer kun det, der skal til for at levere tjenesten, og sælger aldrig data. Kvitteringsbilleder gemmes ikke. Du kan hente eller
        slette alle dine data under Konto. Læs{' '}
        <Link to="/privatlivspolitik" className="text-ink underline">
          privatlivspolitikken
        </Link>
        .
      </>
    ),
  },
  app: {
    q: 'Findes der en app?',
    a: 'Tilbudsradar virker i browseren på både mobil og computer. På mobilen kan du lægge den på hjemmeskærmen ("Føj til hjemmeskærm"), så den åbner som en app.',
  },
};

export function Faq({ items }: { items: FaqItem[] }) {
  return (
    <div className="divide-y divide-black/[0.07] rounded-[30px] bg-surface px-5 shadow-soft sm:px-7">
      {items.map((item) => (
        <details key={item.q} className="group py-4">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[16px] tracking-tight text-ink [&::-webkit-details-marker]:hidden">
            {item.q}
            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-raised shadow-pill transition group-open:rotate-45">
              <Plus className="size-4" />
            </span>
          </summary>
          <div className="pt-3 pr-10 text-[14.5px] leading-relaxed text-ink-2">{item.a}</div>
        </details>
      ))}
    </div>
  );
}
