import type { OfferDTO, StatsDTO } from '@tilbudsradar/shared';
import { categoryLabel } from '@tilbudsradar/shared';
import clsx from 'clsx';
import { ArrowUpRight, Newspaper, Plus, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { DotTimeline } from '../components/DotTimeline';
import { OfferCard, OfferCardSkeleton, useOpenOffer } from '../components/OfferCard';
import { DotBars, PulseRow, RadarRings, RulerTicks, WaveSpark } from '../components/ui/charts';
import { DotNumber } from '../components/ui/DotNumber';
import { Button, Card, IconButton, Pill, SectionHeader, Skeleton } from '../components/ui/primitives';
import { greeting, int, kr, relativeTime, unitLabel } from '../lib/format';
import { useLists, useSearch, useStats, useStores, useTopDeals } from '../lib/hooks';
import { CategoryIcon } from '../lib/icons';
import { useAuth } from '../lib/store';

function weekNumber(d = new Date()): number {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
}

function Stat({ value, label, tone = 'white' }: { value: number | undefined; label: string; tone?: 'lime' | 'white' }) {
  return (
    <div className="flex items-start gap-2">
      {value === undefined ? <Skeleton className="h-9 w-20" /> : <DotNumber value={value} height={34} />}
      <Pill tone={tone} className="-mt-1.5">
        {label}
      </Pill>
    </div>
  );
}

export function Dashboard() {
  const stats = useStats();
  const stores = useStores();
  const s = stats.data;
  const empty = s && s.totalOffers === 0;

  return (
    <div className="space-y-5 pt-2 lg:pt-4">
      {/* ------------------------------------------------ Hero */}
      <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_372px]">
        <div className="flex min-w-0 flex-col">
          <p className="text-sm text-muted">
            {greeting()} · uge {weekNumber()}
            {s?.lastScrapeAt && <> · opdateret {relativeTime(s.lastScrapeAt)}</>}
          </p>
          <h1 className="mt-1 text-[40px] leading-[1.05] tracking-[-0.045em] text-ink sm:text-[52px]">Ugens tilbud</h1>

          <div className="mt-6 grid grid-cols-2 gap-x-6 gap-y-5 sm:flex sm:flex-wrap sm:items-start sm:justify-between sm:gap-8">
            <Stat value={s?.totalOffers} label="Aktive" tone="lime" />
            <Stat value={s?.realDeals} label="Reelle" />
            <Stat value={s?.newToday} label="Nye i dag" />
            <Stat value={s?.storeCount} label="Kæder" />
          </div>

          <div className="mt-6">
            {s && stores.data ? <DotTimeline stats={s} stores={stores.data} /> : <Skeleton className="h-[78px] rounded-full" />}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <ListCard />
          <AlarmCard />
        </div>
      </section>

      {empty && <FirstRunNotice />}

      {/* ------------------------------------------------ Gradientkort */}
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-[1fr_1fr_1.05fr]">
        <ScoreCard stats={s} />
        <DiscountCard stats={s} />
        <NextCatalogCard stats={s} />
      </section>

      {/* ------------------------------------------------ Prisradar + bedste tilbud */}
      <section className="grid gap-6 pt-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.22fr)]">
        <div className="min-w-0">
          <SectionHeader
            title="Prisradar"
            subtitle="Laveste enhedspris lige nu på basisvarer"
            action={
              <Link to="/sog?q=letm%C3%A6lk">
                <Button size="sm">Se alle</Button>
              </Link>
            }
          />
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <StapleCard q="letmælk" viz="ruler" />
            <StapleCard q="hakket oksekød" viz="wave" />
            <StapleCard q="æg" viz="bars" />
          </div>
        </div>
        <TopDeals />
      </section>

      <MoreDeals />
    </div>
  );
}

/* ------------------------------------------------------------------ */

function ListCard() {
  const token = useAuth((st) => st.accessToken);
  const lists = useLists(Boolean(token));
  const navigate = useNavigate();
  const count = lists.data?.length ?? 0;
  return (
    <Card className="relative flex min-h-[236px] flex-col overflow-hidden p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[15px] leading-tight tracking-tight text-ink">
          Opret
          <br />
          indkøbsliste
        </p>
        <IconButton label="Ny indkøbsliste" size="sm" onClick={() => navigate('/lister?ny=1')}>
          <Plus className="size-4" />
        </IconButton>
      </div>
      {/* Små "papirer" bag den hævede pille – som faktura-illustrationen i referencen */}
      <div className="relative mt-auto h-[118px]">
        <Paper className="absolute right-3 bottom-10 w-[58%] rotate-[8deg]" title="LISTE" />
        <Paper className="absolute bottom-8 left-2 w-[52%] -rotate-[6deg] opacity-90" title="LISTE" />
        <Link
          to="/lister"
          className="card-raised absolute inset-x-0 bottom-0 block px-3.5 py-2.5 transition hover:bg-white"
        >
          <p className="text-[13px] text-ink">Mine lister</p>
          <p className="text-[11px] text-faint">{token ? `${count} ${count === 1 ? 'liste' : 'lister'}` : 'Ingen endnu'}</p>
        </Link>
      </div>
    </Card>
  );
}

