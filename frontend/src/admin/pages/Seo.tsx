import type {
  GscCountry,
  GscDay,
  GscDevice,
  GscIndexingDTO,
  GscInspectionRow,
  GscOpportunitiesDTO,
  GscOverviewDTO,
  GscSetupStatus,
  GscSitemapsDTO,
  GscTotals,
} from '@tilbudsradar/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowDownRight, ArrowUpRight, Minus, RefreshCw, ScanSearch, SearchCheck } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Button, Card, EmptyState, Pill, Segmented, Skeleton, TextInput } from '../../components/ui/primitives';
import { api, ApiError } from '../../lib/api';
import { int, relativeTime } from '../../lib/format';
import { useUi } from '../../lib/store';
import { ChartCard, DayBars, longDay, parseDay, Stat } from '../parts';

/* Google Search Console: søgedata, muligheder, indeksering og sitemaps (backend/src/services/searchConsole). */

type Days = 7 | 28 | 90;
type Tab = 'queries' | 'pages' | 'opportunities' | 'indexing' | 'sitemaps' | 'discover';

const PERIODS: { value: Days; label: string }[] = [
  { value: 7, label: '7 dage' },
  { value: 28, label: '28 dage' },
  { value: 90, label: '90 dage' },
];
const COUNTRIES: { value: GscCountry; label: string }[] = [
  { value: 'all', label: 'Alle lande' },
  { value: 'dnk', label: 'Danmark' },
];
const DEVICES: { value: GscDevice; label: string }[] = [
  { value: 'all', label: 'Alle enheder' },
  { value: 'MOBILE', label: 'Mobil' },
  { value: 'DESKTOP', label: 'Computer' },
  { value: 'TABLET', label: 'Tablet' },
];
const TABS: { value: Tab; label: string }[] = [
  { value: 'queries', label: 'Søgeord' },
  { value: 'pages', label: 'Sider' },
  { value: 'opportunities', label: 'Muligheder' },
  { value: 'indexing', label: 'Indeksering' },
  { value: 'sitemaps', label: 'Sitemaps' },
  { value: 'discover', label: 'Discover og billeder' },
];

const RUN_LABEL: Record<string, string> = { running: 'Henter …', success: 'OK', partial: 'Delvist', failed: 'Fejlede' };
const dateTime = new Intl.DateTimeFormat('da-DK', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const shortDay = new Intl.DateTimeFormat('da-DK', { day: 'numeric', month: 'short' });

const ctrText = (ctr: number) => `${(ctr * 100).toLocaleString('da-DK', { maximumFractionDigits: 1 })} %`;
const posText = (p: number) => (p > 0 ? p.toLocaleString('da-DK', { maximumFractionDigits: 1 }) : '–');
const pathOf = (url: string) => {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
};
const fmtDay = (d: string) => shortDay.format(parseDay(d));

export function Seo() {
  const [days, setDays] = useState<Days>(28);
  const [country, setCountry] = useState<GscCountry>('all');
  const [device, setDevice] = useState<GscDevice>('all');
  const [tab, setTab] = useState<Tab>('queries');
  const overview = useQuery({
    queryKey: ['admin-seo', 'overview', days, country, device],
    queryFn: () => api<GscOverviewDTO>(`/admin/seo/overview?days=${days}&country=${country}&device=${device}`),
    placeholderData: keepPreviousData,
    // Mens data hentes, opdateres siden af sig selv.
    refetchInterval: (q) => (q.state.data?.running ? 3000 : false),
  });
  const o = overview.data;

  return (
    <div className="space-y-6 pb-10">
      <div className="flex flex-wrap items-end justify-between gap-4 pt-2">
        <div>
          <p className="text-sm text-muted">Google Search Console</p>
          <h1 className="mt-1 text-[40px] leading-[1.04] tracking-[-0.045em] text-ink sm:text-[52px]">SEO</h1>
          {o && <StatusLine overview={o} />}
        </div>
        {o?.setup.configured && <Actions running={o.running} />}
      </div>

      {!o ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
      ) : !o.setup.configured ? (
        <SetupGuide setup={o.setup} />
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            <Segmented value={days} options={PERIODS} onChange={setDays} />
            <Segmented value={country} options={COUNTRIES} onChange={setCountry} />
            <Segmented value={device} options={DEVICES} onChange={setDevice} />
          </div>
          {!o.period ? (
            <Card>
              <EmptyState icon={<SearchCheck className="size-6" />} title="Ingen data endnu">
                Search Console har endnu ingen tal for sitet – eller data er ikke hentet. Tryk "Hent data nu". Nye sider får typisk de første
                tal efter et par dage.
              </EmptyState>
            </Card>
          ) : (
            <Dashboard overview={o} />
          )}
          <Segmented value={tab} options={TABS} onChange={setTab} className="max-w-full overflow-x-auto" />
          {tab === 'queries' && <QueriesTab overview={o} />}
          {tab === 'pages' && <PagesTab overview={o} />}
          {tab === 'opportunities' && <OpportunitiesTab country={country} />}
          {tab === 'indexing' && <IndexingTab />}
          {tab === 'sitemaps' && <SitemapsTab />}
          {tab === 'discover' && <DiscoverTab overview={o} />}
        </>
      )}
    </div>
  );
}

