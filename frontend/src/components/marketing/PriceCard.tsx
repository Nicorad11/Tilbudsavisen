import { PAID_FEATURES, PLAN, WITHDRAWAL_DAYS } from '@tilbudsradar/shared';
import { Check } from 'lucide-react';
import { SubscribePanel } from '../billing/SubscribePanel';

const FREE = ['Søg i alle tilbudsaviser', 'Pris pr. kg, liter og stk. på tværs af kæderne', 'Vurdering af om tilbuddet er reelt', 'Ugens bedste tilbud'];

/** Priskortet på landingssiden og /priser – med betalingsformularen indbygget. */
export function PriceCard() {
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
      <div className="grad-card grad-lime flex flex-col justify-between p-6 sm:p-8">
        <div>
          <p className="text-sm text-ink/70">Tilbudsradar</p>
          <p className="mt-3 flex items-baseline gap-2">
            <span className="text-[64px] leading-none tracking-[-0.05em]">{PLAN.priceDkk} kr</span>
            <span className="text-[15px] text-ink/70">pr. måned inkl. moms</span>
          </p>
          <p className="mt-3 max-w-[40ch] text-[15px] leading-snug text-ink/80">
            {PLAN.trialDays} dage gratis med alle funktioner. Intet kort, ingen binding – og prøveperioden bliver ikke automatisk til et abonnement.
          </p>
        </div>
        <div className="mt-8 grid gap-6 sm:grid-cols-2">
          <div>
            <p className="text-[13px] font-medium text-ink">Med abonnement</p>
            <ul className="mt-2 space-y-1.5 text-[14px] text-ink/85">
              {Object.values(PAID_FEATURES).map((f) => (
                <li key={f.title} className="flex gap-2">
                  <Check className="mt-0.5 size-4 shrink-0" strokeWidth={2.2} />
                  {f.title}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-[13px] font-medium text-ink">Altid gratis</p>
            <ul className="mt-2 space-y-1.5 text-[14px] text-ink/85">
              {FREE.map((f) => (
                <li key={f} className="flex gap-2">
                  <Check className="mt-0.5 size-4 shrink-0 opacity-60" strokeWidth={2.2} />
                  {f}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
      <div className="card p-5 sm:p-6">
        <p className="text-lg tracking-tight text-ink">Kom i gang</p>
        <p className="mb-5 text-[13px] text-muted">Opsig når som helst · {WITHDRAWAL_DAYS} dages fortrydelsesret</p>
        <SubscribePanel />
      </div>
    </div>
  );
}
