import type { AccessStatus, AdminCount, AdminDay, AdminOverviewDTO } from '@tilbudsradar/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { Check, ExternalLink, Gauge, Radar, ShieldAlert } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { Card, EmptyState, Pill, Segmented, Skeleton } from '../components/ui/primitives';
import { useAccess } from '../lib/access';
import { api } from '../lib/api';
import { int, relativeTime } from '../lib/format';

const PERIODS = [
  { value: 7, label: '7 dage' },
  { value: 30, label: '30 dage' },
  { value: 90, label: '90 dage' },
];

const STATUS_LABEL: Record<AccessStatus, string> = {
  launch: 'Gratis (lancering)',
  trial: 'Prøveperiode',
  active: 'Abonnement',
  past_due: 'Betaling fejlet',
  canceled: 'Opsagt',
  expired: 'Udløbet',
  free: 'Gæst',
};

const dayLabel = new Intl.DateTimeFormat('da-DK', { day: 'numeric', month: 'short' });
const longDay = new Intl.DateTimeFormat('da-DK', { weekday: 'long', day: 'numeric', month: 'long' });
const dateTime = new Intl.DateTimeFormat('da-DK', { day: 'numeric', month: 'short', year: 'numeric' });
/** "2026-10-17" → dato uden tidszone-forskydning. */
const parseDay = (day: string) => new Date(`${day}T12:00:00`);
const percent = (n: number, of: number) => (of ? `${Math.round((n / of) * 1000) / 10} %` : '–');

/** Overblik for administratoren: brugere, besøg og drift. */
export function Admin() {
  const { access } = useAccess();
  const [days, setDays] = useState(30);
  const overview = useQuery({
    queryKey: ['admin-overview', days],
    queryFn: () => api<AdminOverviewDTO>(`/admin/overview?days=${days}`),
    enabled: access.isAdmin,
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
  });

  if (!access.isAdmin) {
    return (
      <EmptyState className="pt-16" icon={<ShieldAlert className="size-6" />} title="Kun for administratorer">
        Log ind med en e-mail fra ADMIN_EMAILS for at se overblikket.
      </EmptyState>
    );
  }

  const o = overview.data;
  return (
    <div className="space-y-6 pb-10">
      <div className="flex flex-wrap items-end justify-between gap-4 pt-2">
        <div>
          <p className="text-sm text-muted">Kun for administratorer</p>
          <h1 className="mt-1 text-[40px] leading-[1.04] tracking-[-0.045em] text-ink sm:text-[52px]">Overblik</h1>
          {o && (
            <p className="mt-2 flex flex-wrap items-center gap-2 text-[13px] text-muted">
              <Pill tone={o.billingEnabled ? 'lime' : 'white'}>{o.billingEnabled ? 'Betaling er åben' : 'Lanceringsperiode – alt er gratis'}</Pill>
              Opdateres hvert minut · hentet {relativeTime(o.generatedAt)}
            </p>
          )}
        </div>
        <Segmented value={days} options={PERIODS} onChange={setDays} />
      </div>

      {!o ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
      ) : (
        <>
          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-label="Nøgletal">
            <Stat label="Brugere i alt" value={o.users.total} note={`+${int(o.users.newInPeriod)} de sidste ${o.days} dage`} />
            <Stat label="Nye konti i dag" value={o.users.newToday} note={`${int(o.users.verified)} har bekræftet e-mail i alt`} />
            <Stat label="Aktive brugere (7 dage)" value={o.users.active7d} note={`${int(o.users.active1d)} i dag · ${int(o.users.active30d)} på 30 dage`} />
            <Stat label="Besøgende i dag" value={o.traffic.visitorsToday} note={`${int(o.traffic.pageviewsToday)} sidevisninger i dag`} />
            <Stat label={`Besøg (${o.days} dage)`} value={o.traffic.visitsInPeriod} note={`${int(o.traffic.pageviewsInPeriod)} sidevisninger`} />
            <Stat
              label="Besøg der blev til en konto"
              value={percent(o.users.newInPeriod, o.traffic.visitsInPeriod)}
              note={`${int(o.users.newInPeriod)} nye konti ud af ${int(o.traffic.visitsInPeriod)} besøg`}
            />
          </section>

          <section className="grid gap-3 lg:grid-cols-2">
            <ChartCard title="Besøgende pr. dag" subtitle="Unikke besøgende hver dag – administratorer tælles ikke med">
              <DayBars data={o.byDay} value={(d) => d.visitors} unit={() => 'besøgende'} />
            </ChartCard>
            <ChartCard title="Nye konti pr. dag" subtitle="Oprettede konti (ikke gæster)">
              <DayBars data={o.byDay} value={(d) => d.signups} unit={(n) => (n === 1 ? 'ny konto' : 'nye konti')} />
            </ChartCard>
          </section>
          <DayTable data={o.byDay} />

          <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <ListCard title="Populære sider">
              <BarList rows={o.traffic.topPages.map((p) => ({ label: p.path, count: p.pageviews }))} empty="Ingen sidevisninger endnu" />
            </ListCard>
            <ListCard title="Hvor kommer de fra" subtitle="Første side i hvert besøg">
              <BarList rows={o.traffic.sources} empty="Ingen besøg endnu" />
            </ListCard>
            <ListCard title="Enheder" subtitle="Besøg pr. enhed">
              <BarList rows={o.traffic.devices.map((d) => ({ ...d, label: d.label[0]!.toUpperCase() + d.label.slice(1) }))} empty="Ingen besøg endnu" />
            </ListCard>
            <ListCard title="Brugere efter status">
              <BarList rows={o.users.byStatus} empty="Ingen brugere endnu" />
            </ListCard>
          </section>

          <UsersTable overview={o} />
          <SiteCard overview={o} />
        </>
      )}
    </div>
  );
}

