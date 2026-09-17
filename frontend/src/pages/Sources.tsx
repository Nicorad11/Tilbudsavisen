import type { RunStatus, SourceStatusDTO } from '@tilbudsradar/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { AlertTriangle, Globe, MapPinned, Play, RefreshCw, ShieldCheck } from 'lucide-react';
import { Button, Card, Pill, SectionHeader, Skeleton, StoreDot, Toggle } from '../components/ui/primitives';
import { api } from '../lib/api';
import { formatTime, int, relativeTime } from '../lib/format';
import { useScrapeStatus, useStores } from '../lib/hooks';
import { useUi } from '../lib/store';
import { storeColor } from '../lib/storeColors';

const STATUS: Record<RunStatus, { label: string; tone: 'lime' | 'warn' | 'bad' | 'ghost' | 'white' }> = {
  success: { label: 'OK', tone: 'lime' },
  partial: { label: 'Delvis', tone: 'warn' },
  failed: { label: 'Fejl', tone: 'bad' },
  running: { label: 'Kører', tone: 'white' },
  skipped: { label: 'Sprunget over', tone: 'ghost' },
};

const KIND = { api: 'Tilbuds-API', webshop: 'Webshop-API', html: 'HTML' } as const;

/** "15 6,18 * * *" → "dagligt kl. 06:15 og 18:15"; andre udtryk vises som de er. */
function describeCron(expr: string): string {
  const m = expr.trim().match(/^(\d{1,2}) ([\d,]+) \* \* \*$/);
  if (!m) return expr;
  const times = m[2]!.split(',').map((h) => `${h.padStart(2, '0')}:${m[1]!.padStart(2, '0')}`);
  return `dagligt kl. ${times.join(' og ')}`;
}

