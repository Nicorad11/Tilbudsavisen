import type { AdminCustomerDetail, AdminCustomerEvent, AdminCustomerUpdate, AdminMailResult } from '@tilbudsradar/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import {
  ArrowLeft,
  BadgeCheck,
  CalendarClock,
  CreditCard,
  ExternalLink,
  History,
  KeyRound,
  LogOut,
  Mail,
  Trash2,
  UserRound,
} from 'lucide-react';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Button, Card, EmptyState, Pill, Skeleton, TextInput } from '../../components/ui/primitives';
import { api, ApiError } from '../../lib/api';
import { int, relativeTime } from '../../lib/format';
import { useUi } from '../../lib/store';
import { ACTION_LABEL, fmtDate, fmtDateTime, STATUS_LABEL, STATUS_TONE } from '../labels';

const DAY = 86_400_000;

/** Dato til <input type="date"> i lokal tid. */
const toDateInput = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
/** Valgt dato → slutningen af den dag (lokal tid), så kunden har adgang hele dagen. */
const endOfDay = (value: string) => new Date(`${value}T23:59:59`).toISOString();

export function Customer() {
  const { id = '' } = useParams();
  const detail = useQuery({
    queryKey: ['admin-customer', id],
    queryFn: () => api<AdminCustomerDetail>(`/admin/users/${encodeURIComponent(id)}`),
  });

  return (
    <div className="space-y-5 pb-10">
      <Link to="/kunder" className="inline-flex items-center gap-1.5 pt-2 text-[13px] text-ink-2 hover:text-ink">
        <ArrowLeft className="size-4" /> Kunder
      </Link>
      {detail.isPending ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-48" />
          ))}
        </div>
      ) : detail.isError ? (
        <EmptyState
          icon={<UserRound className="size-6" />}
          title={detail.error instanceof ApiError && detail.error.status === 404 ? 'Kunden findes ikke' : 'Kunne ikke hente kunden'}
        >
          {detail.error instanceof ApiError && detail.error.status === 404 ? 'Kontoen kan være slettet.' : detail.error.message}
        </EmptyState>
      ) : (
        <CustomerView c={detail.data} />
      )}
    </div>
  );
}

