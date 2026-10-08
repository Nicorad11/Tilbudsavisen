import type { AuthResponse, BillingStatusDTO, UserDTO } from '@tilbudsradar/shared';
import { PLAN } from '@tilbudsradar/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, CircleX, KeyRound, Loader2, MailCheck } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Button, Card, TextInput } from '../components/ui/primitives';
import { formatLongDate } from '../lib/access';
import { track } from '../lib/analytics';
import { api, ApiError } from '../lib/api';
import { useAuth, useUi } from '../lib/store';

function FlowCard({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="mx-auto max-w-md pt-6 lg:pt-12">
      <Card className="p-6 sm:p-8">
        <span className="grid size-12 place-items-center rounded-full bg-lime">{icon}</span>
        <h1 className="mt-4 text-[28px] leading-tight tracking-[-0.035em] text-ink">{title}</h1>
        <div className="mt-3 space-y-4 text-[15px] leading-snug text-ink-2">{children}</div>
      </Card>
    </div>
  );
}

/* ---------------- Nulstil adgangskode ---------------- */

export function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const setAuth = useAuth((s) => s.setAuth);
  const qc = useQueryClient();
  const toast = useUi((s) => s.showToast);
  const navigate = useNavigate();
  const reset = useMutation({
    mutationFn: () => api<AuthResponse>('/auth/reset-password', { method: 'POST', body: { token, password } }),
    onSuccess: (r) => {
      setAuth(r.accessToken, r.user);
      void qc.invalidateQueries();
      toast('Din adgangskode er ændret');
      navigate('/app', { replace: true });
    },
  });
  const mismatch = repeat.length > 0 && password !== repeat;

  if (!token) {
    return (
      <FlowCard icon={<CircleX className="size-6" />} title="Linket mangler">
        <p>Åbn linket fra mailen igen, eller bed om et nyt under Konto → "Glemt adgangskode?".</p>
        <Link to="/app/konto">
          <Button tone="dark">Til Konto</Button>
        </Link>
      </FlowCard>
    );
  }
  return (
    <FlowCard icon={<KeyRound className="size-6" />} title="Vælg ny adgangskode">
      <p>Når du gemmer, bliver du logget ud på alle andre enheder.</p>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!mismatch) reset.mutate();
        }}
      >
        <TextInput type="password" autoComplete="new-password" placeholder="Ny adgangskode (mindst 8 tegn)" minLength={8} required value={password} onChange={(e) => setPassword(e.target.value)} />
        <TextInput type="password" autoComplete="new-password" placeholder="Gentag adgangskode" minLength={8} required value={repeat} onChange={(e) => setRepeat(e.target.value)} />
        {mismatch && <p className="text-sm text-bad">Adgangskoderne er ikke ens</p>}
        {reset.error && <p className="text-sm text-bad">{reset.error instanceof ApiError ? reset.error.message : 'Noget gik galt'}</p>}
        <Button type="submit" tone="dark" size="lg" className="w-full" loading={reset.isPending} disabled={mismatch}>
          Gem adgangskode
        </Button>
      </form>
    </FlowCard>
  );
}

/* ---------------- Bekræft e-mail ---------------- */

