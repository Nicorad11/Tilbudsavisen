import type { AdminCount } from '@tilbudsradar/shared';
import clsx from 'clsx';
import { useState, type ReactNode } from 'react';
import { Card } from '../components/ui/primitives';
import { int } from '../lib/format';

/* Fælles byggesten til admin-siderne (Overblik og SEO). */

export const dayLabel = new Intl.DateTimeFormat('da-DK', { day: 'numeric', month: 'short' });
export const longDay = new Intl.DateTimeFormat('da-DK', { weekday: 'long', day: 'numeric', month: 'long' });
/** "2026-10-17" → dato uden tidszone-forskydning. */
export const parseDay = (day: string) => new Date(`${day}T12:00:00`);

export function Stat({ label, value, note, change }: { label: string; value: number | string; note: ReactNode; change?: ReactNode }) {
  return (
    <Card className="p-5">
      <p className="flex items-baseline justify-between gap-2 text-[13px] text-muted">
        <span>{label}</span>
        {change}
      </p>
      {/* Store tal uden tabular-nums – de står alene og skal ikke flugte. */}
      <p className="mt-2 text-[40px] leading-none tracking-[-0.045em] text-ink">{typeof value === 'number' ? int(value) : value}</p>
      <p className="mt-2 text-[12.5px] text-muted">{note}</p>
    </Card>
  );
}

export function ChartCard({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
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
export function DayBars<T extends { day: string }>({
  data,
  value,
  unit,
  endLabel = 'I dag',
}: {
  data: T[];
  value: (d: T) => number;
  unit: (n: number) => string;
  /** Teksten under den sidste søjle. */
  endLabel?: string;
}) {
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
        <span>{endLabel}</span>
      </div>
    </div>
  );
}

export function ListCard({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <Card className="p-5">
      <p className="text-[17px] tracking-tight text-ink">{title}</p>
      {subtitle && <p className="text-[12px] text-muted">{subtitle}</p>}
      <div className="mt-4">{children}</div>
    </Card>
  );
}

/** Vandrette søjler i én farve: navn og tal i tekstfarver, søjlen bærer størrelsen. */
export function BarList({ rows, empty }: { rows: AdminCount[]; empty: string }) {
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