function Stat({ label, value, note }: { label: string; value: number | string; note: string }) {
  return (
    <Card className="p-5">
      <p className="text-[13px] text-muted">{label}</p>
      {/* Store tal uden tabular-nums – de står alene og skal ikke flugte. */}
      <p className="mt-2 text-[40px] leading-none tracking-[-0.045em] text-ink">{typeof value === 'number' ? int(value) : value}</p>
      <p className="mt-2 text-[12.5px] text-muted">{note}</p>
    </Card>
  );
}

function ChartCard({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <Card className="p-5 sm:p-6">
      <p className="text-lg tracking-tight text-ink">{title}</p>
      <p className="text-[12.5px] text-muted">{subtitle}</p>
      <div className="mt-5">{children}</div>
    </Card>
  );
}

/**
 * Søjler pr. dag: én serie, én farve, afrundede ender mod grundlinjen og 2 px
 * mellemrum. Hele kolonnens højde er hover-mål, og tooltip viser dato og tal.
 */
function DayBars({ data, value, unit }: { data: AdminDay[]; value: (d: AdminDay) => number; unit: (n: number) => string }) {
  const [active, setActive] = useState<number | null>(null);
  const values = data.map(value);
  const max = Math.max(...values, 0);
  const top = Math.max(1, max);
  const shown = active ?? null;

  return (
    <div className="relative">
      <div className="mb-1 flex items-baseline justify-between text-[11.5px] text-muted">
        <span>{max > 0 ? `Højeste: ${int(max)}` : 'Ingen data i perioden'}</span>
        <span>I alt: {int(values.reduce((a, b) => a + b, 0))}</span>
      </div>
      <div
        className={clsx('relative flex h-40 items-end border-b border-black/[0.12]', data.length > 31 ? 'gap-px' : 'gap-[2px]')}
        onMouseLeave={() => setActive(null)}
      >
        {data.map((d, i) => {
          const v = values[i]!;
          return (
            <button
              key={d.day}
              type="button"
              className="flex h-full min-w-0 flex-1 items-end focus:outline-none"
              aria-label={`${longDay.format(parseDay(d.day))}: ${int(v)} ${unit(v)}`}
              onMouseEnter={() => setActive(i)}
              onFocus={() => setActive(i)}
              onClick={() => setActive(active === i ? null : i)}
            >
              <span
                className={clsx('block w-full rounded-t-[4px] transition-colors', shown === i ? 'bg-ink' : 'bg-ink/70')}
                style={{ height: v > 0 ? `max(${(v / top) * 100}%, 3px)` : 0 }}
              />
            </button>
          );
        })}
        {shown !== null && (
          <div
            className="pointer-events-none absolute -top-2 z-10 -translate-x-1/2 -translate-y-full rounded-xl bg-ink px-3 py-2 text-[12px] whitespace-nowrap text-white shadow-lg"
            style={{ left: `${((shown + 0.5) / data.length) * 100}%` }}
          >
            <span className="block text-white/70">{longDay.format(parseDay(data[shown]!.day))}</span>
            <span className="font-medium">
              {int(values[shown]!)} {unit(values[shown]!)}
            </span>
          </div>
        )}
      </div>
      <div className="mt-1.5 flex justify-between text-[11.5px] text-muted">
        <span>{data[0] ? dayLabel.format(parseDay(data[0].day)) : ''}</span>
        <span>I dag</span>
      </div>
    </div>
  );
}