function CustomerView({ c }: { c: AdminCustomerDetail }) {
  const status = c.access.status;
  return (
    <>
      <div>
        <div className="flex flex-wrap items-center gap-2">
          {c.isAdmin ? <Pill tone="dark">Administrator</Pill> : <Pill tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Pill>}
          {!c.emailVerifiedAt && <Pill tone="warn">E-mail ikke bekræftet</Pill>}
          {c.isSelf && <Pill tone="lime">Det er dig</Pill>}
        </div>
        <h1 className="mt-2 text-[30px] leading-[1.08] tracking-[-0.04em] break-all text-ink sm:text-[40px]">{c.email}</h1>
        <p className="mt-1 text-[13px] text-muted">
          Oprettet {fmtDate(c.createdAt)} · sidst aktiv {relativeTime(c.lastSeenAt)}
        </p>
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          <AccessCard c={c} />
          <BillingCard c={c} />
          <ActivityCard c={c} />
        </div>
        <div className="space-y-4">
          <LoginCard c={c} />
          <HistoryCard events={c.events} />
          <DeleteCard c={c} />
        </div>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */

function Section({
  icon,
  title,
  subtitle,
  children,
  className,
}: {
  icon: ReactNode;
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card className={clsx('p-5 sm:p-6', className)}>
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-black/[0.05] text-ink-2">{icon}</span>
        <div className="min-w-0">
          <p className="text-[17px] tracking-tight text-ink">{title}</p>
          {subtitle && <p className="text-[12.5px] text-muted">{subtitle}</p>}
        </div>
      </div>
      <div className="mt-4">{children}</div>
    </Card>
  );
}

function Rows({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="divide-y divide-black/[0.06] text-[13px]">
      {rows.map(([label, value]) => (
        <div key={label} className="flex items-baseline justify-between gap-4 py-2">
          <dt className="text-muted">{label}</dt>
          <dd className="min-w-0 text-right break-words text-ink">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Opdaterer kunden i cachen og genindlæser listen. */
function useCustomerCache(id: string) {
  const qc = useQueryClient();
  return {
    set: (data: AdminCustomerDetail) => {
      qc.setQueryData(['admin-customer', id], data);
      void qc.invalidateQueries({ queryKey: ['admin-customers'] });
      void qc.invalidateQueries({ queryKey: ['admin-overview'] });
    },
    refresh: () => void qc.invalidateQueries({ queryKey: ['admin-customer', id] }),
  };
}

function usePatch(id: string) {
  const cache = useCustomerCache(id);
  const toast = useUi((s) => s.showToast);
  return useMutation({
    mutationFn: (body: AdminCustomerUpdate) => api<AdminCustomerDetail>(`/admin/users/${id}`, { method: 'PATCH', body }),
    onSuccess: (data) => {
      cache.set(data);
      toast('Gemt');
    },
    onError: (e) => toast(e.message, 'error'),
  });
}

/** Handlinger der sender en mail til kunden. Viser tydeligt, hvis mailen ikke kunne sendes. */
function useMailAction(id: string, path: string) {
  const cache = useCustomerCache(id);
  const toast = useUi((s) => s.showToast);
  return useMutation({
    mutationFn: (body?: unknown) => api<AdminMailResult>(`/admin/users/${id}/${path}`, { method: 'POST', body }),
    onSuccess: (r) => {
      toast(r.message, r.mailSent ? 'ok' : 'error');
      cache.refresh();
    },
    onError: (e) => toast(e.message, 'error'),
  });
}

/* ------------------------------------------------------------------ */

function AccessCard({ c }: { c: AdminCustomerDetail }) {
  const patch = usePatch(c.id);
  const current = c.access.trialEndsAt ? new Date(c.access.trialEndsAt) : null;
  const [value, setValue] = useState(current ? toDateInput(current) : '');
  useEffect(() => setValue(current ? toDateInput(current) : ''), [c.access.trialEndsAt]); // eslint-disable-line react-hooks/exhaustive-deps

  // Forlængelser regnes fra den nuværende slutdato – eller fra i dag, hvis den er passeret.
  const base = Math.max(Date.now(), current?.getTime() ?? 0);
  const extend = (days: number) => setValue(toDateInput(new Date(base + days * DAY)));
  const changed = value !== (current ? toDateInput(current) : '');
  const running = current && current.getTime() > Date.now();
  // Beregnes her: i lanceringsperioden sender serveren ikke "dage tilbage".
  const daysLeft = current ? Math.ceil((current.getTime() - Date.now()) / DAY) : 0;

  const save = (e: FormEvent) => {
    e.preventDefault();
    if (value) patch.mutate({ trialEndsAt: endOfDay(value) });
  };

  return (
    <Section
      icon={<CalendarClock className="size-[18px]" strokeWidth={1.7} />}
      title="Adgang og prøveperiode"
      subtitle={
        c.isAdmin
          ? 'Administratorer har altid fuld adgang.'
          : `${STATUS_LABEL[c.access.status]}${c.access.hasAccess ? ' – har adgang' : ' – ingen adgang'}`
      }
    >
      <Rows
        rows={[
          [
            'Prøveperiode til',
            current
              ? `${fmtDateTime(c.access.trialEndsAt)}${running ? ` (${daysLeft} ${daysLeft === 1 ? 'dag' : 'dage'} tilbage)` : ' (udløbet)'}`
              : 'Ingen',
          ],
          ['Betingelser accepteret', c.termsAcceptedAt ? `${fmtDate(c.termsAcceptedAt)} (version ${c.termsVersion ?? '–'})` : '–'],
        ]}
      />
      <form onSubmit={save} className="mt-4 space-y-3">
        <label className="block text-[13px] text-ink-2" htmlFor="trial-end">
          Ny slutdato for prøveperioden
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <input
            id="trial-end"
            type="date"
            value={value}
            min={toDateInput(new Date())}
            max={toDateInput(new Date(Date.now() + 3 * 365 * DAY))}
            onChange={(e) => setValue(e.target.value)}
            className="h-10 rounded-full bg-raised px-4 text-sm text-ink shadow-pill outline-none focus:ring-2 focus:ring-ink/80"
          />
          <Button
            type="submit"
            tone="dark"
            disabled={!value || !changed}
            loading={patch.isPending && patch.variables?.trialEndsAt !== undefined}
          >
            Gem dato
          </Button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {[
            [14, '+14 dage'],
            [30, '+30 dage'],
            [365, '+1 år'],
          ].map(([days, label]) => (
            <Button key={label} size="sm" onClick={() => extend(days as number)}>
              {label}
            </Button>
          ))}
          {running && (
            <Button
              size="sm"
              tone="ghost"
              disabled={patch.isPending}
              onClick={() => patch.mutate({ trialEndsAt: new Date().toISOString() })}
            >
              Afslut nu
            </Button>
          )}
        </div>
      </form>
      {c.access.status === 'launch' && (
        <p className="mt-4 rounded-2xl bg-black/[0.035] px-3.5 py-2.5 text-[12.5px] text-ink-2">
          Lanceringsperiode: alle har gratis adgang, til betaling åbner. Da får alle mindst 14 dages prøveperiode – en længere dato sat her
          bliver stående.
        </p>
      )}
    </Section>
  );
}

function BillingCard({ c }: { c: AdminCustomerDetail }) {
  const b = c.billing;
  return (
    <Section
      icon={<CreditCard className="size-[18px]" strokeWidth={1.7} />}
      title="Abonnement"
      subtitle="Stripe er kilden – ændringer derfra kommer automatisk hertil."
    >
      {!b.stripeCustomerId && !b.subscriptionId ? (
        <p className="text-[13px] text-muted">Kunden har aldrig tegnet abonnement.</p>
      ) : (
        <Rows
          rows={[
            ['Stripe-status', b.subscriptionStatus ?? '–'],
            ['Tegnet', fmtDate(b.subscriptionStartedAt)],
            [b.cancelAtPeriodEnd ? 'Stopper' : 'Næste træk', fmtDate(b.currentPeriodEnd)],
            ...(b.paymentFailedAt ? ([['Betaling fejlede', fmtDateTime(b.paymentFailedAt)]] as [string, ReactNode][]) : []),
            ...(c.access.withdrawableUntil
              ? ([['Fortrydelsesret til', fmtDate(c.access.withdrawableUntil)]] as [string, ReactNode][])
              : []),
          ]}
        />
      )}
      {b.stripeUrl && (
        <a href={b.stripeUrl} target="_blank" rel="noreferrer" className="mt-4 inline-block">
          <Button size="sm" icon={<ExternalLink className="size-4" />}>
            Åbn i Stripe
          </Button>
        </a>
      )}
    </Section>
  );
}

function ActivityCard({ c }: { c: AdminCustomerDetail }) {
  const stats: [string, number][] = [
    ['Lister', c.counts.lists],
    ['Varer på lister', c.counts.listItems],
    ['Prisalarmer', c.counts.watches],
    ['Kvitteringer', c.counts.receipts],
  ];
  return (
    <Section icon={<UserRound className="size-[18px]" strokeWidth={1.7} />} title="Aktivitet">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {stats.map(([label, n]) => (
          <div key={label} className="rounded-2xl bg-black/[0.035] px-3 py-2.5">
            <p className="text-[24px] leading-none tracking-[-0.03em] text-ink">{int(n)}</p>
            <p className="mt-1 text-[12px] text-muted">{label}</p>
          </div>
        ))}
      </div>
      <Rows
        rows={[
          ['Postnummer', c.zipCode ? `${c.zipCode}${c.radiusKm ? ` · ${c.radiusKm} km` : ''}` : '–'],
          ['Foretrukne kæder', c.preferredStoreIds.length ? c.preferredStoreIds.join(', ') : '–'],
          ['Kunde-id', <span className="font-mono text-[12px]">{c.id}</span>],
        ]}
      />
    </Section>
  );
}

function LoginCard({ c }: { c: AdminCustomerDetail }) {
  const cache = useCustomerCache(c.id);
  const toast = useUi((s) => s.showToast);
  const patch = usePatch(c.id);
  const resend = useMailAction(c.id, 'resend-verification');
  const reset = useMailAction(c.id, 'password-reset');
  const changeEmail = useMailAction(c.id, 'change-email');
  const logout = useMutation({
    mutationFn: () => api<AdminCustomerDetail>(`/admin/users/${c.id}/logout`, { method: 'POST' }),
    onSuccess: (data) => {
      cache.set(data);
      toast('Kunden er logget ud på alle enheder');
    },
    onError: (e) => toast(e.message, 'error'),
  });
  const [editing, setEditing] = useState(false);
  const [newEmail, setNewEmail] = useState('');

  const submitEmail = (e: FormEvent) => {
    e.preventDefault();
    changeEmail.mutate({ email: newEmail }, { onSuccess: () => (setEditing(false), setNewEmail('')) });
  };

  return (
    <Section icon={<Mail className="size-[18px]" strokeWidth={1.7} />} title="E-mail og login">
      <Rows
        rows={[
          ['E-mail', c.email],
          ['Bekræftet', c.emailVerifiedAt ? fmtDateTime(c.emailVerifiedAt) : <span className="text-[#8a4a0b]">Nej</span>],
          ['Aktive sessioner', int(c.counts.activeSessions)],
        ]}
      />

      {!c.emailVerifiedAt && (
        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            size="sm"
            tone="dark"
            icon={<BadgeCheck className="size-4" />}
            loading={patch.isPending}
            onClick={() => patch.mutate({ emailVerified: true })}
          >
            Markér som bekræftet
          </Button>
          <Button size="sm" icon={<Mail className="size-4" />} loading={resend.isPending} onClick={() => resend.mutate(undefined)}>
            Send bekræftelsesmail igen
          </Button>
        </div>
      )}

      <div className="mt-4 space-y-2 border-t border-black/[0.06] pt-4">
        {editing ? (
          <form onSubmit={submitEmail} className="space-y-2">
            <TextInput
              type="email"
              required
              autoFocus
              placeholder="Ny e-mail"
              aria-label="Ny e-mail"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
            />
            <p className="px-1 text-[12px] text-muted">
              Kunden får et link på den nye adresse. E-mailen skiftes først, når linket klikkes.
            </p>
            <div className="flex gap-2">
              <Button type="submit" size="sm" tone="dark" loading={changeEmail.isPending}>
                Send link
              </Button>
              <Button size="sm" tone="ghost" onClick={() => setEditing(false)}>
                Annullér
              </Button>
            </div>
          </form>
        ) : (
          <ActionRow
            title="Skift e-mail"
            text="Fx hvis kunden har mistet adgangen til den gamle."
            action={
              <Button size="sm" onClick={() => setEditing(true)}>
                Skift
              </Button>
            }
          />
        )}
        <ActionRow
          title="Ny adgangskode"
          text="Send et link, så kunden selv vælger en ny. Du ser aldrig adgangskoden."
          action={
            <Button size="sm" icon={<KeyRound className="size-4" />} loading={reset.isPending} onClick={() => reset.mutate(undefined)}>
              Send link
            </Button>
          }
        />
        <ActionRow
          title="Log ud overalt"
          text="Afslutter alle sessioner. Kunden logges helt ud inden for 15 minutter."
          action={
            <Button
              size="sm"
              icon={<LogOut className="size-4" />}
              loading={logout.isPending}
              disabled={!c.counts.activeSessions}
              onClick={() => logout.mutate()}
            >
              Log ud
            </Button>
          }
        />
      </div>
    </Section>
  );
}

function ActionRow({ title, text, action }: { title: string; text: string; action: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-1">
      <div className="min-w-0">
        <p className="text-[13.5px] text-ink">{title}</p>
        <p className="text-[12px] text-muted">{text}</p>
      </div>
      {action}
    </div>
  );
}

function eventDetail(e: AdminCustomerEvent): string | null {
  const d = e.details as { from?: string | null; to?: string; mailSent?: boolean };
  const parts: string[] = [];
  if (e.action === 'trial_changed') parts.push(`${d.from ? fmtDate(d.from) : 'ingen'} → ${d.to ? fmtDate(d.to) : 'ingen'}`);
  if (e.action === 'email_change_sent') parts.push(`${d.from ?? ''} → ${d.to ?? ''}`);
  if (d.mailSent === false) parts.push('mailen blev ikke sendt');
  return parts.length ? parts.join(' · ') : null;
}

function HistoryCard({ events }: { events: AdminCustomerEvent[] }) {
  return (
    <Section
      icon={<History className="size-[18px]" strokeWidth={1.7} />}
      title="Historik"
      subtitle="Hvad administratorer har gjort ved kontoen."
    >
      {!events.length ? (
        <p className="text-[13px] text-muted">Ingen ændringer endnu.</p>
      ) : (
        <ol className="space-y-3">
          {events.map((e) => {
            const detail = eventDetail(e);
            return (
              <li key={e.id} className="text-[13px]">
                <p className="text-ink">{ACTION_LABEL[e.action] ?? e.action}</p>
                {detail && <p className="break-all text-ink-2">{detail}</p>}
                <p className="text-[12px] text-muted">
                  {fmtDateTime(e.createdAt)}
                  {e.adminEmail ? ` · ${e.adminEmail}` : ''}
                </p>
              </li>
            );
          })}
        </ol>
      )}
    </Section>
  );
}

function DeleteCard({ c }: { c: AdminCustomerDetail }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useUi((s) => s.showToast);
  const [confirm, setConfirm] = useState('');
  const remove = useMutation({
    mutationFn: () => api(`/admin/users/${c.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.removeQueries({ queryKey: ['admin-customer', c.id] });
      void qc.invalidateQueries({ queryKey: ['admin-customers'] });
      void qc.invalidateQueries({ queryKey: ['admin-overview'] });
      toast(`${c.email} er slettet`);
      navigate('/kunder', { replace: true });
    },
    onError: (e) => toast(e.message, 'error'),
  });
  const blocked = c.isSelf
    ? 'Din egen konto sletter du under Konto på hjemmesiden.'
    : c.isAdmin
      ? 'Administratorer styres af ADMIN_EMAILS – fjern e-mailen derfra først.'
      : null;

  return (
    <Section
      icon={<Trash2 className="size-[18px]" strokeWidth={1.7} />}
      title="Slet konto"
      subtitle="Fx efter en henvendelse om sletning (GDPR)."
    >
      {blocked ? (
        <p className="text-[13px] text-muted">{blocked}</p>
      ) : (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            remove.mutate();
          }}
        >
          <p className="text-[13px] text-ink-2">
            Lister, alarmer, kvitteringer og historik slettes med det samme og kan ikke gendannes.
            {c.access.subscribed && ' Det løbende abonnement opsiges i Stripe først.'}
          </p>
          <TextInput
            placeholder={c.email}
            aria-label="Skriv kundens e-mail for at bekræfte"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
          <Button
            type="submit"
            tone="danger"
            icon={<Trash2 className="size-4" />}
            disabled={confirm.trim().toLowerCase() !== c.email}
            loading={remove.isPending}
          >
            Slet konto permanent
          </Button>
          <p className="text-[12px] text-muted">Skriv kundens e-mail ovenfor for at bekræfte.</p>
        </form>
      )}
    </Section>
  );
}
