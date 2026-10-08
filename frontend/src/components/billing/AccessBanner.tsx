import { PLAN } from '@tilbudsradar/shared';
import clsx from 'clsx';
import { AlertTriangle, Clock, MailWarning } from 'lucide-react';
import { Link } from 'react-router';
import { formatLongDate, useAccess, usePortal, useResendVerification } from '../../lib/access';

/**
 * Diskret linje øverst i appen: bekræft e-mail, nedtælling i prøveperioden,
 * fejlet betaling eller opsagt abonnement. Viser højst én besked ad gangen.
 */
export function AccessBanner() {
  const { access, isMember, user } = useAccess();
  const resend = useResendVerification();
  const portal = usePortal();
  if (!isMember || !user) return null;

  if (access.status === 'past_due') {
    return (
      <Banner tone="warn" icon={<AlertTriangle className="size-4" />}>
        Betalingen fejlede. Opdatér dit kort inden {formatLongDate(access.graceEndsAt)} for at beholde adgangen.{' '}
        <button type="button" className="font-medium underline underline-offset-2" onClick={() => portal.mutate()}>
          Opdatér kort
        </button>
      </Banner>
    );
  }
  if (!user.emailVerified) {
    return (
      <Banner tone="quiet" icon={<MailWarning className="size-4" />}>
        Bekræft din e-mail – vi har sendt et link til {user.email}.{' '}
        <button type="button" className="font-medium underline underline-offset-2" disabled={resend.isPending} onClick={() => resend.mutate()}>
          Send igen
        </button>
      </Banner>
    );
  }
  if (access.status === 'trial' && !access.subscribed && access.trialDaysLeft != null) {
    const days = access.trialDaysLeft;
    return (
      <Banner tone={days <= 3 ? 'lime' : 'quiet'} icon={<Clock className="size-4" />}>
        {days <= 1 ? 'Din prøveperiode slutter i dag.' : `Din prøveperiode slutter om ${days} dage.`} Der trækkes ingen penge automatisk.{' '}
        <Link to="/priser" className="font-medium underline underline-offset-2">
          Abonnér for {PLAN.priceDkk} kr/md
        </Link>
      </Banner>
    );
  }
  if (access.status === 'canceled') {
    return (
      <Banner tone="quiet" icon={<Clock className="size-4" />}>
        Dit abonnement er opsagt og udløber {formatLongDate(access.currentPeriodEnd)}.{' '}
        <button type="button" className="font-medium underline underline-offset-2" onClick={() => portal.mutate()}>
          Genoptag
        </button>
      </Banner>
    );
  }
  if (access.status === 'expired') {
    return (
      <Banner tone="lime" icon={<Clock className="size-4" />}>
        {access.trialUsed ? 'Din prøveperiode er slut' : 'Du har ikke et aktivt abonnement'} – dine data er gemt.{' '}
        <Link to="/priser" className="font-medium underline underline-offset-2">
          Abonnér for {PLAN.priceDkk} kr/md
        </Link>
      </Banner>
    );
  }
  return null;
}

function Banner({ tone, icon, children }: { tone: 'quiet' | 'lime' | 'warn'; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div
      role="status"
      className={clsx(
        'mb-4 flex items-start gap-2.5 rounded-2xl px-4 py-2.5 text-[13px] leading-snug',
        tone === 'quiet' && 'bg-black/[0.045] text-ink-2',
        tone === 'lime' && 'bg-lime/60 text-ink',
        tone === 'warn' && 'bg-[#fbe6cf] text-[#6b3a08]',
      )}
    >
      <span className="mt-px shrink-0">{icon}</span>
      <span>{children}</span>
    </div>
  );
}