/** Tabelvisning af graferne – så tallene kan læses uden hover. */
function DayTable({ data }: { data: AdminDay[] }) {
  return (
    <details className="rounded-[22px] bg-surface-2 px-5 py-3 text-[13px] text-ink-2 shadow-soft">
      <summary className="cursor-pointer text-ink">Se tallene pr. dag som tabel</summary>
      <div className="mt-3 max-h-80 overflow-auto">
        <table className="w-full text-left">
          <thead className="sticky top-0 bg-surface-2 text-muted">
            <tr>
              <th className="py-1.5 font-normal">Dag</th>
              <th className="py-1.5 text-right font-normal">Besøgende</th>
              <th className="py-1.5 text-right font-normal">Sidevisninger</th>
              <th className="py-1.5 text-right font-normal">Nye konti</th>
            </tr>
          </thead>
          <tbody className="tabular">
            {[...data].reverse().map((d) => (
              <tr key={d.day} className="border-t border-black/[0.06]">
                <td className="py-1.5">{longDay.format(parseDay(d.day))}</td>
                <td className="py-1.5 text-right">{int(d.visitors)}</td>
                <td className="py-1.5 text-right">{int(d.pageviews)}</td>
                <td className="py-1.5 text-right">{int(d.signups)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

function ListCard({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <Card className="p-5">
      <p className="text-[17px] tracking-tight text-ink">{title}</p>
      {subtitle && <p className="text-[12px] text-muted">{subtitle}</p>}
      <div className="mt-4">{children}</div>
    </Card>
  );
}

/** Vandrette søjler i én farve: navn og tal i tekstfarver, søjlen bærer størrelsen. */
function BarList({ rows, empty }: { rows: AdminCount[]; empty: string }) {
  if (!rows.length) return <p className="text-[13px] text-muted">{empty}</p>;
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <ul className="space-y-2.5">
      {rows.slice(0, 8).map((r) => (
        <li key={r.label} className="text-[13px]">
          <div className="flex items-baseline justify-between gap-3">
            <span className="min-w-0 truncate text-ink-2" title={r.label}>
              {r.label}
            </span>
            <span className="tabular shrink-0 text-ink">{int(r.count)}</span>
          </div>
          <div className="mt-1 h-1.5 rounded-full bg-black/[0.06]">
            <div className="h-full rounded-full bg-ink/70" style={{ width: `${(r.count / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

function UsersTable({ overview }: { overview: AdminOverviewDTO }) {
  const rows = overview.latestUsers;
  return (
    <Card className="p-5 sm:p-6">
      <p className="text-lg tracking-tight text-ink">Seneste brugere</p>
      <p className="text-[12.5px] text-muted">De 50 nyeste konti. Gæster vises ikke.</p>
      {!rows.length ? (
        <p className="mt-4 text-[13px] text-muted">Ingen konti endnu.</p>
      ) : (
        <div className="mt-4 -mx-1 overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-[13px]">
            <thead className="text-muted">
              <tr>
                <th className="px-1 py-2 font-normal">E-mail</th>
                <th className="px-1 py-2 font-normal">Oprettet</th>
                <th className="px-1 py-2 font-normal">Sidst aktiv</th>
                <th className="px-1 py-2 font-normal">Status</th>
                <th className="px-1 py-2 text-center font-normal">Bekræftet</th>
                <th className="px-1 py-2 text-right font-normal">Lister</th>
                <th className="px-1 py-2 text-right font-normal">Alarmer</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((u) => (
                <tr key={u.id} className="border-t border-black/[0.06] text-ink-2">
                  <td className="max-w-[260px] truncate px-1 py-2 text-ink" title={u.email}>
                    {u.email}
                  </td>
                  <td className="px-1 py-2 whitespace-nowrap">{dateTime.format(new Date(u.createdAt))}</td>
                  <td className="px-1 py-2 whitespace-nowrap">{relativeTime(u.lastSeenAt)}</td>
                  <td className="px-1 py-2 whitespace-nowrap">{u.isAdmin ? 'Administrator' : STATUS_LABEL[u.status]}</td>
                  <td className="px-1 py-2 text-center">
                    {u.emailVerified ? <Check className="mx-auto size-4" aria-label="Ja" /> : <span className="text-muted">Nej</span>}
                  </td>
                  <td className="tabular px-1 py-2 text-right">{int(u.lists)}</td>
                  <td className="tabular px-1 py-2 text-right">{int(u.watches)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function SiteCard({ overview }: { overview: AdminOverviewDTO }) {
  const { site } = overview;
  const failing = site.sources.filter((s) => s.enabled && (s.status === 'failed' || s.failures > 0));
  return (
    <Card className="p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-lg tracking-tight text-ink">Drift</p>
          <p className="text-[12.5px] text-muted">
            {int(site.totalOffers)} aktive tilbud · seneste scraping {relativeTime(site.lastScrapeAt)}
          </p>
        </div>
        <Link to="/app/kilder" className="inline-flex items-center gap-1.5 text-[13px] text-ink underline underline-offset-2">
          <Radar className="size-4" strokeWidth={1.6} /> Kilder
        </Link>
      </div>
      <ul className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {site.sources.map((s) => {
          const ok = s.status === 'success' && s.failures === 0;
          return (
            <li key={s.id} className="flex items-center justify-between gap-3 rounded-2xl bg-black/[0.035] px-3 py-2 text-[13px]">
              <span className="min-w-0 truncate text-ink">{s.name}</span>
              <span className="shrink-0 text-muted">
                {!s.enabled ? 'Slået fra' : ok ? `OK · ${relativeTime(s.lastRunAt)}` : s.status ? `Fejl (${s.failures})` : 'Ikke kørt'}
              </span>
            </li>
          );
        })}
      </ul>
      {failing.length > 0 && (
        <p className="mt-3 text-[13px] text-bad">
          {failing.length} kilde{failing.length === 1 ? '' : 'r'} fejlede ved seneste kørsel – se Kilder.
        </p>
      )}
      <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-[13px] text-ink-2">
        <a href="https://dashboard.render.com" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 hover:text-ink">
          <Gauge className="size-4" strokeWidth={1.6} /> Server og logs (Render) <ExternalLink className="size-3" />
        </a>
        <a href="https://sentry.io" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 hover:text-ink">
          <ShieldAlert className="size-4" strokeWidth={1.6} /> Fejl (Sentry) <ExternalLink className="size-3" />
        </a>
      </div>
    </Card>
  );
}
