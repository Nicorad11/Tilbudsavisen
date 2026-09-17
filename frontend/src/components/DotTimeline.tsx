import type { StatsDTO, StoreDTO } from '@tilbudsradar/shared';
import clsx from 'clsx';
import { TrendingDown, TrendingUp, Sparkles } from 'lucide-react';
import { useMemo } from 'react';
import { formatDate, pct } from '../lib/format';
import { storeColor } from '../lib/storeColors';

/**
 * Tidslinje-strippen fra referencen: én kolonne prikker pr. dag (antal aktive
 * tilbud), en farvet prik når en kæde får ny avis, og en glas-pille med
 * prisudviklingen svævende ovenpå.
 */
export function DotTimeline({ stats, stores }: { stats: StatsDTO; stores: StoreDTO[] }) {
  const today = new Date().toISOString().slice(0, 10);
  const columns = useMemo(() => {
    const max = Math.max(1, ...stats.timeline.map((d) => d.count));
    return stats.timeline.map((d, i) => {
      const prev = stats.timeline[i - 1];
      // Kæde med størst stigning i antal tilbud = ny avis den dag.
      let newStore: string | null = null;
      let best = 0;
      for (const [id, n] of Object.entries(d.stores)) {
        const delta = n - (prev?.stores[id] ?? 0);
        if (prev && delta > best && delta > 20) {
          best = delta;
          newStore = id;
        }
      }
      return { ...d, level: Math.max(1, Math.round((d.count / max) * 4)), newStore };
    });
  }, [stats.timeline]);

  const nameOf = (id: string) => stores.find((s) => s.id === id)?.name ?? id;
  const trend = stats.trendPct;
  const newCatalogs = columns.filter((c) => c.newStore && c.date > today).length;

  return (
    <div className="relative">
      <div className="relative flex h-[78px] items-center gap-0 overflow-hidden rounded-full bg-surface-2/70 px-6 shadow-[inset_0_1px_3px_rgba(0,0,0,0.06)]">
        {columns.map((c) => {
          const isToday = c.date === today;
          const first = c === columns[0];
          const last = c === columns[columns.length - 1];
          return (
            <div key={c.date} className="relative flex h-full flex-1 flex-col items-center justify-center" title={`${formatDate(c.date)}: ${c.count} tilbud`}>
              {(isToday || first || last) && (
                <span
                  className={clsx(
                    'absolute bottom-2 text-[10px] whitespace-nowrap',
                    isToday ? 'font-medium text-ink' : 'text-muted',
                  )}
                >
                  {isToday ? 'I dag' : formatDate(c.date)}
                </span>
              )}
              {isToday && <span className="absolute top-3 bottom-6 w-[2px] rounded-full bg-ink" />}
              <div className={clsx('flex flex-col items-center gap-[3px] pb-3', isToday && 'opacity-0')}>
                {c.newStore && (
                  <span
                    className="mb-0.5 size-[9px] rounded-full"
                    style={{ background: storeColor(c.newStore) }}
                    title={`Ny avis: ${nameOf(c.newStore)}`}
                  />
                )}
                {Array.from({ length: c.level }, (_, i) => (
                  <span
                    key={i}
                    className={clsx('rounded-full', c.date > today ? 'bg-ink/15' : 'bg-ink/35')}
                    style={{ width: 4 + (i === c.level - 1 ? 1.5 : 0), height: 4 + (i === c.level - 1 ? 1.5 : 0) }}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <div className="glass absolute top-1/2 left-[46%] flex -translate-x-1/2 -translate-y-1/2 flex-col rounded-full px-6 py-2.5 max-sm:left-1/2">
        <span className="flex items-center gap-2 text-[15px] tracking-tight whitespace-nowrap text-ink">
          {trend == null ? (
            <>
              <Sparkles className="size-4" strokeWidth={1.6} />
              {newCatalogs > 0 ? `${newCatalogs} nye aviser på vej` : 'Prishistorik opbygges'}
            </>
          ) : trend <= 0 ? (
            <>
              <TrendingDown className="size-4" strokeWidth={1.6} /> Priser faldende
            </>
          ) : (
            <>
              <TrendingUp className="size-4" strokeWidth={1.6} /> Priser stigende
            </>
          )}
        </span>
        <span className="text-[12px] whitespace-nowrap text-muted">
          {trend == null
            ? 'ny måling ved hver scraping'
            : `${trend > 0 ? '+' : '−'}${pct(Math.abs(trend), 1)} kr/enhed sidste 30 dage`}
        </span>
      </div>
    </div>
  );
}