function Paper({ className, title }: { className?: string; title: string }) {
  return (
    <div className={clsx('rounded-lg bg-white p-2 shadow-[0_6px_16px_-8px_rgba(0,0,0,0.25)]', className)}>
      <div className="flex items-center gap-1.5">
        <span className="h-px flex-1 bg-ink/40" />
        <span className="text-[6px] tracking-[0.2em] text-ink/70">{title}</span>
      </div>
      <div className="mt-1.5 space-y-1">
        {[80, 62, 70, 45].map((w, i) => (
          <div key={i} className="flex items-center gap-1">
            <span className="size-1 rounded-[1px] border border-ink/30" />
            <span className="h-[2px] rounded bg-ink/15" style={{ width: `${w}%` }} />
          </div>
        ))}
      </div>
    </div>
  );
}

function AlarmCard() {
  return (
    <Link to="/alarmer" className="grad-card grad-pink flex min-h-[236px] flex-col p-4 transition hover:brightness-[1.03]">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[15px] leading-tight tracking-tight text-white/85">
          Aktivér
          <br />
          prisalarm
        </p>
        <span className="grid size-8 place-items-center rounded-full bg-white/30 ring-1 ring-white/50 backdrop-blur-md">
          <Plus className="size-4" />
        </span>
      </div>
      <RadarRings className="mx-auto my-auto size-24" />
      <PulseRow />
    </Link>
  );
}

function FirstRunNotice() {
  return (
    <Card className="flex flex-col items-start gap-3 p-5 sm:flex-row sm:items-center">
      <span className="grid size-10 place-items-center rounded-full bg-lime">
        <Newspaper className="size-5" strokeWidth={1.6} />
      </span>
      <div className="flex-1">
        <p className="text-ink">Aviserne hentes lige nu</p>
        <p className="text-sm text-muted">
          Første scraping tager et par minutter, fordi vi holder pæne pauser mellem hver forespørgsel. Følg med under Kilder.
        </p>
      </div>
      <Link to="/kilder">
        <Button size="sm">Se status</Button>
      </Link>
    </Card>
  );
}

function ScoreCard({ stats }: { stats?: StatsDTO }) {
  const share = stats && stats.totalOffers ? Math.round((stats.realDeals / stats.totalOffers) * 100) : null;
  const label = share == null ? 'Opbygger historik' : share >= 30 ? 'Stærk uge' : share >= 12 ? 'God uge' : 'Stille uge';
  const values = stats?.timeline.map((d) => d.count) ?? [];
  const todayIdx = stats?.timeline.findIndex((d) => d.date === new Date().toISOString().slice(0, 10));
  return (
    <div className="grad-card grad-green flex min-h-[258px] flex-col p-5">
      <p className="text-right text-sm text-white/80">Sparescore</p>
      <div className="mt-2 flex flex-1 flex-col items-center justify-center">
        {share == null ? (
          <span className="text-4xl text-white/80">–</span>
        ) : (
          <DotNumber value={share} height={52} className="drop-shadow-[0_1px_6px_rgba(0,0,0,0.12)]" />
        )}
        <p className="mt-2 text-sm text-white">{label}</p>
        <p className="mt-0.5 text-[11px] text-white/70">andel af ugens tilbud der er reelle besparelser</p>
      </div>
      {values.length > 0 && (
        <DotBars values={values} highlight={todayIdx !== undefined && todayIdx >= 0 ? todayIdx : undefined} className="mt-4 h-10" />
      )}
    </div>
  );
}