/* ---------------- Status og knapper ---------------- */

function StatusLine({ overview: o }: { overview: GscOverviewDTO }) {
  const run = o.lastRun;
  return (
    <div className="mt-2 space-y-1 text-[13px] text-muted">
      <p className="flex flex-wrap items-center gap-2">
        <Pill tone={!o.setup.configured ? 'warn' : o.running ? 'lime' : run?.status === 'failed' ? 'bad' : run?.status === 'partial' ? 'warn' : 'ok'}>
          {!o.setup.configured ? 'Ikke sat op' : o.running ? 'Henter data …' : run ? RUN_LABEL[run.status] : 'Ikke hentet endnu'}
        </Pill>
        {run && (
          <span>
            Sidst hentet {relativeTime(run.finishedAt ?? run.startedAt)} ({run.trigger === 'cron' ? 'automatisk' : 'manuelt'}) · {int(run.rows)} rækker ·{' '}
            {int(run.inspected)} URL'er inspiceret
          </span>
        )}
        {o.period && <span>· Endelige tal til og med {fmtDay(o.period.end)}</span>}
      </p>
      {run?.error && (
        <p className="flex items-start gap-1.5 text-[#8f2a1d]">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> {run.error}
        </p>
      )}
    </div>
  );
}

function Actions({ running }: { running: boolean }) {
  const qc = useQueryClient();
  const toast = useUi((s) => s.showToast);
  const [open, setOpen] = useState(false);
  const sync = useMutation({
    mutationFn: () => api('/admin/seo/sync', { method: 'POST' }),
    onSuccess: () => {
      toast('Henter data fra Search Console …');
      void qc.invalidateQueries({ queryKey: ['admin-seo'] });
    },
    onError: (err) => toast(err instanceof ApiError ? err.message : 'Kunne ikke starte hentningen', 'error'),
  });
  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap gap-2">
        <Button icon={<ScanSearch className="size-4" />} onClick={() => setOpen((v) => !v)}>
          Inspicér URL
        </Button>
        <Button tone="dark" icon={<RefreshCw className="size-4" />} loading={sync.isPending || running} onClick={() => sync.mutate()}>
          Hent data nu
        </Button>
      </div>
      {open && <InspectForm />}
    </div>
  );
}

