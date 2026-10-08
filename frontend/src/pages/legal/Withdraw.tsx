import type { WithdrawalResponse } from '@tilbudsradar/shared';
import { WITHDRAWAL_DAYS } from '@tilbudsradar/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Button, Card, TextInput } from '../../components/ui/primitives';
import { formatLongDate, useAccess } from '../../lib/access';
import { api, ApiError } from '../../lib/api';
import { COMPANY } from '../../lib/company';
import { LegalPage, Section } from './LegalPage';

const dateTime = new Intl.DateTimeFormat('da-DK', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });

/**
 * "Fortryd aftale" (forbrugeraftaleloven § 20 a): forbrugeren angiver navn,
 * hvilken aftale og hvilken e-mail kvitteringen skal sendes til, og
 * bekræfter med en knap, der kun hedder "Bekræft fortrydelse".
 */
export function Withdraw() {
  const { user, isMember, access } = useAccess();
  const qc = useQueryClient();
  const [step, setStep] = useState<'form' | 'confirm' | 'done'>('form');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  useEffect(() => {
    if (user?.email) setEmail((e) => e || user.email!);
  }, [user?.email]);

  const submit = useMutation({
    mutationFn: () => api<WithdrawalResponse>('/billing/withdraw', { method: 'POST', body: { name, email } }),
    onSuccess: () => {
      setStep('done');
      void qc.invalidateQueries({ queryKey: ['me'] });
      void qc.invalidateQueries({ queryKey: ['billing'] });
    },
  });

  const contract = isMember ? `Tilbudsradar-abonnement på kontoen ${user?.email}` : 'Tilbudsradar-abonnement på kontoen med den angivne e-mail';

  return (
    <LegalPage kicker={`Fortrydelsesret i ${WITHDRAWAL_DAYS} dage`} title="Fortryd aftale">
      <Section title="Sådan fungerer det">
        <p>
          Du kan fortryde dit abonnement inden for {WITHDRAWAL_DAYS} dage fra den dag, du tegnede det, uden at give en grund. Abonnementet
          stopper med det samme, og vi refunderer hele det beløb, du har betalt. Er første betaling endnu ikke trukket, trækkes der intet.
        </p>
        {isMember && access.withdrawableUntil && (
          <p className="rounded-2xl bg-lime/45 px-4 py-3 text-ink">Du kan fortryde dit abonnement til og med {formatLongDate(access.withdrawableUntil)}.</p>
        )}
        {isMember && access.subscribed && !access.withdrawableUntil && (
          <p className="rounded-2xl bg-black/[0.045] px-4 py-3">
            Fortrydelsesfristen for dit abonnement er udløbet. Du kan stadig{' '}
            <Link to="/app/konto#abonnement" className="text-ink underline">
              opsige abonnementet
            </Link>{' '}
            til udløbet af den betalte måned.
          </p>
        )}
      </Section>

      <Card className="p-5 sm:p-7">
        {step === 'done' && submit.data ? (
          <div className="space-y-3">
            <span className="grid size-12 place-items-center rounded-full bg-lime">
              <CheckCircle2 className="size-6" />
            </span>
            <h2 className="text-[24px] tracking-[-0.03em] text-ink">Vi har modtaget din fortrydelse</h2>
            <p>Indsendt {dateTime.format(new Date(submit.data.submittedAt))}.</p>
            <p>
              {submit.data.refundDkk > 0
                ? `Vi refunderer ${submit.data.refundDkk.toFixed(2).replace('.', ',')} kr. til det betalingsmiddel, du betalte med.`
                : 'Vi behandler din fortrydelse og vender tilbage, hvis vi mangler noget.'}{' '}
              Vi har sendt en kvittering til {email}.
            </p>
          </div>
        ) : (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (step === 'form') setStep('confirm');
              else submit.mutate();
            }}
          >
            <label className="block">
              <span className="text-sm text-ink-2">Dit navn</span>
              <TextInput className="mt-1.5" autoComplete="name" required minLength={2} maxLength={120} value={name} disabled={step === 'confirm'} onChange={(e) => setName(e.target.value)} />
            </label>
            <div>
              <span className="text-sm text-ink-2">Aftalen du fortryder</span>
              <p className="mt-1.5 rounded-2xl bg-raised px-4 py-3 text-ink shadow-pill">{contract}</p>
            </div>
            <label className="block">
              <span className="text-sm text-ink-2">E-mail – kvitteringen sendes hertil {!isMember && '(brug e-mailen på din konto)'}</span>
              <TextInput className="mt-1.5" type="email" autoComplete="email" required value={email} disabled={step === 'confirm'} onChange={(e) => setEmail(e.target.value)} />
            </label>
            {submit.error && <p className="text-sm text-bad">{submit.error instanceof ApiError ? submit.error.message : 'Noget gik galt – prøv igen'}</p>}
            {step === 'form' ? (
              <Button type="submit" tone="dark" size="lg">
                Fortryd aftale
              </Button>
            ) : (
              <div className="space-y-3">
                <p className="text-ink">Jeg ønsker at fortryde aftalen om mit Tilbudsradar-abonnement.</p>
                <div className="flex flex-wrap gap-2">
                  <Button type="submit" tone="dark" size="lg" loading={submit.isPending}>
                    Bekræft fortrydelse
                  </Button>
                  <Button size="lg" onClick={() => setStep('form')}>
                    Ret oplysninger
                  </Button>
                </div>
              </div>
            )}
          </form>
        )}
      </Card>

      <Section title="Andre måder">
        <p>
          Du kan også fortryde ved at sende en utvetydig besked til{' '}
          <a href={`mailto:${COMPANY.email}`} className="text-ink underline">
            {COMPANY.email}
          </a>
          , eventuelt med standardfortrydelsesformularen i{' '}
          <Link to="/handelsbetingelser#formular" className="text-ink underline">
            handelsbetingelserne
          </Link>
          . Vil du blot stoppe abonnementet ved udgangen af den betalte måned, så{' '}
          <Link to="/app/konto#abonnement" className="text-ink underline">
            opsig det under Konto
          </Link>
          .
        </p>
      </Section>
    </LegalPage>
  );
}
