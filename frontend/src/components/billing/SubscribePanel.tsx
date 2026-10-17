import { PAID_FEATURES, PLAN, WITHDRAWAL_DAYS } from '@tilbudsradar/shared';
import clsx from 'clsx';
import { Check, CreditCard, MailWarning } from 'lucide-react';
import { useId, useState } from 'react';
import { Link } from 'react-router';
import { formatLongDate, useAccess, useBillingStatus, useCheckout, useLaunch, usePortal, useResendVerification } from '../../lib/access';
import { Button } from '../ui/primitives';

const HOUR = 3_600_000;

/**
 * Alt brugeren skal se før købet (forbrugeraftaleloven § 8 og § 12): hvad
 * abonnementet indeholder, prisen pr. måned inkl. moms, at det fornyes
 * automatisk, ingen binding, hvordan man opsiger og fortrydelsesretten –
 * og en aktiv accept af handelsbetingelserne, før man sendes til Stripe.
 */
export function SubscribePanel({ className, compact }: { className?: string; compact?: boolean }) {
  const { access, isMember, user } = useAccess();
  const billing = useBillingStatus();
  const checkout = useCheckout();
  const portal = usePortal();
  const resend = useResendVerification();
  const [accepted, setAccepted] = useState(false);
  const checkboxId = useId();
  const launch = useLaunch();

  if (!isMember) {
    return (
      <div className={clsx('space-y-3', className)}>
        <Link to="/app/konto?opret=1" className="block">
          <Button tone="dark" size="lg" className="w-full">
            {launch ? 'Opret gratis konto' : `Prøv gratis i ${PLAN.trialDays} dage`}
          </Button>
        </Link>
        <p className="text-center text-[12.5px] text-muted">
          {launch ? 'Gratis i lanceringsperioden · Intet kort · Du får besked, før betaling åbner' : `Intet kort · Ingen binding · Derefter ${PLAN.priceDkk} kr/md, hvis du vælger at abonnere`}
        </p>
        <p className="text-center text-[13px] text-ink-2">
          Har du en konto?{' '}
          <Link to="/app/konto" className="underline underline-offset-2">
            Log ind
          </Link>
        </p>
      </div>
    );
  }

  if (access.subscribed) {
    return (
      <div className={clsx('space-y-3', className)}>
        <p className="flex items-center gap-2 text-[15px] text-ink">
          <span className="grid size-6 place-items-center rounded-full bg-lime">
            <Check className="size-3.5" />
          </span>
          {access.cancelAtPeriodEnd ? `Opsagt – du har adgang til ${formatLongDate(access.currentPeriodEnd)}` : 'Du abonnerer på Tilbudsradar'}
        </p>
        <Button className="w-full" loading={portal.isPending} onClick={() => portal.mutate()}>
          {access.cancelAtPeriodEnd ? 'Genoptag abonnementet' : 'Administrér eller opsig'}
        </Button>
      </div>
    );
  }

  if (launch) {
    return (
      <div className={clsx('space-y-2 rounded-[22px] bg-lime/35 p-4 text-[13.5px] leading-snug text-ink-2 ring-1 ring-lime-deep/40', className)}>
        <p className="flex items-center gap-2 font-medium text-ink">
          <span className="grid size-6 place-items-center rounded-full bg-lime">
            <Check className="size-3.5" />
          </span>
          Alle funktioner er gratis lige nu
        </p>
        <p>
          Tilbudsradar er i lanceringsperiode. Når betaling åbner, får du besked på e-mail og {PLAN.trialDays} dage gratis, før det koster{' '}
          {PLAN.priceDkk} kr/md. Der trækkes aldrig penge automatisk.
        </p>
      </div>
    );
  }

  const verified = user?.emailVerified ?? billing.data?.emailVerified ?? false;
  const enabled = billing.data?.billingEnabled ?? true;
  const trialEnd = access.trialEndsAt ? new Date(access.trialEndsAt) : null;
  const deferred = trialEnd && trialEnd.getTime() > Date.now() + 49 * HOUR;

  return (
    <div className={clsx('space-y-4', className)}>
      <dl className="space-y-2.5 rounded-[22px] bg-lime/35 p-4 text-[13.5px] leading-snug text-ink-2 ring-1 ring-lime-deep/40">
        {!compact && (
          <div>
            <dt className="font-medium text-ink">Du får</dt>
            <dd>{Object.values(PAID_FEATURES).map((f) => f.title).join(', ')}.</dd>
          </div>
        )}
        <div>
          <dt className="font-medium text-ink">Pris</dt>
          <dd>
            {PLAN.priceDkk} kr. pr. måned inkl. moms. Betales forud og fornyes automatisk hver måned, indtil du opsiger.
          </dd>
        </div>
        <div>
          <dt className="font-medium text-ink">Første betaling</dt>
          <dd>{deferred ? `${formatLongDate(access.trialEndsAt)}, når din gratis prøveperiode slutter.` : 'I dag.'}</dd>
        </div>
        <div>
          <dt className="font-medium text-ink">Binding og opsigelse</dt>
          <dd>Ingen binding. Opsig når som helst under Konto – opsigelsen gælder fra udløbet af den betalte måned.</dd>
        </div>
        <div>
          <dt className="font-medium text-ink">Fortrydelsesret</dt>
          <dd>{WITHDRAWAL_DAYS} dage fra købet. Fortryder du, får du hele beløbet tilbage.</dd>
        </div>
      </dl>

      {!verified && (
        <div className="flex items-start gap-3 rounded-2xl bg-[#fbe6cf] px-4 py-3 text-[13px] leading-snug text-[#6b3a08]">
          <MailWarning className="mt-0.5 size-4 shrink-0" />
          <div>
            Bekræft din e-mail, før du tegner et abonnement. Vi har sendt et link til {user?.email}.{' '}
            <button type="button" className="underline underline-offset-2" onClick={() => resend.mutate()} disabled={resend.isPending}>
              Send igen
            </button>
          </div>
        </div>
      )}

      <label htmlFor={checkboxId} className="flex cursor-pointer items-start gap-3 text-[13.5px] leading-snug text-ink-2">
        <input
          id={checkboxId}
          type="checkbox"
          className="mt-0.5 size-[18px] shrink-0 accent-[#1a1a1a]"
          checked={accepted}
          onChange={(e) => setAccepted(e.target.checked)}
        />
        <span>
          Jeg accepterer{' '}
          <Link to="/handelsbetingelser" target="_blank" className="text-ink underline underline-offset-2">
            handelsbetingelserne
          </Link>{' '}
          og har læst{' '}
          <Link to="/privatlivspolitik" target="_blank" className="text-ink underline underline-offset-2">
            privatlivspolitikken
          </Link>
          .
        </span>
      </label>

      <Button
        tone="dark"
        size="lg"
        className="w-full"
        icon={<CreditCard className="size-4" />}
        disabled={!accepted || !verified || !enabled}
        loading={checkout.isPending}
        onClick={() => checkout.mutate()}
      >
        Start abonnement – {PLAN.priceDkk} kr/md
      </Button>
      <p className="text-center text-[12px] leading-snug text-muted">
        {enabled
          ? 'Du sendes videre til Stripe og betaler sikkert med kort, Apple Pay eller Google Pay.'
          : 'Betaling åbner snart – prøv igen lidt senere.'}
      </p>
    </div>
  );
}
