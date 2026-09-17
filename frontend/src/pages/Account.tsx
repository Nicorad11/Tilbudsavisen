import type { AuthResponse, UserDTO } from '@tilbudsradar/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Download, LogOut, Trash2, UserRound } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Button, Card, Chip, Pill, Segmented, StoreDot, TextInput } from '../components/ui/primitives';
import { api, ApiError, ensureSession } from '../lib/api';
import { formatDay } from '../lib/format';
import { useMe, useStores } from '../lib/hooks';
import { useAuth, useUi } from '../lib/store';
import { storeColor } from '../lib/storeColors';

const DIETS = ['Vegetar', 'Pescetar', 'Glutenfri', 'Laktosefri', 'Børnevenlig'];

export function Account() {
  const token = useAuth((s) => s.accessToken);
  const storedUser = useAuth((s) => s.user);
  const me = useMe();
  const user = me.data ?? storedUser;

  return (
    <div className="space-y-5 pt-2 lg:pt-4">
      <div>
        <p className="text-sm text-muted">{user && !user.isGuest ? user.email : 'Gæst – ingen personlige oplysninger gemt'}</p>
        <h1 className="mt-1 text-[36px] leading-[1.05] tracking-[-0.045em] sm:text-[48px]">Konto</h1>
      </div>
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {!token || !user || user.isGuest ? <AuthCard guest={Boolean(user?.isGuest)} /> : <ProfileCard user={user} />}
        {token && user && <PreferencesCard user={user} />}
        {!token && (
          <Card className="p-6 text-sm text-ink-2">
            <p className="text-lg tracking-tight text-ink">Hvorfor en konto?</p>
            <ul className="mt-3 list-disc space-y-1.5 pl-5">
              <li>Dine lister, madplaner og alarmer på alle enheder</li>
              <li>E-mail når en fulgt vare kommer på tilbud</li>
              <li>Søgning og tilbud virker fint uden konto</li>
            </ul>
          </Card>
        )}
      </div>
      <p className="text-center text-xs text-muted">
        Admin? Se <Link to="/kilder" className="underline">scraping-kilder</Link>.
      </p>
    </div>
  );
}

function AuthCard({ guest }: { guest: boolean }) {
  const [mode, setMode] = useState<'login' | 'register'>(guest ? 'register' : 'login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const setAuth = useAuth((s) => s.setAuth);
  const qc = useQueryClient();
  const toast = useUi((s) => s.showToast);
  const submit = useMutation({
    mutationFn: () => api<AuthResponse>(`/auth/${mode}`, { method: 'POST', body: { email, password } }),
    onSuccess: (r) => {
      setAuth(r.accessToken, r.user);
      void qc.invalidateQueries();
      toast(mode === 'login' ? 'Du er logget ind' : 'Kontoen er oprettet');
    },
  });
  const guestSession = useMutation({ mutationFn: ensureSession, onSuccess: () => toast('Du fortsætter som gæst') });
  const err = submit.error instanceof ApiError ? submit.error : null;

  return (
    <Card className="p-5 sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <span className="grid size-11 place-items-center rounded-full bg-raised shadow-pill">
          <UserRound className="size-5" strokeWidth={1.6} />
        </span>
        <Segmented
          value={mode}
          onChange={setMode}
          options={[
            { value: 'login', label: 'Log ind' },
            { value: 'register', label: 'Opret konto' },
          ]}
        />
      </div>
      {guest && mode === 'register' && (
        <p className="mt-4 rounded-2xl bg-lime/50 px-3 py-2 text-[13px]">Dine lister og alarmer fra gæstesessionen følger med over på kontoen.</p>
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
        {err && (
          <p className="text-sm text-bad">
            {err.message}
            {Array.isArray(err.details) && `: ${(err.details as { message: string }[]).map((d) => d.message).join(', ')}`}
          </p>
        )}
        <Button type="submit" tone="dark" size="lg" className="w-full" loading={submit.isPending}>
          {mode === 'login' ? 'Log ind' : 'Opret konto'}
        </Button>
      </form>
      {!guest && (
        <Button tone="ghost" className="mt-2 w-full" loading={guestSession.isPending} onClick={() => guestSession.mutate()}>
          Fortsæt som gæst
        </Button>
      )}
      <p className="mt-4 text-[11px] leading-snug text-muted">
        Vi gemmer kun din e-mail, en krypteret adgangskode og de præferencer du selv angiver. Du kan til enhver tid hente eller slette dine data.
      </p>
    </Card>
  );
}

function ProfileCard({ user }: { user: UserDTO }) {
  const clear = useAuth((s) => s.clear);
  const qc = useQueryClient();
  const toast = useUi((s) => s.showToast);
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
      <Button className="mt-5" icon={<LogOut className="size-4" />} loading={logout.isPending} onClick={() => logout.mutate()}>
        Log ud
      </Button>
      <PrivacyActions />
    </Card>
  );
}

function PrivacyActions() {
  const clear = useAuth((s) => s.clear);
  const qc = useQueryClient();
  const toast = useUi((s) => s.showToast);
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
      toast('Alle dine data er slettet');
    },
  });
  return (
    <div className="mt-6 border-t border-line/70 pt-5">
      <p className="text-sm text-ink">Dine data</p>
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
          onClick={() => window.confirm('Slet konto, lister, madplaner og alarmer permanent?') && remove.mutate()}
        >
          Slet konto og data
        </Button>
      </div>
    </div>
  );
}

function PreferencesCard({ user }: { user: UserDTO }) {
  const stores = useStores();
  const setUser = useAuth((s) => s.setUser);
  const toast = useUi((s) => s.showToast);
  const qc = useQueryClient();
  const [preferred, setPreferred] = useState(user.preferredStoreIds);
  const [diet, setDiet] = useState(user.dietPreferences);
  const [zip, setZip] = useState(user.zipCode ?? '');
  const [radius, setRadius] = useState(user.radiusKm ?? 10);
  useEffect(() => {
    setPreferred(user.preferredStoreIds);
    setDiet(user.dietPreferences);
  }, [user]);

  const save = useMutation({
    mutationFn: () =>
      api<UserDTO>('/auth/me', {
        method: 'PATCH',
        body: { preferredStoreIds: preferred, dietPreferences: diet, zipCode: zip || null, radiusKm: radius },
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
        <p className="text-xs text-muted">Bruges til indkøbslister og madplaner</p>
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
      <div>
        <p className="mb-2 text-sm text-ink-2">Kost</p>
        <div className="flex flex-wrap gap-2">
          {DIETS.map((d) => (
            <Chip key={d} active={diet.includes(d)} onClick={() => setDiet(toggle(diet, d))}>
              {d}
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
      {user.isGuest && <PrivacyActions />}
    </Card>
  );
}
