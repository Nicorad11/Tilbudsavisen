import type { AuthResponse, ScrapeStatusDTO } from '@tilbudsradar/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { AlertTriangle, ArrowUpRight, Compass, Gauge, Loader2, LogOut, Radar, ShieldAlert, UsersRound } from 'lucide-react';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, NavLink, Route, Routes, useLocation } from 'react-router';
import { Wordmark } from '../components/layout/Wordmark';
import { Button, Card, EmptyState, Pill, TextInput } from '../components/ui/primitives';
import { api, ApiError } from '../lib/api';
import { CONFIG } from '../lib/config';
import { useAuth, useUi } from '../lib/store';
import { Customer } from './pages/Customer';
import { Customers } from './pages/Customers';
import { Overview } from './pages/Overview';
import { Sources } from './pages/Sources';

type GateStatus = ScrapeStatusDTO & { adminOpen: boolean };

const NAV = [
  { to: '/', label: 'Overblik', icon: Gauge, end: true },
  { to: '/kunder', label: 'Kunder', icon: UsersRound, end: false },
  { to: '/kilder', label: 'Kilder', icon: Radar, end: false },
];

/**
 * Adgangen afgøres af serveren: /api/admin/status svarer kun administratorer
 * (e-mails i ADMIN_EMAILS). Alle andre ser login – eller "ingen adgang".
 */
export function AdminApp() {
  const checked = useAuth((s) => s.checked);
  const token = useAuth((s) => s.accessToken);
  const user = useAuth((s) => s.user);
  const gate = useQuery({
    queryKey: ['admin-gate', token ?? 'anon'],
    queryFn: () => api<GateStatus>('/admin/status'),
    enabled: checked,
    retry: false,
    staleTime: Infinity,
  });

  if (!checked || gate.isPending) {
    return (
      <div className="grid min-h-dvh place-items-center text-muted">
        <Loader2 className="size-6 animate-spin" aria-label="Indlæser" />
      </div>
    );
  }

  if (gate.isError) {
    const denied = gate.error instanceof ApiError && (gate.error.status === 401 || gate.error.status === 403);
    if (denied && (!user || user.isGuest)) return <Login />;
    if (denied) return <NoAccess email={user?.email ?? null} />;
    return (
      <Centered>
        <EmptyState
          icon={<AlertTriangle className="size-6" />}
          title="Serveren svarer ikke"
          action={<Button onClick={() => void gate.refetch()}>Prøv igen</Button>}
        >
          {gate.error.message}
        </EmptyState>
      </Centered>
    );
  }

  return <Shell adminOpen={gate.data.adminOpen} />;
}

function Shell({ adminOpen }: { adminOpen: boolean }) {
  const { pathname } = useLocation();
  const user = useAuth((s) => s.user);
  const logout = useLogout();
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [pathname]);

  return (
    <div className="mx-auto min-h-dvh max-w-[1240px] px-4 pb-16 sm:px-6">
      <header className="sticky top-0 z-30 -mx-4 flex flex-wrap items-center gap-x-4 gap-y-2 bg-canvas/85 px-4 py-3 backdrop-blur-md sm:-mx-6 sm:px-6">
        <div className="flex items-center gap-2">
          <Wordmark to="/" />
          <Pill tone="dark">admin</Pill>
        </div>
        <nav className="order-last -mx-1 flex w-full overflow-x-auto md:order-none md:mx-auto md:w-auto" aria-label="Admin-menu">
          <div className="inline-flex gap-1 rounded-full bg-black/[0.045] p-1">
            {NAV.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.end}
                className={({ isActive }) =>
                  clsx(
                    'inline-flex h-8 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-medium whitespace-nowrap transition',
                    isActive ? 'bg-raised text-ink shadow-pill' : 'text-muted hover:text-ink',
                  )
                }
              >
                <n.icon className="size-4" strokeWidth={1.7} />
                {n.label}
              </NavLink>
            ))}
          </div>
        </nav>
        <div className="ml-auto flex items-center gap-1 md:ml-0">
          <a
            href={CONFIG.appUrl}
            target="_blank"
            rel="noreferrer"
            className="hidden h-8 items-center gap-1 rounded-full px-3 text-[13px] text-ink-2 hover:bg-black/5 hover:text-ink sm:inline-flex"
          >
            Hjemmesiden <ArrowUpRight className="size-3.5" />
          </a>
          <Button
            size="sm"
            tone="ghost"
            icon={<LogOut className="size-4" />}
            loading={logout.isPending}
            onClick={() => logout.mutate()}
            title={user?.email ?? undefined}
          >
            Log ud
          </Button>
        </div>
      </header>

      {adminOpen && (
        <p className="mt-2 flex items-center gap-2 rounded-2xl bg-[#fbe6cf] px-4 py-2.5 text-[13px] text-[#8a4a0b]">
          <AlertTriangle className="size-4 shrink-0" />
          Udviklingstilstand: admin er åben for alle, fordi ADMIN_EMAILS ikke er sat. Sæt den før deploy.
        </p>
      )}

      <main className="pt-4">
        <Routes>
          <Route index element={<Overview />} />
          <Route path="kunder" element={<Customers />} />
          <Route path="kunder/:id" element={<Customer />} />
          <Route path="kilder" element={<Sources />} />
          <Route
            path="*"
            element={
              <EmptyState
                className="pt-16"
                icon={<Compass className="size-6" />}
                title="Siden findes ikke"
                action={
                  <Link to="/">
                    <Button tone="dark">Til overblikket</Button>
                  </Link>
                }
              />
            }
          />
        </Routes>
      </main>
      <Toast />
    </div>
  );
}