function InspectForm() {
  const qc = useQueryClient();
  const [url, setUrl] = useState('');
  const inspect = useMutation({
    mutationFn: (u: string) => api<GscInspectionRow>('/admin/seo/inspect', { method: 'POST', body: { url: u } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin-seo', 'indexing'] }),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    inspect.mutate(url);
  };
  return (
    <Card className="w-full max-w-[460px] p-4">
      <form className="flex gap-2" onSubmit={submit}>
        <TextInput placeholder="/tilbud/smoer eller hele adressen" aria-label="Adresse" value={url} onChange={(e) => setUrl(e.target.value)} required />
        <Button type="submit" tone="dark" loading={inspect.isPending}>
          Inspicér
        </Button>
      </form>
      {inspect.error && <p className="mt-2 text-[13px] text-bad">{inspect.error instanceof ApiError ? inspect.error.message : 'Noget gik galt'}</p>}
      {inspect.data && <InspectionResult row={inspect.data} />}
    </Card>
  );
}

function InspectionResult({ row }: { row: GscInspectionRow }) {
  return (
    <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12.5px]">
      <dt className="text-muted">Side</dt>
      <dd className="truncate text-ink">{row.path}</dd>
      <dt className="text-muted">Status</dt>
      <dd className="text-ink">{row.error ?? row.coverageState ?? row.verdict ?? '–'}</dd>
      <dt className="text-muted">Senest crawlet</dt>
      <dd>{row.lastCrawlTime ? dateTime.format(new Date(row.lastCrawlTime)) : 'aldrig'}</dd>
      {row.crawledAs && (
        <>
          <dt className="text-muted">Crawlet som</dt>
          <dd>{row.crawledAs === 'MOBILE' ? 'Mobil' : 'Computer'}</dd>
        </>
      )}
      {row.problems.length > 0 && (
        <>
          <dt className="text-muted">Problemer</dt>
          <dd className="flex flex-wrap gap-1">
            {row.problems.map((p) => (
              <Pill key={p.code} tone="warn" icon={<AlertTriangle className="size-3" />}>
                {p.label}
              </Pill>
            ))}
          </dd>
        </>
      )}
    </dl>
  );
}

/* ---------------- Ikke sat op ---------------- */

function SetupGuide({ setup }: { setup: GscSetupStatus }) {
  return (
    <Card className="space-y-4 p-6 sm:p-7">
      <div>
        <p className="text-lg tracking-tight text-ink">Search Console er ikke sat op</p>
        {setup.reason && <p className="mt-1 text-[13.5px] text-[#8a4a0b]">{setup.reason}</p>}
      </div>
      <ol className="list-decimal space-y-2 pl-5 text-[14px] text-ink-2">
        <li>Opret et projekt i Google Cloud Console, og slå "Google Search Console API" til.</li>
        <li>Opret en service account under IAM → Service accounts, og hent en JSON-nøgle.</li>
        <li>
          I Search Console: Indstillinger → Brugere og tilladelser → Tilføj bruger med service-accountens e-mail og adgangen "Begrænset".
          {setup.clientEmail && (
            <>
              {' '}
              E-mailen er <code className="rounded bg-black/[0.05] px-1.5 py-0.5 text-[12.5px] text-ink">{setup.clientEmail}</code>.
            </>
          )}
        </li>
        <li>
          Sæt i Render → Environment: <code className="text-[12.5px]">GSC_SERVICE_ACCOUNT_JSON</code> (nøglen base64-kodet) og{' '}
          <code className="text-[12.5px]">GSC_SITE_URL</code> = <code className="text-[12.5px]">sc-domain:tilbudsradaren.dk</code>.
        </li>
        <li>Når servicen er genstartet, henter den data hver morgen – eller tryk "Hent data nu" her.</li>
      </ol>
      <p className="text-[12.5px] text-muted">Hele vejledningen står i docs/SEARCH_CONSOLE.md i repoet.</p>
    </Card>
  );
}

/* ---------------- KPI'er og grafer ---------------- */

/** Ændring mod forrige periode – pil og tekst, ikke kun farve. `lowerIsBetter` for placering. */
function Change({ current, previous, kind, lowerIsBetter }: { current: number; previous: number; kind: 'relative' | 'points' | 'position'; lowerIsBetter?: boolean }) {
  if (!previous && kind !== 'position') return <span className="text-[11.5px] text-faint">ingen før</span>;
  if (kind === 'position' && (!previous || !current)) return <span className="text-[11.5px] text-faint">–</span>;
  const diff = kind === 'relative' ? (current - previous) / previous : current - previous;
  const threshold = kind === 'relative' ? 0.005 : kind === 'points' ? 0.0005 : 0.05;
  const better = lowerIsBetter ? diff < 0 : diff > 0;
  const flat = Math.abs(diff) < threshold;
  const text =
    kind === 'relative'
      ? `${diff > 0 ? '+' : ''}${(diff * 100).toLocaleString('da-DK', { maximumFractionDigits: 0 })} %`
      : kind === 'points'
        ? `${diff > 0 ? '+' : ''}${(diff * 100).toLocaleString('da-DK', { maximumFractionDigits: 1 })} pp`
        : `${diff > 0 ? '+' : ''}${diff.toLocaleString('da-DK', { maximumFractionDigits: 1 })}`;
  const Icon = flat ? Minus : diff > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <Pill tone={flat ? 'ghost' : better ? 'ok' : 'bad'} icon={<Icon className="size-3" />} title="Mod forrige periode">
      {flat ? 'uændret' : text}
    </Pill>
  );
}

function Dashboard({ overview: o }: { overview: GscOverviewDTO }) {
  const cur = o.current!;
  const prev = o.previous!;
  const period = `${fmtDay(o.period!.start)}–${fmtDay(o.period!.end)}`;
  return (
    <>
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Nøgletal">
        <Stat label="Klik" value={cur.clicks} note={`${period} · før: ${int(prev.clicks)}`} change={<Change current={cur.clicks} previous={prev.clicks} kind="relative" />} />
        <Stat
          label="Visninger"
          value={cur.impressions}
          note={`${period} · før: ${int(prev.impressions)}`}
          change={<Change current={cur.impressions} previous={prev.impressions} kind="relative" />}
        />
        <Stat label="Klikrate (CTR)" value={ctrText(cur.ctr)} note={`før: ${ctrText(prev.ctr)}`} change={<Change current={cur.ctr} previous={prev.ctr} kind="points" />} />
        <Stat
          label="Gns. placering"
          value={posText(cur.position)}
          note={`før: ${posText(prev.position)} · lavere er bedre`}
          change={<Change current={cur.position} previous={prev.position} kind="position" lowerIsBetter />}
        />
      </section>

      <section className="grid gap-3 lg:grid-cols-2">
        <ChartCard title="Klik pr. dag" subtitle="Fra Googles søgeresultater (web), endelige tal">
          <DayBars data={o.byDay} value={(d) => d.clicks} unit={() => 'klik'} endLabel={fmtDay(o.period!.end)} />
        </ChartCard>
        <ChartCard title="Visninger pr. dag" subtitle="Hvor ofte en af vores sider blev vist i søgeresultaterne">
          <DayBars data={o.byDay} value={(d) => d.impressions} unit={(n) => (n === 1 ? 'visning' : 'visninger')} endLabel={fmtDay(o.period!.end)} />
        </ChartCard>
      </section>

      {o.fresh.length > 0 && (
        <p className="rounded-2xl bg-black/[0.035] px-4 py-2.5 text-[12.5px] text-ink-2">
          <span className="text-ink">Foreløbige tal</span> (kan stadig ændre sig):{' '}
          {o.fresh.map((d) => `${fmtDay(d.day)}: ${int(d.clicks)} klik, ${int(d.impressions)} visninger`).join(' · ')}
        </p>
      )}
      <DayTable data={o.byDay} />
    </>
  );
}

/** Tabelvisning af graferne – også CTR og placering pr. dag. */
function DayTable({ data }: { data: GscDay[] }) {
  return (
    <details className="rounded-[22px] bg-surface-2 px-5 py-3 text-[13px] text-ink-2 shadow-soft">
      <summary className="cursor-pointer text-ink">Se tallene pr. dag som tabel</summary>
      <div className="mt-3 max-h-80 overflow-auto">
        <table className="w-full text-left">
          <thead className="sticky top-0 bg-surface-2 text-muted">
            <tr>
              <th className="py-1.5 font-normal">Dag</th>
              <th className="py-1.5 text-right font-normal">Klik</th>
              <th className="py-1.5 text-right font-normal">Visninger</th>
              <th className="py-1.5 text-right font-normal">CTR</th>
              <th className="py-1.5 text-right font-normal">Placering</th>
            </tr>
          </thead>
          <tbody className="tabular">
            {[...data].reverse().map((d) => (
              <tr key={d.day} className="border-t border-black/[0.06]">
                <td className="py-1.5">{longDay.format(parseDay(d.day))}</td>
                <td className="py-1.5 text-right">{int(d.clicks)}</td>
                <td className="py-1.5 text-right">{int(d.impressions)}</td>
                <td className="py-1.5 text-right">{d.impressions ? ctrText(d.ctr) : '–'}</td>
                <td className="py-1.5 text-right">{posText(d.position)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

/* ---------------- Tabeller ---------------- */

interface Column<T> {
  label: string;
  cell: (row: T) => ReactNode;
  align?: 'right';
  className?: string;
}

function Table<T>({ rows, columns, empty, rowKey }: { rows: T[]; columns: Column<T>[]; empty: string; rowKey: (row: T) => string }) {
  if (!rows.length) return <p className="px-1 py-3 text-[13px] text-muted">{empty}</p>;
  return (
    <div className="-mx-1 overflow-x-auto">
      <table className="w-full min-w-[560px] text-left text-[13px]">
        <thead className="text-muted">
          <tr>
            {columns.map((c) => (
              <th key={c.label} className={`px-1 py-2 font-normal ${c.align === 'right' ? 'text-right' : ''}`}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)} className="border-t border-black/[0.06] text-ink-2">
              {columns.map((c) => (
                <td key={c.label} className={`px-1 py-2 ${c.align === 'right' ? 'tabular text-right' : ''} ${c.className ?? ''}`}>
                  {c.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const metricColumns = <T extends GscTotals>(withPosition = true): Column<T>[] => [
  { label: 'Klik', cell: (r) => int(r.clicks), align: 'right' },
  { label: 'Visninger', cell: (r) => int(r.impressions), align: 'right' },
  { label: 'CTR', cell: (r) => ctrText(r.ctr), align: 'right' },
  ...(withPosition ? [{ label: 'Placering', cell: (r: T) => posText(r.position), align: 'right' as const }] : []),
];

const PageLink = ({ url }: { url: string }) => (
  <a href={url} target="_blank" rel="noreferrer" className="text-ink hover:underline" title={url}>
    {pathOf(url)}
  </a>
);

function Panel({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children: ReactNode }) {
  return (
    <Card className="p-5 sm:p-6">
      <p className="text-lg tracking-tight text-ink">{title}</p>
      {subtitle && <p className="text-[12.5px] text-muted">{subtitle}</p>}
      <div className="mt-4">{children}</div>
    </Card>
  );
}

function QueriesTab({ overview: o }: { overview: GscOverviewDTO }) {
  return (
    <Panel title="Top søgeord" subtitle={`Web, ${o.days} dage. Søgeord kan ikke deles på enhed – Google giver ikke den kombination. Sjældne søgninger er anonymiseret og ikke med.`}>
      <Table
        rows={o.topQueries}
        rowKey={(r) => r.query}
        empty="Ingen søgeord endnu."
        columns={[
          { label: 'Søgeord', cell: (r) => <span className="text-ink">{r.query}</span> },
          { label: 'Side', cell: (r) => (r.page ? <PageLink url={r.page} /> : '–'), className: 'max-w-[260px] truncate' },
          ...metricColumns<(typeof o.topQueries)[number]>(),
        ]}
      />
    </Panel>
  );
}

function PagesTab({ overview: o }: { overview: GscOverviewDTO }) {
  return (
    <Panel title="Top sider" subtitle={`Web, ${o.days} dage${o.device === 'all' ? '' : ` · ${DEVICES.find((d) => d.value === o.device)?.label}`}`}>
      <Table rows={o.topPages} rowKey={(r) => r.page} empty="Ingen sider endnu." columns={[{ label: 'Side', cell: (r) => <PageLink url={r.page} /> }, ...metricColumns<(typeof o.topPages)[number]>()]} />
    </Panel>
  );
}

function DiscoverTab({ overview: o }: { overview: GscOverviewDTO }) {
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <Panel title="Discover" subtitle="Googles feed på mobilen – uden søgeord og placering">
        <Table rows={o.discover} rowKey={(r) => r.page} empty="Ingen visninger i Discover endnu." columns={[{ label: 'Side', cell: (r) => <PageLink url={r.page} /> }, ...metricColumns<(typeof o.discover)[number]>(false)]} />
      </Panel>
      <Panel title="Billedsøgning" subtitle="Søgeord, hvor et af vores billeder blev vist">
        <Table rows={o.images} rowKey={(r) => r.query} empty="Ingen visninger i billedsøgning endnu." columns={[{ label: 'Søgeord', cell: (r) => <span className="text-ink">{r.query}</span> }, ...metricColumns<(typeof o.images)[number]>()]} />
      </Panel>
    </div>
  );
}

/* ---------------- Muligheder (4.1–4.6) ---------------- */

function OpportunitiesTab({ country }: { country: GscCountry }) {
  const q = useQuery({
    queryKey: ['admin-seo', 'opportunities', country],
    queryFn: () => api<GscOpportunitiesDTO>(`/admin/seo/opportunities?country=${country}`),
  });
  if (!q.data) return <Skeleton className="h-64" />;
  const d = q.data;
  const t = d.thresholds;
  if (!d.period) return <Panel title="Muligheder">Ingen data endnu.</Panel>;
  return (
    <div className="space-y-3">
      <p className="text-[12.5px] text-muted">
        Seneste periode {fmtDay(d.period.start)}–{fmtDay(d.period.end)} · forrige {fmtDay(d.period.previousStart)}–{fmtDay(d.period.previousEnd)} ·
        målt mod sitets egne tal · tærskler i backend/src/services/seo/opportunities.ts
        {!d.snapshotAvailable && ' · titler og interne links mangler, fordi server-renderingen ikke kører'}
      </p>

      {d.trend && (
        <Panel title="Trend" subtitle={`Seneste ${t.PERIOD_DAYS} dage mod de ${t.PERIOD_DAYS} før`}>
          <Table
            rows={[d.trend.total, ...d.trend.byType]}
            rowKey={(r) => r.label}
            empty=""
            columns={[
              { label: 'Sider', cell: (r) => <span className="text-ink">{r.label}</span> },
              { label: 'Klik', cell: (r) => `${int(r.current.clicks)} (før ${int(r.previous.clicks)})`, align: 'right' },
              { label: 'Visninger', cell: (r) => `${int(r.current.impressions)} (før ${int(r.previous.impressions)})`, align: 'right' },
              { label: 'CTR', cell: (r) => `${ctrText(r.current.ctr)} (${ctrText(r.previous.ctr)})`, align: 'right' },
              { label: 'Placering', cell: (r) => `${posText(r.current.position)} (${posText(r.previous.position)})`, align: 'right' },
            ]}
          />
        </Panel>
      )}

      <Panel title="Lav klikrate" subtitle={`Placering ≤ 10, mindst ${t.MIN_IMPRESSIONS_CTR} visninger og under ${Math.round(t.LOW_CTR_FACTOR * 100)} % af vores median-CTR for samme placering. Forslag: skarpere titel og beskrivelse.`}>
        <Table
          rows={d.lowCtr}
          rowKey={(r) => `${r.kind}:${r.key}`}
          empty="Ingen – eller for lidt data til at sammenligne."
          columns={[
            { label: 'Side / søgeord', cell: (r) => (r.kind === 'page' ? <PageLink url={r.key} /> : <span className="text-ink">"{r.key}"</span>) },
            { label: 'Nuværende titel og beskrivelse', cell: (r) => (r.title ? <span title={r.description ?? ''}>{r.title}</span> : '–'), className: 'max-w-[320px] truncate' },
            { label: 'CTR', cell: (r) => `${ctrText(r.ctr)} (median ${ctrText(r.medianCtr)})`, align: 'right' },
            { label: 'Placering', cell: (r) => posText(r.position), align: 'right' },
            { label: 'Visninger', cell: (r) => int(r.impressions), align: 'right' },
          ]}
        />
      </Panel>

      <Panel title="Tæt på side 1" subtitle={`Placering ${t.NEAR_MIN_POSITION}–${t.NEAR_MAX_POSITION} og mindst ${t.MIN_IMPRESSIONS_NEAR} visninger. Forslag: mere indhold og flere interne links.`}>
        <Table
          rows={d.nearPageOne}
          rowKey={(r) => r.page}
          empty="Ingen sider på placering 8–20 med nok visninger."
          columns={[
            { label: 'Side', cell: (r) => <PageLink url={r.page} /> },
            { label: 'Søgeord', cell: (r) => r.topQueries.join(', ') || '–', className: 'max-w-[220px] truncate' },
            { label: 'Linkes fra', cell: (r) => `${r.linkedFrom.length ? r.linkedFrom.slice(0, 4).join(', ') + (r.linkedFrom.length > 4 ? ` +${r.linkedFrom.length - 4}` : '') : 'ingen sider'}${r.inFooter ? ' · footer' : ''}`, className: 'max-w-[260px] truncate' },
            { label: 'Placering', cell: (r) => posText(r.position), align: 'right' },
            { label: 'Visninger', cell: (r) => int(r.impressions), align: 'right' },
          ]}
        />
      </Panel>

      <Panel title="Manglende sider" subtitle="Søgeord om varer, vi har tilbud på, men ingen side for. Linjen kan kopieres ind i shared/src/seoTerms.ts.">
        <Table
          rows={d.missingPages}
          rowKey={(r) => r.label}
          empty="Ingen søgeord om varer uden side."
          columns={[
            { label: 'Søgeord', cell: (r) => <span className="text-ink">"{r.query}"</span> },
            { label: 'Vare', cell: (r) => `${r.label} · ${r.offers} tilbud i ${r.stores} kæder` },
            { label: 'Til listen', cell: (r) => <code className="text-[12px] text-ink">{r.line}</code> },
            { label: 'Visninger', cell: (r) => int(r.impressions), align: 'right' },
          ]}
        />
      </Panel>

      <Panel title="Kannibalisering" subtitle="Samme søgeord giver visninger til flere af vores sider. Vælg én primær side, og justér titler og links.">
        <Table
          rows={d.cannibalization}
          rowKey={(r) => r.query}
          empty="Ingen søgeord deles af flere sider."
          columns={[
            { label: 'Søgeord', cell: (r) => <span className="text-ink">"{r.query}"</span> },
            { label: 'Sider', cell: (r) => r.pages.map((p) => `${pathOf(p.page)} (${int(p.impressions)})`).join(', ') },
            { label: 'Visninger', cell: (r) => int(r.impressions), align: 'right' },
          ]}
        />
      </Panel>

      <Panel title="Døde sider" subtitle={`I sitemapet uden visninger efter ${t.DEAD_AFTER_DAYS} dage – eller ikke indekseret.`}>
        <Table
          rows={d.deadPages}
          rowKey={(r) => r.path}
          empty="Ingen."
          columns={[
            { label: 'Side', cell: (r) => <span className="text-ink">{r.path}</span> },
            { label: 'Hvorfor', cell: (r) => <Pill tone={r.reason === 'not_indexed' ? 'warn' : 'ghost'}>{r.reason === 'not_indexed' ? 'Ikke indekseret' : 'Ingen visninger'}</Pill> },
            { label: 'Detaljer', cell: (r) => r.detail },
          ]}
        />
      </Panel>
    </div>
  );
}

/* ---------------- Indeksering og sitemaps ---------------- */

function IndexingTab() {
  const q = useQuery({ queryKey: ['admin-seo', 'indexing'], queryFn: () => api<GscIndexingDTO>('/admin/seo/indexing') });
  if (!q.data) return <Skeleton className="h-64" />;
  const d = q.data;
  return (
    <Panel
      title="Indeksering"
      subtitle={`${d.counts.indexed} af ${d.counts.inSitemap} sider i sitemapet er indekseret · ${d.counts.inspected} inspiceret · ${d.counts.withProblems} med problemer · kvote i dag ${d.quota.usedToday}/${d.quota.limit}`}
    >
      <Table
        rows={d.rows}
        rowKey={(r) => r.url}
        empty="Ingen URL'er inspiceret endnu – det sker ved næste hentning."
        columns={[
          { label: 'Side', cell: (r) => <PageLink url={r.url} /> },
          { label: 'Status', cell: (r) => (r.inspectedAt ? (r.error ? <span className="text-bad">{r.error}</span> : (r.coverageState ?? r.verdict)) : <span className="text-muted">Ikke tjekket</span>), className: 'max-w-[260px] truncate' },
          {
            label: 'Problemer',
            cell: (r) =>
              r.problems.length ? (
                <span className="flex flex-wrap gap-1">
                  {r.problems.map((p) => (
                    <Pill key={p.code} tone="warn" icon={<AlertTriangle className="size-3" />} title={p.label}>
                      {p.label.length > 40 ? `${p.label.slice(0, 39)}…` : p.label}
                    </Pill>
                  ))}
                </span>
              ) : (
                '–'
              ),
          },
          { label: 'Crawlet', cell: (r) => (r.lastCrawlTime ? relativeTime(r.lastCrawlTime) : '–'), align: 'right' },
          { label: 'Tjekket', cell: (r) => (r.inspectedAt ? relativeTime(r.inspectedAt) : '–'), align: 'right' },
        ]}
      />
    </Panel>
  );
}

function SitemapsTab() {
  const q = useQuery({ queryKey: ['admin-seo', 'sitemaps'], queryFn: () => api<GscSitemapsDTO>('/admin/seo/sitemaps') });
  if (!q.data) return <Skeleton className="h-40" />;
  return (
    <Panel title="Sitemaps" subtitle="Som Search Console ser dem">
      <Table
        rows={q.data.rows}
        rowKey={(r) => r.path}
        empty="Ingen sitemaps hentet endnu."
        columns={[
          { label: 'Sitemap', cell: (r) => <PageLink url={r.path} /> },
          { label: 'Type', cell: (r) => (r.isIndex ? 'Indeks' : 'Sitemap') },
          { label: 'Indsendt', cell: (r) => (r.lastSubmitted ? dateTime.format(new Date(r.lastSubmitted)) : '–') },
          { label: 'Sidst læst', cell: (r) => (r.isPending ? 'Venter' : r.lastDownloaded ? dateTime.format(new Date(r.lastDownloaded)) : '–') },
          { label: 'Fejl', cell: (r) => (r.errors ? <Pill tone="bad">{r.errors}</Pill> : '0'), align: 'right' },
          { label: 'Advarsler', cell: (r) => (r.warnings ? <Pill tone="warn">{r.warnings}</Pill> : '0'), align: 'right' },
          { label: 'Sider', cell: (r) => int(r.submitted), align: 'right' },
        ]}
      />
    </Panel>
  );
}
