import { PAID_FEATURES, PLAN, type PaidFeature } from '@tilbudsradar/shared';
import clsx from 'clsx';
import { Check, LockKeyhole, X } from 'lucide-react';
import { useEffect } from 'react';
import { useLocation } from 'react-router';
import { useAccess, useLaunch } from '../../lib/access';
import { useUi } from '../../lib/store';
import { IconButton } from '../ui/primitives';
import { SubscribePanel } from './SubscribePanel';

/**
 * Betalingsmuren: forklarer hvad funktionen giver, og hvad man får med en
 * prøveperiode eller et abonnement. Gæster og besøgende inviteres til en
 * gratis konto; udløbne konti får abonnementsformularen direkte.
 */
export function Paywall({ feature, className }: { feature: PaidFeature | 'any'; className?: string }) {
  const { access, isMember, isGuest } = useAccess();
  const main = feature === 'any' ? null : PAID_FEATURES[feature];
  const expired = isMember && !access.hasAccess;
  const launch = useLaunch();

  return (
    <div className={clsx('card overflow-hidden', className)}>
      <div className="grid gap-6 p-5 sm:p-7 lg:grid-cols-[minmax(0,1fr)_minmax(0,380px)]">
        <div>
          <span className="grid size-11 place-items-center rounded-full bg-lime">
            <LockKeyhole className="size-5" strokeWidth={1.7} />
          </span>
          <h2 className="mt-4 text-[26px] leading-tight tracking-[-0.03em] text-ink">
            {expired
              ? access.trialUsed
                ? 'Din prøveperiode er slut'
                : 'Denne funktion kræver et abonnement'
              : main
                ? main.title
                : launch
                  ? 'Alle funktioner er gratis lige nu'
                  : `Prøv alle funktioner gratis i ${PLAN.trialDays} dage`}
          </h2>
          <p className="mt-2 max-w-[52ch] text-[15px] leading-snug text-muted">
            {expired
              ? `Dine lister, kvitteringer og alarmer er gemt, og du kan stadig se dem. Abonnér for ${PLAN.priceDkk} kr/md for at bruge funktionerne igen.`
              : main
                ? launch
                  ? `${main.description} Opret en gratis konto – alt er gratis i lanceringsperioden.`
                  : `${main.description} Opret en gratis konto og prøv det i ${PLAN.trialDays} dage – uden betalingskort.`
                : launch
                  ? 'Opret en gratis konto – alt er gratis i lanceringsperioden, og der kræves intet betalingskort.'
                  : `Opret en gratis konto – ingen betalingskort, og prøveperioden bliver ikke automatisk til et abonnement.`}
          </p>
          {isGuest && !expired && (
            <p className="mt-3 rounded-2xl bg-lime/45 px-3 py-2 text-[13px] text-ink">Dine lister og alarmer fra gæstesessionen følger med over på kontoen.</p>
          )}
          <ul className="mt-5 space-y-2 text-[14px] text-ink-2">
            {Object.entries(PAID_FEATURES).map(([id, f]) => (
              <li key={id} className="flex items-start gap-2.5">
                <span className={clsx('mt-0.5 grid size-5 shrink-0 place-items-center rounded-full', id === feature ? 'bg-ink text-lime' : 'bg-lime')}>
                  <Check className="size-3" strokeWidth={2.4} />
                </span>
                <span className={id === feature ? 'text-ink' : undefined}>{f.title}</span>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-[12.5px] text-faint">Søgning, ugens tilbud og vurderingen af om et tilbud er reelt er altid gratis.</p>
        </div>
        <div className="rounded-[26px] bg-raised p-5 shadow-pill">
          {launch && !expired ? (
            <>
              <p className="text-[40px] leading-none tracking-[-0.045em] text-ink">Gratis</p>
              <p className="mt-1 text-[13px] text-muted">I lanceringsperioden · Intet kort</p>
            </>
          ) : (
            <>
              <p className="flex items-baseline gap-1.5 text-ink">
                <span className="text-[40px] leading-none tracking-[-0.045em]">{PLAN.priceDkk} kr</span>
                <span className="text-sm text-muted">/ md inkl. moms</span>
              </p>
              <p className="mt-1 text-[13px] text-muted">
                {expired ? 'Ingen binding · Opsig når som helst' : `${PLAN.trialDays} dage gratis først · Intet kort`}
              </p>
            </>
          )}
          <SubscribePanel className="mt-5" compact />
        </div>
      </div>
    </div>
  );
}

/** Betalingsmuren som dialog – åbnes fra knapper og ved 402-svar fra API'et. */
export function PaywallDialog() {
  const feature = useUi((s) => s.paywall);
  const close = useUi((s) => s.closePaywall);
  const location = useLocation();

  // Et klik på "Prøv gratis" / "Log ind" navigerer væk – så lukker dialogen.
  useEffect(() => close(), [location.pathname, close]);

  useEffect(() => {
    if (!feature) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [feature, close]);

  if (!feature) return null;
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label="Kræver abonnement">
      <button type="button" aria-label="Luk" className="absolute inset-0 bg-[#1a1a1a]/30 backdrop-blur-[2px]" onClick={close} />
      <div className="relative max-h-[92dvh] w-full max-w-[880px] animate-rise overflow-y-auto rounded-t-[30px] bg-canvas sm:m-4 sm:rounded-[34px]">
        <IconButton label="Luk" className="absolute top-4 right-4 z-10" onClick={close}>
          <X className="size-4" />
        </IconButton>
        <Paywall feature={feature} className="rounded-none shadow-none sm:rounded-[34px]" />
      </div>
    </div>
  );
}