function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api('/auth/logout', { method: 'POST', auth: false }),
    onSettled: () => {
      useAuth.getState().clear();
      qc.clear();
    },
  });
}

function Centered({ children }: { children: ReactNode }) {
  return <div className="grid min-h-dvh place-items-center px-4 py-10">{children}</div>;
}

function Login() {
  const qc = useQueryClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const login = useMutation({
    mutationFn: () => api<AuthResponse>('/auth/login', { method: 'POST', body: { email, password }, auth: false }),
    onSuccess: (res) => {
      useAuth.getState().setAuth(res.accessToken, res.user);
      void qc.invalidateQueries({ queryKey: ['admin-gate'] });
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    login.mutate();
  };

  return (
    <Centered>
      <Card className="w-full max-w-[400px] p-7">
        <div className="flex items-center gap-2">
          <Wordmark to="/" />
          <Pill tone="dark">admin</Pill>
        </div>
        <h1 className="mt-6 text-[30px] leading-tight tracking-[-0.04em] text-ink">Log ind</h1>
        <p className="mt-1 text-sm text-muted">Kun for administratorer af Tilbudsradar.</p>
        <form className="mt-6 space-y-3" onSubmit={submit}>
          <TextInput
            type="email"
            autoComplete="username"
            placeholder="E-mail"
            aria-label="E-mail"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <TextInput
            type="password"
            autoComplete="current-password"
            placeholder="Adgangskode"
            aria-label="Adgangskode"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {login.error && (
            <p role="alert" className="px-1 text-[13px] text-bad">
              {login.error.message}
            </p>
          )}
          <Button type="submit" tone="dark" size="lg" className="w-full" loading={login.isPending}>
            Log ind
          </Button>
        </form>
        <p className="mt-5 text-[12.5px] text-muted">
          Glemt adgangskoden? Nulstil den under{' '}
          <a className="underline underline-offset-2 hover:text-ink" href={`${CONFIG.appUrl}/app/konto`}>
            Konto på hjemmesiden
          </a>
          .
        </p>
      </Card>
    </Centered>
  );
}

function NoAccess({ email }: { email: string | null }) {
  const logout = useLogout();
  return (
    <Centered>
      <EmptyState
        icon={<ShieldAlert className="size-6" />}
        title="Ingen adgang"
        action={
          <Button icon={<LogOut className="size-4" />} loading={logout.isPending} onClick={() => logout.mutate()}>
            Log ud
          </Button>
        }
      >
        {email ? `${email} er ikke administrator.` : 'Kontoen er ikke administrator.'} Administratorer sættes med ADMIN_EMAILS på serveren.
      </EmptyState>
    </Centered>
  );
}

function Toast() {
  const toast = useUi((s) => s.toast);
  if (!toast) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-8 z-[60] flex justify-center px-4">
      <div
        key={toast.id}
        role="status"
        className={clsx('glass animate-rise rounded-full px-5 py-3 text-sm', toast.tone === 'error' ? 'text-bad' : 'text-ink')}
      >
        {toast.text}
      </div>
    </div>
  );
}