export function VerifyEmail() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const setUser = useAuth((s) => s.setUser);
  const loggedIn = useAuth((s) => Boolean(s.accessToken));
  const qc = useQueryClient();
  const sent = useRef(false);
  const verify = useMutation({
    mutationFn: () => api<{ ok: boolean; user: UserDTO }>('/auth/verify-email', { method: 'POST', body: { token } }),
    onSuccess: (r) => {
      if (loggedIn) setUser(r.user);
      void qc.invalidateQueries({ queryKey: ['me'] });
      void qc.invalidateQueries({ queryKey: ['billing'] });
    },
  });

  useEffect(() => {
    // Tokenet kan kun bruges én gang – send kun én gang (også i React StrictMode).
    if (token && !sent.current) {
      sent.current = true;
      verify.mutate();
    }
  }, [token, verify]);

  if (!token || verify.isError) {
    return (
      <FlowCard icon={<CircleX className="size-6" />} title="Linket virker ikke">
        <p>{verify.error instanceof ApiError ? verify.error.message : 'Linket mangler eller er ugyldigt.'}</p>
        <Link to="/app/konto">
          <Button tone="dark">Send et nyt link under Konto</Button>
        </Link>
      </FlowCard>
    );
  }
  if (!verify.isSuccess) {
    return (
      <FlowCard icon={<Loader2 className="size-6 animate-spin" />} title="Bekræfter din e-mail …">
        <p>Et øjeblik.</p>
      </FlowCard>
    );
  }
  return (
    <FlowCard icon={<MailCheck className="size-6" />} title="Din e-mail er bekræftet">
      <p>Tak. {verify.data.user.email} er nu bekræftet{verify.data.user.access.status === 'trial' ? ', og du kan tegne et abonnement, når du er klar' : ''}.</p>
      <Link to={loggedIn ? '/app' : '/app/konto'}>
        <Button tone="dark">{loggedIn ? 'Til appen' : 'Log ind'}</Button>
      </Link>
    </FlowCard>
  );
}

/* ---------------- Betaling ---------------- */

export function CheckoutSuccess() {
  const qc = useQueryClient();
  const started = useRef(Date.now());
  const status = useQuery({
    queryKey: ['billing', 'after-checkout'],
    queryFn: () => api<BillingStatusDTO>('/billing/status'),
    // Webhooken fra Stripe kommer typisk inden for få sekunder.
    refetchInterval: (q) => (q.state.data?.access.subscribed || Date.now() - started.current > 60_000 ? false : 2000),
  });
  const access = status.data?.access;

  useEffect(() => {
    if (access?.subscribed) {
      track('Abonnement startet');
      void qc.invalidateQueries({ queryKey: ['me'] });
      void qc.invalidateQueries({ queryKey: ['billing'] });
    }
  }, [access?.subscribed, qc]);

  if (!access?.subscribed) {
    return (
      <FlowCard icon={<Loader2 className="size-6 animate-spin" />} title="Vi aktiverer dit abonnement …">
        <p>Betalingen er modtaget hos Stripe. Det tager typisk kun et par sekunder, før abonnementet er aktivt.</p>
        {Date.now() - started.current > 60_000 && (
          <p className="text-[13px] text-muted">
            Det tager længere tid end normalt. Du kan roligt fortsætte – vi sender en ordrebekræftelse på e-mail, så snart det er klar.
          </p>
        )}
      </FlowCard>
    );
  }
  return (
    <FlowCard icon={<CheckCircle2 className="size-6" />} title="Velkommen som abonnent">
      <p>
        Dit abonnement er aktivt.{' '}
        {access.nextPaymentAt ? `Næste betaling på ${PLAN.priceDkk} kr. er ${formatLongDate(access.nextPaymentAt)}.` : ''} Vi har sendt en
        ordrebekræftelse med handelsbetingelserne til din e-mail.
      </p>
      <p className="text-[13px] text-muted">Du kan opsige når som helst under Konto og fortryde inden for 14 dage.</p>
      <Link to="/app">
        <Button tone="dark">Til appen</Button>
      </Link>
    </FlowCard>
  );
}

export function CheckoutCanceled() {
  return (
    <FlowCard icon={<CircleX className="size-6" />} title="Betalingen blev afbrudt">
      <p>Der er ikke trukket nogen penge, og dit abonnement er ikke startet.</p>
      <div className="flex flex-wrap gap-2">
        <Link to="/app/konto#abonnement">
          <Button tone="dark">Prøv igen</Button>
        </Link>
        <Link to="/app">
          <Button>Til appen</Button>
        </Link>
      </div>
    </FlowCard>
  );
}