export function Sources() {
  const status = useScrapeStatus();
  const stores = useStores();
  const qc = useQueryClient();
  const toast = useUi((s) => s.showToast);
  const onError = (e: unknown) => toast(e instanceof Error ? e.message : 'Fejl', 'error');
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['scrape-status'] });
    void qc.invalidateQueries({ queryKey: ['stores'] });
  };

  const run = useMutation({
    mutationFn: (sources?: string[]) => api<{ started: string[] }>('/admin/scrape', { method: 'POST', body: { sources } }),
    onSuccess: (r) => {
      toast(r.started.length ? `Startede ${r.started.length} kilde(r)` : 'Kilderne kører allerede eller er slået fra');
      refresh();
    },
    onError,
  });
  const syncStores = useMutation({
    mutationFn: () => api('/admin/stores/sync', { method: 'POST' }),
    onSuccess: () => toast('Butikslokationer synkroniseres i baggrunden'),
    onError,
  });
  const toggleSource = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => api(`/admin/sources/${id}`, { method: 'PATCH', body: { enabled } }),
    onSuccess: refresh,
    onError,
  });
  const toggleStore = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => api(`/admin/stores/${id}`, { method: 'PATCH', body: { enabled } }),
    onSuccess: () => {
      refresh();
      void qc.invalidateQueries({ queryKey: ['search'] });
      void qc.invalidateQueries({ queryKey: ['stats'] });
    },
    onError,
  });

  const data = status.data;
  const forbidden = status.error && 'status' in status.error && (status.error as { status: number }).status === 403;
  const failing = data?.sources.filter((s) => s.lastStatus === 'failed' || s.lastStatus === 'partial').length ?? 0;

  return (
    <div className="space-y-5 pt-2 lg:pt-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-muted">Scraping-kilder, status og feature-flags</p>
          <h1 className="mt-1 text-[36px] leading-[1.05] tracking-[-0.045em] sm:text-[48px]">Kilder</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button icon={<MapPinned className="size-4" />} onClick={() => syncStores.mutate()} loading={syncStores.isPending}>
            Synkronisér butikker
          </Button>
          <Button
            tone="dark"
            icon={data?.running ? <RefreshCw className="size-4 animate-spin" /> : <Play className="size-4" />}
            onClick={() => run.mutate(undefined)}
            disabled={data?.running}
          >
            {data?.running ? 'Scraper…' : 'Kør alle nu'}
          </Button>
        </div>
      </div>

      {forbidden && (
        <Card className="p-5 text-sm text-ink-2">Denne side kræver administratoradgang. Log ind med en e-mail fra ADMIN_EMAILS.</Card>
      )}
      {data?.adminOpen && (
        <p className="flex items-center gap-2 rounded-2xl bg-[#fbe6cf] px-4 py-2.5 text-[13px] text-[#8a4a0b]">
          <AlertTriangle className="size-4 shrink-0" />
          Udviklingstilstand: admin-funktionerne er åbne, fordi ADMIN_EMAILS ikke er sat. Sæt den før deploy.
        </p>
      )}

      <section className="grid gap-4 md:grid-cols-3">
        <div className="grad-card grad-green p-5">
          <p className="text-sm text-white/85">Aktive kilder</p>
          <p className="mt-2 text-5xl tracking-[-0.04em]">
            {data ? data.sources.filter((s) => s.enabled && s.storeEnabled).length : '–'}
            <span className="text-xl text-white/80"> / {data?.sources.length ?? '–'}</span>
          </p>
          <p className="mt-2 text-sm">{failing ? `${failing} med fejl ved sidste kørsel` : 'Ingen fejl ved sidste kørsel'}</p>
        </div>
        <Card className="p-5">
          <p className="flex items-center gap-2 text-sm text-ink">
            <ShieldCheck className="size-4" strokeWidth={1.6} /> Ansvarlig scraping
          </p>
          <ul className="mt-3 space-y-1.5 text-[13px] text-ink-2">
            <li>robots.txt tjekkes før hver request</li>
            <li>Tilfældig pause mellem requests til samme vært</li>
            <li>Loft pr. vært pr. minut – delt af alle kilder</li>
            <li>Cache-Control/ETag og Retry-After respekteres</li>
          </ul>
        </Card>
        <Card className="p-5">
          <p className="flex items-center gap-2 text-sm text-ink">
            <Globe className="size-4" strokeWidth={1.6} /> Forbrug pr. vært
          </p>
          {!data?.hosts.length ? (
            <p className="mt-3 text-[13px] text-muted">Ingen requests siden serveren startede.</p>
          ) : (
            <ul className="mt-3 space-y-2.5">
              {data.hosts.map((h) => (
                <li key={h.host}>
                  <div className="flex justify-between text-[12px]">
                    <span className="truncate text-ink-2">{h.host}</span>
                    <span className="tabular text-muted">
                      {h.lastMinute}/{h.limitPerMinute} pr. min · {int(h.total)} i alt
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-black/[0.06]">
                    <div
                      className="h-full rounded-full bg-ink transition-all"
                      style={{ width: `${Math.min(100, (h.lastMinute / h.limitPerMinute) * 100)}%` }}
                    />
                  </div>
                  {(h.robotsBlocked > 0 || h.cacheHits > 0) && (
                    <p className="mt-0.5 text-[11px] text-faint">
                      {h.cacheHits} cache-hits · {h.robotsBlocked} blokeret af robots.txt
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>

      <section>
        <SectionHeader title="Kæder" subtitle="Slå en kæde helt fra, fx hvis kæden beder om at blive udeladt" />
        <div className="mt-3 flex flex-wrap gap-2">
          {stores.data?.map((s) => (
            <label key={s.id} className="flex h-11 items-center gap-2.5 rounded-full bg-raised pr-2 pl-4 text-sm shadow-pill">
              <StoreDot color={storeColor(s.id)} className="ring-0" />
              {s.name}
              <span className="text-[11px] text-faint">
                {int(s.offerCount)} tilbud · {int(s.locationCount)} butikker
              </span>
              <Toggle checked={s.enabled} label={`${s.name} aktiv`} onChange={(enabled) => toggleStore.mutate({ id: s.id, enabled })} />
            </label>
          ))}
        </div>
      </section>

      <section>
        <SectionHeader title="Kilder" subtitle={data?.schedule ? `Automatisk kørsel ${describeCron(data.schedule)} (dansk tid)` : undefined} />
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          {status.isLoading && Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-56 rounded-[30px]" />)}
          {data?.sources.map((s) => (
            <SourceCard
              key={s.id}
              source={s}
              running={data.queue.includes(s.id)}
              onRun={() => run.mutate([s.id])}
              onToggle={(enabled) => toggleSource.mutate({ id: s.id, enabled })}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

function SourceCard({
  source: s,
  running,
  onRun,
  onToggle,
}: {
  source: SourceStatusDTO;
  running: boolean;
  onRun: () => void;
  onToggle: (v: boolean) => void;
}) {
  const st = running ? STATUS.running : s.lastStatus ? STATUS[s.lastStatus] : null;
  const disabled = !s.enabled || !s.storeEnabled;
  const maxOffers = Math.max(1, ...s.runs.map((r) => r.offersFound));
  // Webshop-kilden opretter ikke tilbud – den gemmer hyldepriser i prishistorikken.
  const headline = s.kind === 'webshop' ? (s.runs.find((r) => r.status !== 'running')?.baselineSaved ?? 0) : s.activeOffers;
  return (
    <Card className={clsx('p-5 transition', disabled && 'opacity-60')}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-[17px] tracking-tight">
            <StoreDot color={storeColor(s.storeId)} className="ring-0" />
            {s.storeName}
            <span className="text-[12px] text-muted">{KIND[s.kind]}</span>
          </p>
          <p className="mt-0.5 truncate text-xs text-muted">{s.description}</p>
        </div>
        <Toggle checked={s.enabled} label={`Kilden ${s.id} aktiv`} onChange={onToggle} />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {st ? (
          <Pill tone={st.tone} icon={running ? <RefreshCw className="size-3 animate-spin" /> : undefined}>
            {st.label}
          </Pill>
        ) : (
          <Pill tone="ghost">Ikke kørt</Pill>
        )}
        {!s.storeEnabled && <Pill tone="warn">Kæden er slået fra</Pill>}
        {s.consecutiveFailures > 1 && <Pill tone="bad">{s.consecutiveFailures} fejl i træk</Pill>}
        <span className="text-xs text-muted">
          {s.lastRunAt ? `kørt ${relativeTime(s.lastRunAt)}` : 'aldrig kørt'}
          {s.lastSuccessAt && s.lastSuccessAt !== s.lastRunAt && ` · sidst OK ${relativeTime(s.lastSuccessAt)}`}
        </span>
      </div>

      {s.lastError && (
        <p className="mt-3 rounded-2xl bg-[#f9dcd7]/70 px-3 py-2 text-xs leading-snug text-[#8f2a1d]">{s.lastError}</p>
      )}

      <div className="mt-4 flex items-end justify-between gap-4">
        <div>
          <p className="text-3xl leading-none tracking-[-0.04em]">{int(headline)}</p>
          <p className="mt-1 text-xs text-muted">{s.kind === 'webshop' ? 'hyldepriser ved sidste kørsel' : 'aktive tilbud'}</p>
        </div>
        {/* Seneste kørsler som små søjler */}
        <div className="flex h-12 items-end gap-1" aria-label="Seneste kørsler">
          {[...s.runs].reverse().map((r) => {
            const n = r.offersFound;
            return (
              <span
                key={r.id}
                title={`${formatTime(r.startedAt)} · ${r.status} · ${r.offersFound} fundet, ${r.offersSaved + r.baselineSaved} gemt, ${r.rejected} afvist${r.message ? ` – ${r.message}` : ''}`}
                className={clsx(
                  'w-2.5 rounded-full',
                  r.status === 'success' ? 'bg-ink' : r.status === 'partial' ? 'bg-warn' : r.status === 'running' ? 'bg-lime' : 'bg-bad',
                )}
                style={{ height: `${Math.max(12, (n / maxOffers) * 100)}%` }}
              />
            );
          })}
        </div>
        <Button size="sm" icon={<Play className="size-3.5" />} onClick={onRun} disabled={disabled || running}>
          Kør
        </Button>
      </div>

      {s.runs[0] && (
        <p className="mt-3 text-[11px] text-muted">
          Seneste: {int(s.runs[0].offersFound)} gyldige · {int(s.runs[0].offersSaved + s.runs[0].baselineSaved)} gemt ·{' '}
          {int(s.runs[0].rejected)} afvist
          {s.runs[0].durationMs != null && ` · ${Math.round(s.runs[0].durationMs / 1000)} s`}
        </p>
      )}
    </Card>
  );
}