function DiscountCard({ stats }: { stats?: StatsDTO }) {
  const avg = stats?.avgDiscountPct;
  return (
    <div className="grad-card grad-orange flex min-h-[258px] flex-col p-5">
      <p className="text-center text-sm text-white/85">Gennemsnitlig rabat</p>
      <div className="flex flex-1 flex-col items-center justify-center">
        {avg == null ? <span className="text-4xl text-white/80">–</span> : <DotNumber value={`${Math.round(avg)}%`} height={52} />}
        <p className="mt-2 text-sm text-white">
          {stats?.topSavings ? `Største besparelse ${stats.topSavings}%` : 'på tilbud med førpris'}
        </p>
      </div>
      <RulerTicks value={avg == null ? null : Math.min(1, avg / 60)} tone="light" className="mt-4" count={44} height={34} />
    </div>
  );
}

function NextCatalogCard({ stats }: { stats?: StatsDTO }) {
  const [hidden, setHidden] = useState(false);
  const next = stats?.nextCatalogAt ? new Date(stats.nextCatalogAt) : null;
  const days = next ? Math.max(0, Math.ceil((next.getTime() - Date.now()) / 86_400_000)) : null;
  // Fremdrift gennem ugen (mandag → søndag).
  const now = new Date();
  const weekProgress = (((now.getDay() + 6) % 7) + now.getHours() / 24) / 7;
  if (hidden) return null;
  return (
    <Card className="relative flex min-h-[258px] flex-col p-5 md:col-span-2 xl:col-span-1">
      <div className="flex items-start justify-between">
        <p className="text-[15px] text-ink">Næste avis udkommer</p>
        <IconButton label="Skjul" size="sm" onClick={() => setHidden(true)}>
          <X className="size-3.5" />
        </IconButton>
      </div>
      <div className="mt-4 flex flex-1 items-center gap-4">
        <div className="min-w-0 flex-1">
          <p className="flex items-start gap-1 text-[48px] leading-none tracking-[-0.05em] text-ink">
            {days == null ? '–' : days === 0 ? 'I dag' : days}
            {days != null && days > 0 && <span className="mt-1 text-xs tracking-normal text-muted">{days === 1 ? 'dag' : 'dage'}</span>}
          </p>
          <div className="relative mt-6 h-3">
            <div className="absolute top-1/2 right-6 left-0 h-px -translate-y-1/2 bg-ink/15" />
            <span
              className="absolute top-1/2 size-3.5 -translate-y-1/2 rounded-full bg-lime shadow-[0_0_0_4px_rgba(226,243,59,0.35)]"
              style={{ left: `calc(${Math.round(weekProgress * 85)}% - 7px)` }}
            />
            <span className="absolute top-1/2 right-2 size-3 -translate-y-1/2 rounded-full border border-ink/25 bg-raised" />
            <span className="absolute top-1/2 right-0 size-1.5 -translate-y-1/2 rounded-full bg-ink/20" />
          </div>
          <p className="mt-5 max-w-[210px] text-[11px] leading-snug text-muted">
            Aviserne hentes automatisk kl. 06:15 og 18:15{stats?.lastScrapeAt && `, sidst ${relativeTime(stats.lastScrapeAt)}`}.
          </p>
        </div>
        <div className="grid h-[150px] w-[112px] shrink-0 place-items-center rounded-[56px] bg-raised shadow-pill">
          <MiniCatalog />
        </div>
      </div>
    </Card>
  );
}

