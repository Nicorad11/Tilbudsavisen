import { PLAN, WITHDRAWAL_DAYS } from '@tilbudsradar/shared';
import { Link } from 'react-router';
import { useLaunch } from '../lib/access';
import { Faq, FAQ } from '../components/marketing/Faq';
import { PriceCard } from '../components/marketing/PriceCard';
import { VAT } from '../lib/company';

export function Pricing() {
  const launch = useLaunch();
  return (
    <div className="space-y-14 pt-6 lg:pt-12">
      <div className="max-w-[720px]">
        <p className="text-sm text-muted">Priser</p>
        <h1 className="mt-1 text-[40px] leading-[1.04] tracking-[-0.045em] text-ink sm:text-[56px]">Én pris. Alle funktioner.</h1>
        <p className="mt-4 text-[17px] leading-snug text-muted">
          {launch
            ? `Lige nu er alt gratis i lanceringsperioden. Når betaling åbner, får du ${PLAN.trialDays} dage gratis – derefter koster det ${PLAN.priceDkk} kr. om måneden${VAT}, hvis du vil fortsætte. Ingen binding, og der trækkes aldrig penge automatisk.`
            : `Prøv alt gratis i ${PLAN.trialDays} dage – uden kort. Vil du fortsætte, koster det ${PLAN.priceDkk} kr. om måneden${VAT}. Ingen binding.`}
        </p>
      </div>

      <PriceCard />

      <section className="grid gap-4 md:grid-cols-3">
        <Info title="Ingen binding">Opsig når som helst under Konto. Opsigelsen gælder fra udløbet af den måned, du har betalt for.</Info>
        <Info title={`${WITHDRAWAL_DAYS} dages fortrydelsesret`}>
          Fortryder du inden for {WITHDRAWAL_DAYS} dage, får du hele beløbet tilbage.{' '}
          <Link to="/fortryd" className="text-ink underline">
            Fortryd aftale
          </Link>
        </Info>
        <Info title="Sikker betaling">Betaling med kort, Apple Pay eller Google Pay via Stripe. Vi ser aldrig dine kortoplysninger.</Info>
      </section>

      <section>
        <h2 className="text-[28px] tracking-[-0.035em] text-ink">Spørgsmål om abonnementet</h2>
        <div className="mt-6">
          <Faq items={[...(launch ? [FAQ.launch!] : []), FAQ.price!, FAQ.card!, FAQ.after!, FAQ.cancel!, FAQ.withdraw!]} />
        </div>
        <p className="mt-6 text-[13px] text-muted">
          Læs de fulde{' '}
          <Link to="/handelsbetingelser" className="text-ink underline">
            handelsbetingelser
          </Link>
          .
        </p>
      </section>
    </div>
  );
}

function Info({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-[26px] bg-surface-2 p-6 shadow-soft">
      <p className="text-[17px] tracking-[-0.02em] text-ink">{title}</p>
      <p className="mt-2 text-[14px] leading-snug text-muted">{children}</p>
    </div>
  );
}
