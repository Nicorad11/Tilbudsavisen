import type { AdminDay, AdminOverviewDTO } from '@tilbudsradar/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ArrowRight, Check, ExternalLink, Gauge, Radar, ShieldAlert } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Card, Pill, Segmented, Skeleton } from '../../components/ui/primitives';
import { api } from '../../lib/api';
import { int, relativeTime } from '../../lib/format';
import { STATUS_LABEL } from '../labels';
import { BarList, ChartCard, DayBars, ListCard, longDay, parseDay, Stat } from '../parts';

const PERIODS = [
  { value: 7, label: '7 dage' },
  { value: 30, label: '30 dage' },
  { value: 90, label: '90 dage' },
];

const dateTime = new Intl.DateTimeFormat('da-DK', { day: 'numeric', month: 'short', year: 'numeric' });
const percent = (n: number, of: number) => (of ? `${Math.round((n / of) * 1000) / 10} %` : '–');

/** Overblik for administratoren: brugere, besøg og drift. */
export function Overview() {
  const [days, setDays] = useState(30);
  const overview = useQuery({
    queryKey: ['admin-overview', days],
    queryFn: () => api<AdminOverviewDTO>(`/admin/overview?days=${days}`),
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
  });

  const o = overview.data;
  return (
    <div className="space-y-6 pb-10">
      <div className="flex flex-wrap items-end justify-between gap-4 pt-2">
        <div>
          <p className="text-sm text-muted">Brugere, besøg og drift</p>
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

function UsersTable({ overview }: { overview: AdminOverviewDTO }) {
  const navigate = useNavigate();
  const rows = overview.latestUsers.slice(0, 10);
  return (
    <Card className="p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-lg tracking-tight text-ink">Seneste kunder</p>
          <p className="text-[12.5px] text-muted">De 10 nyeste konti. Klik for at se og redigere.</p>
        </div>
        <Link to="/kunder" className="inline-flex items-center gap-1.5 text-[13px] text-ink underline underline-offset-2">
          Alle kunder <ArrowRight className="size-3.5" />
        </Link>
      </div>
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
                <tr
                  key={u.id}
                  className="cursor-pointer border-t border-black/[0.06] text-ink-2 hover:bg-black/[0.025]"
                  onClick={() => navigate(`/kunder/${u.id}`)}
                >
                  <td className="max-w-[260px] truncate px-1 py-2 text-ink" title={u.email}>
                    <Link to={`/kunder/${u.id}`} className="hover:underline" onClick={(e) => e.stopPropagation()}>
                      {u.email}
                    </Link>
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
        <Link to="/kilder" className="inline-flex items-center gap-1.5 text-[13px] text-ink underline underline-offset-2">
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