function MiniCatalog() {
  return (
    <div className="relative h-20 w-14">
      <div className="absolute inset-0 rotate-[-10deg] rounded-md bg-[#f59a3a] shadow-md" />
      <div className="absolute inset-0 rotate-[4deg] overflow-hidden rounded-md bg-white shadow-lg">
        <div className="h-4 bg-[#e34948]" />
        <div className="grid grid-cols-2 gap-1 p-1.5">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="space-y-0.5">
              <div className="h-3 rounded-sm bg-[#f3e5c8]" />
              <div className="h-1 w-3/4 rounded bg-lime" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function StapleCard({ q, viz }: { q: string; viz: 'ruler' | 'wave' | 'bars' }) {
  const { data, isLoading } = useSearch({ q, sort: 'unit', limit: 12 });
  const open = useOpenOffer();
  const items = (data?.items ?? []).filter((i) => i.unitPrice != null && i.unit === data?.items[0]?.unit);
  const best = items[0];
  const prices = items.map((i) => i.unitPrice!);
  const min = Math.min(...prices);
  const max = Math.max(...prices);

  if (isLoading) return <Skeleton className="h-[212px] rounded-[26px]" />;
  if (!best) {
    return (
      <Card className="flex h-[212px] flex-col justify-between p-4">
        <p className="text-sm text-muted capitalize">{q}</p>
        <p className="text-xs text-faint">Ingen tilbud lige nu</p>
      </Card>
    );
  }
  const [whole, dec] = kr(best.unitPrice).split(',');
  return (
    <button
      type="button"
      onClick={() => open(best.id)}
      className="group flex h-[212px] flex-col rounded-[26px] bg-surface-2 p-4 text-left shadow-soft transition hover:-translate-y-0.5 hover:bg-raised"
    >
      <div className="flex items-center gap-2.5">
        <span className="grid size-10 place-items-center rounded-full bg-raised shadow-pill">
          <CategoryIcon id={best.category} className="size-[18px] text-ink" />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-[12px] text-muted capitalize">{q}</span>
          <span className="block truncate text-[10.5px] text-faint">{categoryLabel(best.category)}</span>
        </span>
        <ArrowUpRight className="ml-auto size-4 text-faint transition group-hover:text-ink" />
      </div>
      <div className="mt-auto flex items-end gap-1.5 text-ink">
        <DotNumber value={whole!} height={34} />
        <span className="pb-0.5 text-[12px] leading-tight text-ink-2">
          ,{dec}
          <br />
          kr/{unitLabel(best.unit)}
        </span>
      </div>
      <p className="mt-1 truncate text-[11px] text-muted">
        {best.store.name} · {best.title}
      </p>
      <div className="mt-3 h-9 text-ink">
        {viz === 'ruler' && <RulerTicks value={max > min ? 0.05 : 0.5} height={30} count={26} />}
        {viz === 'wave' && <WaveSpark values={prices.length > 1 ? prices : [min, min]} marker={0.02} className="h-9" />}
        {viz === 'bars' && (
          <DotBars values={prices.map((p) => max - p + (max - min) * 0.15 + 0.01)} highlight={0} tone="dark" rows={4} className="h-9" />
        )}
      </div>
    </button>
  );
}

function TopDeals() {
  const { data, isLoading } = useTopDeals(6);
  return (
    <div className="min-w-0">
      <SectionHeader
        title="Ugens bedste tilbud"
        subtitle="Reelle besparelser målt mod 90-dages prishistorik"
        action={
          <Link to="/sog?sortering=discount&reelle=1">
            <Button size="sm">Se alle</Button>
          </Link>
        }
      />
      <div className="no-scrollbar -mx-1 mt-4 flex snap-x gap-3 overflow-x-auto px-1 pb-2 sm:grid sm:grid-cols-3 sm:overflow-visible">
        {isLoading
          ? Array.from({ length: 3 }, (_, i) => <OfferCardSkeleton key={i} />)
          : (data ?? []).slice(0, 3).map((o, i) => (
              <OfferCard key={o.id} offer={o} className="w-[210px] shrink-0 snap-start sm:w-auto" rank={i + 1} />
            ))}
        {!isLoading && !data?.length && (
          <Card className="col-span-3 p-6 text-sm text-muted">
            Når der er prishistorik nok, viser vi de tilbud der er markant billigere end normalt. Kør evt.{' '}
            <code className="rounded bg-black/5 px-1">npm run db:seed-demo</code> for demo-historik.
          </Card>
        )}
      </div>
    </div>
  );
}

function MoreDeals() {
  const { data, isLoading } = useTopDeals(15);
  const rest: OfferDTO[] = (data ?? []).slice(3);
  if (!isLoading && !rest.length) return <BrowseTeaser />;
  return (
    <section className="pt-4">
      <SectionHeader title="Flere reelle tilbud" subtitle="Madvarer – sorteret efter faktisk besparelse" />
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6">
        {isLoading
          ? Array.from({ length: 6 }, (_, i) => <OfferCardSkeleton key={i} />)
          : rest.map((o, i) => <OfferCard key={o.id} offer={o} rank={i + 4} />)}
      </div>
    </section>
  );
}

function BrowseTeaser() {
  const { data } = useSearch({ q: '', sort: 'discount', limit: 12 });
  if (!data?.items.length) return null;
  return (
    <section className="pt-4">
      <SectionHeader
        title="Største rabatter lige nu"
        subtitle={`${int(data.total)} aktive tilbud – sorteret efter rabat`}
        action={
          <Link to="/sog">
            <Button size="sm">Se alle</Button>
          </Link>
        }
      />
      <DealGrid>
        {data.items.map((o) => (
          <OfferCard key={o.id} offer={o} />
        ))}
      </DealGrid>
    </section>
  );
}

function DealGrid({ children }: { children: ReactNode }) {
  return <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6">{children}</div>;
}
