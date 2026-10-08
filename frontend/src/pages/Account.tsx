import type { AuthResponse, UserDTO } from '@tilbudsradar/shared';
import { PLAN, TERMS_VERSION } from '@tilbudsradar/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { BadgeCheck, CreditCard, Download, KeyRound, LogOut, Mail, Trash2, UserRound } from 'lucide-react';
import { useEffect, useId, useState, type ReactNode } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router';
import { SubscribePanel } from '../components/billing/SubscribePanel';
import { Button, Card, Chip, Pill, Segmented, StoreDot, TextInput } from '../components/ui/primitives';
import { formatLongDate, useAccess, useBillingStatus, usePortal, useResendVerification } from '../lib/access';
import { track } from '../lib/analytics';
import { api, ApiError } from '../lib/api';
import { formatDay } from '../lib/format';
import { useStores } from '../lib/hooks';
import { useAuth, useUi } from '../lib/store';
import { storeColor } from '../lib/storeColors';

export function Account() {
  const token = useAuth((s) => s.accessToken);
  const { user, isMember } = useAccess();
  const [params] = useSearchParams();
  const { hash } = useLocation();

  useEffect(() => {
    if (hash && isMember) document.getElementById(hash.slice(1))?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [hash, isMember]);

  return (
    <div className="space-y-5 pt-2 lg:pt-4">
      <div>
        <p className="text-sm text-muted">{isMember ? user?.email : 'Log ind eller opret en gratis konto'}</p>
        <h1 className="mt-1 text-[36px] leading-[1.05] tracking-[-0.045em] sm:text-[48px]">Konto</h1>
      </div>
      {!isMember || !user ? (
        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <AuthCard guest={Boolean(user?.isGuest)} initialMode={params.get('opret') === '1' || user?.isGuest ? 'register' : 'login'} />
          <WhyCard />
          {token && user?.isGuest && <PreferencesCard user={user} />}
        </div>
      ) : (
        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="space-y-5">
            <ProfileCard user={user} />
            <SubscriptionCard />
          </div>
          <div className="space-y-5">
            <SecurityCard user={user} />
            <PreferencesCard user={user} />
            <DataCard />
          </div>
        </div>
      )}
      {user?.role === 'admin' && (
        <p className="text-center text-xs text-muted">
          Administrator: se <Link to="/app/kilder" className="underline">scraping-kilder</Link>.
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Log ind, opret konto og glemt adgangskode                          */
/* ------------------------------------------------------------------ */

type AuthMode = 'login' | 'register' | 'forgot';

function errorText(err: unknown): string | null {
  if (!(err instanceof ApiError)) return err instanceof Error ? err.message : null;
  const details = Array.isArray(err.details) ? (err.details as { message: string }[]).map((d) => d.message).join(', ') : '';
  return details ? `${err.message}: ${details}` : err.message;
}

function AuthCard({ guest, initialMode }: { guest: boolean; initialMode: AuthMode }) {
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const termsId = useId();
  const setAuth = useAuth((s) => s.setAuth);
  const qc = useQueryClient();
  const toast = useUi((s) => s.showToast);

  useEffect(() => setMode(initialMode), [initialMode]);

  const submit = useMutation({
    mutationFn: () =>
      mode === 'register'
        ? api<AuthResponse>('/auth/register', { method: 'POST', body: { email, password, acceptTerms: accepted, termsVersion: TERMS_VERSION } })
        : api<AuthResponse>('/auth/login', { method: 'POST', body: { email, password } }),
    onSuccess: (r) => {
      setAuth(r.accessToken, r.user);
      void qc.invalidateQueries();
      if (mode === 'register') {
        track('Prøveperiode startet');
        toast(r.user.access.status === 'trial' ? 'Kontoen er oprettet – din prøveperiode er startet' : 'Kontoen er oprettet');
      } else toast('Du er logget ind');
    },
  });
  const forgot = useMutation({
    mutationFn: () => api<{ message: string }>('/auth/forgot-password', { method: 'POST', body: { email } }),
    onSuccess: (r) => setSent(r.message),
  });
  const err = errorText(mode === 'forgot' ? forgot.error : submit.error);

  return (
    <Card className="p-5 sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <span className="grid size-11 place-items-center rounded-full bg-raised shadow-pill">
          <UserRound className="size-5" strokeWidth={1.6} />
        </span>
        {mode !== 'forgot' && (
          <Segmented
            value={mode}
            onChange={setMode}
            options={[
              { value: 'login', label: 'Log ind' },
              { value: 'register', label: 'Opret konto' },
            ]}
          />
        )}
      </div>

      {mode === 'forgot' ? (
        <div className="mt-5">
          <p className="text-lg tracking-tight">Glemt adgangskode</p>
          <p className="mt-1 text-sm text-muted">Skriv din e-mail, så sender vi et link til at vælge en ny adgangskode. Linket virker i 1 time.</p>
          {sent ? (
            <p className="mt-4 rounded-2xl bg-lime/50 px-3 py-2.5 text-[13.5px] text-ink">{sent}</p>
          ) : (
            <form
              className="mt-4 space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                forgot.mutate();
              }}
            >
              <TextInput type="email" autoComplete="email" placeholder="E-mail" required value={email} onChange={(e) => setEmail(e.target.value)} />
              {err && <p className="text-sm text-bad">{err}</p>}
              <Button type="submit" tone="dark" size="lg" className="w-full" loading={forgot.isPending}>
                Send link
              </Button>
            </form>
          )}
          <Button tone="ghost" className="mt-2 w-full" onClick={() => setMode('login')}>
            Tilbage til log ind
          </Button>
        </div>
      ) : (
        <>
          {mode === 'register' && (
            <p className="mt-4 rounded-2xl bg-lime/50 px-3 py-2 text-[13px] leading-snug text-ink">
              {guest ? 'Dine lister og alarmer fra gæstesessionen følger med over på kontoen. ' : ''}
              Du får {PLAN.trialDays} dages gratis prøveperiode med alle funktioner – uden betalingskort. Den bliver ikke automatisk til et abonnement.
            </p>
          )}
          <form
            className="mt-5 space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              submit.mutate();
            }}
          >
            <TextInput type="email" autoComplete="email" placeholder="E-mail" required value={email} onChange={(e) => setEmail(e.target.value)} />
            <TextInput
              type="password"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              placeholder="Adgangskode (mindst 8 tegn)"
              minLength={8}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            {mode === 'register' && (
              <label htmlFor={termsId} className="flex cursor-pointer items-start gap-3 pt-1 text-[13.5px] leading-snug text-ink-2">
                <input
                  id={termsId}
                  type="checkbox"
                  required
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
            )}
            {err && <p className="text-sm text-bad">{err}</p>}
            <Button type="submit" tone="dark" size="lg" className="w-full" loading={submit.isPending} disabled={mode === 'register' && !accepted}>
              {mode === 'login' ? 'Log ind' : `Opret konto – ${PLAN.trialDays} dage gratis`}
            </Button>
          </form>
          {mode === 'login' && (
            <button type="button" className="mt-3 text-[13px] text-ink-2 underline underline-offset-2 hover:text-ink" onClick={() => setMode('forgot')}>
              Glemt adgangskode?
            </button>
          )}
        </>
      )}
      <p className="mt-4 text-[11px] leading-snug text-muted">
        Vi gemmer kun din e-mail, en krypteret adgangskode og de præferencer du selv angiver. Du kan til enhver tid hente eller slette dine data.
      </p>
    </Card>
  );
}

function WhyCard() {
  return (
    <Card className="p-6 text-sm text-ink-2">
      <p className="text-lg tracking-tight text-ink">Hvad får du med en konto?</p>
      <ul className="mt-3 list-disc space-y-1.5 pl-5">
        <li>{PLAN.trialDays} dages gratis prøveperiode – intet betalingskort</li>
        <li>Indkøbslister, der finder den billigste kombination af butikker</li>
        <li>Prisalarmer på e-mail, når dine faste varer kommer på tilbud</li>
        <li>Kvitteringsscanner, der viser hvad du sparede – og fejl ved kassen</li>
        <li>Prishistorik og community-vurderinger</li>
      </ul>
      <p className="mt-3">
        Derefter {PLAN.priceDkk} kr/md, hvis du vælger at abonnere. Søgning og ugens tilbud er altid gratis.{' '}
        <Link to="/priser" className="text-ink underline underline-offset-2">
          Se priser
        </Link>
      </p>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Profil og abonnement                                               */
/* ------------------------------------------------------------------ */

function ProfileCard({ user }: { user: UserDTO }) {
  const clear = useAuth((s) => s.clear);
  const qc = useQueryClient();
  const toast = useUi((s) => s.showToast);
  const resend = useResendVerification();
  const logout = useMutation({
    mutationFn: () => api('/auth/logout', { method: 'POST' }),
    onSettled: () => {
      clear();
      qc.clear();
      toast('Du er logget ud');
    },
  });
  return (
    <Card className="p-5 sm:p-6">
      <div className="flex items-center gap-3">
        <span className="grid size-12 place-items-center rounded-full bg-lime text-lg">{user.email?.[0]?.toUpperCase()}</span>
        <div className="min-w-0">
          <p className="truncate text-lg tracking-tight">{user.email}</p>
          <p className="text-xs text-muted">Medlem siden {formatDay(user.createdAt)}</p>
        </div>
        {user.role === 'admin' && <Pill tone="dark" className="ml-auto">Admin</Pill>}
      </div>
      <div className="mt-4">
        {user.emailVerified ? (
          <Pill tone="ok" icon={<BadgeCheck className="size-3.5" />}>
            E-mail bekræftet
          </Pill>
        ) : (
          <p className="text-[13px] text-ink-2">
            <Pill tone="warn">Ikke bekræftet</Pill>{' '}
            <button type="button" className="ml-1 underline underline-offset-2" disabled={resend.isPending} onClick={() => resend.mutate()}>
              Send bekræftelsesmail igen
            </button>
          </p>
        )}
      </div>
      <Button className="mt-5" icon={<LogOut className="size-4" />} loading={logout.isPending} onClick={() => logout.mutate()}>
        Log ud
      </Button>
    </Card>
  );
}

const STATUS_LABEL = {
  trial: 'Prøveperiode',
  active: 'Aktivt abonnement',
  past_due: 'Betaling fejlede',
  canceled: 'Opsagt',
  expired: 'Ingen aktiv adgang',
  free: 'Ingen konto',
} as const;

function SubscriptionCard() {
  const { access } = useAccess();
  const billing = useBillingStatus();
  const portal = usePortal();
  const scans = billing.data?.receiptScans;

  return (
    <Card id="abonnement" className="scroll-mt-24 p-5 sm:p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-lg tracking-tight">Abonnement</p>
          <p className="text-xs text-muted">{PLAN.priceDkk} kr/md inkl. moms · ingen binding</p>
        </div>
        <Pill tone={access.hasAccess ? 'lime' : 'ghost'} icon={<CreditCard className="size-3.5" />}>
          {access.isAdmin ? 'Administrator' : STATUS_LABEL[access.status]}
        </Pill>
      </div>

      <dl className="mt-4 space-y-1.5 text-[13.5px] text-ink-2">
        {access.status === 'trial' && access.trialEndsAt && (
          <Row label="Prøveperioden slutter">
            {formatLongDate(access.trialEndsAt)} ({access.trialDaysLeft} {access.trialDaysLeft === 1 ? 'dag' : 'dage'} tilbage)
          </Row>
        )}
        {access.nextPaymentAt && !access.cancelAtPeriodEnd && (
          <Row label="Næste betaling">
            {formatLongDate(access.nextPaymentAt)} · {PLAN.priceDkk} kr
          </Row>
        )}
        {access.status === 'canceled' && <Row label="Adgang til og med">{formatLongDate(access.currentPeriodEnd)}</Row>}
        {access.status === 'past_due' && <Row label="Opdatér kortet inden">{formatLongDate(access.graceEndsAt)}</Row>}
        {scans && (
          <Row label="Kvitteringsscanninger">
            {scans.used} af {scans.limit} denne måned
          </Row>
        )}
      </dl>

      {access.subscribed ? (
        <div className="mt-5 space-y-3">
          <Button tone="dark" className="w-full" loading={portal.isPending} onClick={() => portal.mutate()}>
            {access.cancelAtPeriodEnd ? 'Genoptag abonnementet' : 'Administrér eller opsig'}
          </Button>
          <p className="text-[12px] leading-snug text-muted">
            I Stripes kundeportal kan du opdatere betalingskort, se fakturaer og opsige. Opsigelsen gælder fra udløbet af den betalte måned.
          </p>
          {access.withdrawableUntil && (
            <p className="rounded-2xl bg-black/[0.045] px-3 py-2.5 text-[13px] leading-snug text-ink-2">
              Du kan fortryde aftalen og få pengene tilbage til og med {formatLongDate(access.withdrawableUntil)}.{' '}
              <Link to="/fortryd" className="font-medium text-ink underline underline-offset-2">
                Fortryd aftale
              </Link>
            </p>
          )}
        </div>
      ) : access.isAdmin ? (
        <p className="mt-4 text-[13px] text-muted">Administratorer har altid fuld adgang.</p>
      ) : (
        <SubscribePanel className="mt-5" />
      )}
    </Card>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap justify-between gap-x-4">
      <dt className="text-muted">{label}</dt>
      <dd className="text-ink">{children}</dd>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Skift e-mail og adgangskode                                        */
/* ------------------------------------------------------------------ */

function SecurityCard({ user }: { user: UserDTO }) {
  const setAuth = useAuth((s) => s.setAuth);
  const toast = useUi((s) => s.showToast);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [emailPassword, setEmailPassword] = useState('');
  const [emailSent, setEmailSent] = useState<string | null>(null);

  const changePassword = useMutation({
    mutationFn: () => api<AuthResponse>('/auth/change-password', { method: 'POST', body: { currentPassword: current, newPassword: next } }),
    onSuccess: (r) => {
      setAuth(r.accessToken, r.user);
      setCurrent('');
      setNext('');
      toast('Adgangskoden er ændret – du er logget ud på dine andre enheder');
    },
  });
  const changeEmail = useMutation({
    mutationFn: () => api<{ message: string }>('/auth/change-email', { method: 'POST', body: { newEmail, password: emailPassword } }),
    onSuccess: (r) => {
      setEmailSent(r.message);
      setEmailPassword('');
    },
  });

  return (
    <Card className="space-y-6 p-5 sm:p-6">
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          changeEmail.mutate();
        }}
      >
        <p className="flex items-center gap-2 text-lg tracking-tight">
          <Mail className="size-4" strokeWidth={1.6} /> Skift e-mail
        </p>
        <p className="text-xs text-muted">Nu: {user.email}. Den nye e-mail skal bekræftes, før den træder i kraft.</p>
        {emailSent ? (
          <p className="rounded-2xl bg-lime/50 px-3 py-2.5 text-[13px] text-ink">{emailSent}</p>
        ) : (
          <>
            <TextInput type="email" autoComplete="email" placeholder="Ny e-mail" required value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />
            <TextInput
              type="password"
              autoComplete="current-password"
              placeholder="Din adgangskode"
              required
              value={emailPassword}
              onChange={(e) => setEmailPassword(e.target.value)}
            />
            {changeEmail.error && <p className="text-sm text-bad">{errorText(changeEmail.error)}</p>}
            <Button type="submit" size="sm" loading={changeEmail.isPending}>
              Send bekræftelse
            </Button>
          </>
        )}
      </form>

      <form
        className="space-y-3 border-t border-line/70 pt-5"
        onSubmit={(e) => {
          e.preventDefault();
          changePassword.mutate();
        }}
      >
        <p className="flex items-center gap-2 text-lg tracking-tight">
          <KeyRound className="size-4" strokeWidth={1.6} /> Skift adgangskode
        </p>
        <TextInput
          type="password"
          autoComplete="current-password"
          placeholder="Nuværende adgangskode"
          required
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
        />
        <TextInput
          type="password"
          autoComplete="new-password"
          placeholder="Ny adgangskode (mindst 8 tegn)"
          minLength={8}
          required
          value={next}
          onChange={(e) => setNext(e.target.value)}
        />
        {changePassword.error && <p className="text-sm text-bad">{errorText(changePassword.error)}</p>}
        <Button type="submit" size="sm" loading={changePassword.isPending}>
          Gem ny adgangskode
        </Button>
      </form>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Data (GDPR) og præferencer                                         */
/* ------------------------------------------------------------------ */

function DataCard() {
  const clear = useAuth((s) => s.clear);
  const qc = useQueryClient();
  const toast = useUi((s) => s.showToast);
  const { access } = useAccess();
  const exportData = useMutation({
    mutationFn: () => api<unknown>('/auth/me/export'),
    onSuccess: (data) => {
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = 'tilbudsradar-data.json';
      a.click();
      URL.revokeObjectURL(url);
    },
  });
  const remove = useMutation({
    mutationFn: () => api('/auth/me', { method: 'DELETE' }),
    onSuccess: () => {
      clear();
      qc.clear();
      toast('Din konto og alle dine data er slettet');
    },
    onError: (e) => toast(e instanceof Error ? e.message : 'Kontoen kunne ikke slettes', 'error'),
  });
  const confirmText = access.subscribed
    ? 'Dit abonnement opsiges med det samme, og konto, lister, kvitteringer og alarmer slettes permanent. Fortsæt?'
    : 'Slet konto, lister, kvitteringer og alarmer permanent?';
  return (
    <Card className="p-5 sm:p-6">
      <p className="text-lg tracking-tight">Dine data</p>
      <p className="text-xs text-muted">Ret til indsigt og sletning (GDPR)</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" icon={<Download className="size-3.5" />} loading={exportData.isPending} onClick={() => exportData.mutate()}>
          Hent mine data
        </Button>
        <Button
          size="sm"
          tone="danger"
          icon={<Trash2 className="size-3.5" />}
          loading={remove.isPending}
          onClick={() => window.confirm(confirmText) && remove.mutate()}
        >
          Slet konto og data
        </Button>
      </div>
    </Card>
  );
}

function PreferencesCard({ user }: { user: UserDTO }) {
  const stores = useStores();
  const setUser = useAuth((s) => s.setUser);
  const toast = useUi((s) => s.showToast);
  const qc = useQueryClient();
  const [preferred, setPreferred] = useState(user.preferredStoreIds);
  const [zip, setZip] = useState(user.zipCode ?? '');
  const [radius, setRadius] = useState(user.radiusKm ?? 10);
  useEffect(() => {
    setPreferred(user.preferredStoreIds);
  }, [user]);

  const save = useMutation({
    mutationFn: () =>
      api<UserDTO>('/auth/me', {
        method: 'PATCH',
        body: { preferredStoreIds: preferred, zipCode: zip || null, radiusKm: radius },
      }),
    onSuccess: (u) => {
      setUser(u);
      void qc.invalidateQueries({ queryKey: ['me'] });
      void qc.invalidateQueries({ queryKey: ['optimize'] });
      toast('Præferencerne er gemt');
    },
    onError: (e) => toast(e instanceof Error ? e.message : 'Fejl', 'error'),
  });
  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  return (
    <Card className="space-y-5 p-5 sm:p-6">
      <div>
        <p className="text-lg tracking-tight">Præferencer</p>
        <p className="text-xs text-muted">Bruges til indkøbslister og søgning i nærheden</p>
      </div>
      <div>
        <p className="mb-2 text-sm text-ink-2">Foretrukne kæder {preferred.length === 0 && <span className="text-muted">(alle)</span>}</p>
        <div className="flex flex-wrap gap-2">
          {stores.data?.map((s) => (
            <Chip key={s.id} color={storeColor(s.id)} active={preferred.includes(s.id)} onClick={() => setPreferred(toggle(preferred, s.id))}>
              {s.name}
            </Chip>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="text-sm text-ink-2">Postnummer</span>
          <TextInput className="mt-2 w-32" inputMode="numeric" maxLength={4} value={zip} onChange={(e) => setZip(e.target.value.replace(/\D/g, ''))} />
        </label>
        <div>
          <span className="text-sm text-ink-2">Afstand</span>
          <Segmented
            className="mt-2 flex"
            size="sm"
            value={radius}
            onChange={setRadius}
            options={[2, 5, 10, 25].map((r) => ({ value: r, label: `${r} km` }))}
          />
        </div>
      </div>
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-1.5 text-[11px] text-muted">
          {preferred.slice(0, 5).map((id) => (
            <StoreDot key={id} color={storeColor(id)} className="ring-0" />
          ))}
        </span>
        <Button tone="dark" loading={save.isPending} onClick={() => save.mutate()}>
          Gem
        </Button>
      </div>
    </Card>
  );
}
