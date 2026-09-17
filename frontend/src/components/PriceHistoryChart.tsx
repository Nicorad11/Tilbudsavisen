import type { PriceHistoryResponse } from '@tilbudsradar/shared';
import clsx from 'clsx';
import { Table2, LineChart as LineIcon } from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { kr, unitLabel } from '../lib/format';
import { storeColor } from '../lib/storeColors';
import { IconButton, Pill, StoreDot } from './ui/primitives';

interface Row {
  date: string;
  ts: number;
  [key: string]: number | string | null;
}

const monthFmt = new Intl.DateTimeFormat('da-DK', { month: 'short' });
const dayFmt = new Intl.DateTimeFormat('da-DK', { weekday: 'short', day: 'numeric', month: 'short' });
const SURFACE = '#f6f6f5';

export function PriceHistoryChart({
  history,
  currentUnitPrice,
  highlightStore,
}: {
  history: PriceHistoryResponse;
  currentUnitPrice?: number | null;
  highlightStore?: string;
}) {
  const [asTable, setAsTable] = useState(false);
  const unit = unitLabel(history.product.unit);

  const { rows, stores } = useMemo(() => {
    const byDate = new Map<string, Row>();
    for (const p of history.points) {
      if (p.unitPrice == null) continue;
      const row = byDate.get(p.date) ?? { date: p.date, ts: new Date(p.date).getTime() };
      // Linjen viser dagens laveste enhedspris; tilbudsdage markeres med en prik.
      const cur = row[p.storeId] as number | undefined;
      row[p.storeId] = cur === undefined ? p.unitPrice : Math.min(cur, p.unitPrice);
      if (p.isOffer) row[`${p.storeId}__offer`] = Math.min((row[`${p.storeId}__offer`] as number) ?? Infinity, p.unitPrice);
      byDate.set(p.date, row);
    }
    const sorted = [...byDate.values()].sort((a, b) => a.ts - b.ts);
    // Fast rækkefølge efter kæde-id, så farver aldrig flytter sig ved filtrering.
    const ids = [...new Set(history.points.map((p) => p.storeId))].sort();
    const meta = ids.map((id) => ({ id, name: history.stores.find((s) => s.id === id)?.name ?? id, color: storeColor(id) }));
    return { rows: sorted, stores: meta };
  }, [history]);

  if (rows.length < 2) {
    return (
      <div className="grid h-48 place-items-center rounded-[22px] bg-black/[0.03] px-6 text-center text-sm text-muted">
        Prishistorikken opbygges automatisk ved hver scraping – der er endnu for få målinger til en graf.
      </div>
    );
  }

  const last = rows.length - 1;
  const directLabels = stores.length <= 4;
  // Ét tick pr. månedsskifte, så måneder ikke gentages.
  const monthTicks: number[] = [];
  const cursor = new Date(rows[0]!.ts);
  cursor.setDate(1);
  cursor.setMonth(cursor.getMonth() + 1);
  while (cursor.getTime() <= rows[last]!.ts) {
    monthTicks.push(cursor.getTime());
    cursor.setMonth(cursor.getMonth() + 1);
  }

  return (
    <figure className="relative">
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="text-xs text-muted">kr/{unit}</span>
        {stores.length >= 2 && (
          <ul className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-2" aria-label="Kæder">
            {stores.map((s) => (
              <li key={s.id} className={clsx('flex items-center gap-1.5', highlightStore === s.id && 'font-medium text-ink')}>
                <StoreDot color={s.color} className="ring-0" />
                {s.name}
              </li>
            ))}
          </ul>
        )}
        <span className="flex items-center gap-1.5 text-xs text-muted">
          <span className="inline-block size-2 rounded-full border-2 border-ink-2 bg-surface-2" /> tilbudspris
        </span>
        <span className="flex items-center gap-1.5 text-xs text-muted">
          <span className="inline-block w-4 border-t border-dashed border-ink-2" /> gns. 90 dage
        </span>
        {history.hasSynthetic && (
          <Pill tone="warn" title="Genereret med npm run db:seed-demo – ikke rigtige priser">
            Indeholder demo-data
          </Pill>
        )}
        <IconButton
          label={asTable ? 'Vis som graf' : 'Vis som tabel'}
          size="sm"
          tone="ghost"
          className="ml-auto"
          onClick={() => setAsTable((v) => !v)}
        >
          {asTable ? <LineIcon className="size-4" /> : <Table2 className="size-4" />}
        </IconButton>
      </div>

      {asTable ? (
        <div className="max-h-64 overflow-auto rounded-2xl bg-raised">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-raised text-muted">
              <tr>
                <th className="px-3 py-2 font-medium">Dato</th>
                {stores.map((s) => (
                  <th key={s.id} className="px-3 py-2 text-right font-medium">
                    {s.name} (kr/{unit})
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="tabular">
              {[...rows].reverse().map((r) => (
                <tr key={r.date} className="border-t border-line/60">
                  <td className="px-3 py-1.5 text-ink-2">{dayFmt.format(r.ts)}</td>
                  {stores.map((s) => (
                    <td key={s.id} className="px-3 py-1.5 text-right text-ink">
                      {r[s.id] == null ? '–' : kr(r[s.id] as number)}
                      {r[`${s.id}__offer`] != null && <span className="ml-1 text-muted">tilbud</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="h-60 w-full sm:h-64">
          <ResponsiveContainer>
            <LineChart data={rows} margin={{ top: 8, right: directLabels ? 64 : 12, bottom: 0, left: 0 }}>
              <CartesianGrid vertical={false} stroke="#1a1a1a" strokeOpacity={0.07} />
              <XAxis
                dataKey="ts"
                type="number"
                scale="time"
                domain={['dataMin', 'dataMax']}
                ticks={monthTicks}
                tickFormatter={(v: number) => monthFmt.format(v)}
                tick={{ fill: '#969694', fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                minTickGap={28}
              />
              <YAxis
                width={48}
                tickFormatter={(v: number) => `${Math.round(v)}`}
                tick={{ fill: '#969694', fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                domain={['auto', 'auto']}
              />
              <Tooltip
                cursor={{ stroke: '#1a1a1a', strokeOpacity: 0.25, strokeWidth: 1 }}
                content={(props) => (
                  <ChartTooltip active={props.active} payload={props.payload} label={props.label} stores={stores} unit={unit} />
                )}
              />
              {history.avgUnitPrice90d != null && (
                <ReferenceLine
                  y={history.avgUnitPrice90d}
                  stroke="#4f4f4f"
                  strokeDasharray="4 4"
                  strokeWidth={1}
                  ifOverflow="extendDomain"
                />
              )}
              {currentUnitPrice != null && (
                <ReferenceLine
                  y={currentUnitPrice}
                  stroke="#bfd41a"
                  strokeWidth={1.5}
                  ifOverflow="extendDomain"
                  label={{ value: `nu ${kr(currentUnitPrice)}`, position: 'insideBottomRight', fill: '#4f4f4f', fontSize: 10 }}
                />
              )}
              {stores.map((s) => (
                <Line
                  key={s.id}
                  dataKey={s.id}
                  name={s.name}
                  type="monotone"
                  stroke={s.color}
                  strokeWidth={highlightStore && highlightStore !== s.id ? 1.5 : 2}
                  strokeOpacity={highlightStore && highlightStore !== s.id ? 0.55 : 1}
                  dot={false}
                  activeDot={{ r: 4, stroke: SURFACE, strokeWidth: 2, fill: s.color }}
                  connectNulls
                  isAnimationActive={false}
                  label={
                    directLabels
                      ? (p: { index?: number; x?: number | string; y?: number | string }) =>
                          p.index === lastIndexFor(rows, s.id) ? (
                            <text x={Number(p.x) + 8} y={Number(p.y) + 4} fontSize={11} fill="#4f4f4f">
                              {s.name}
                            </text>
                          ) : (
                            <g />
                          )
                      : undefined
                  }
                />
              ))}
              {stores.map((s) => (
                <Line
                  key={`${s.id}-offer`}
                  dataKey={`${s.id}__offer`}
                  legendType="none"
                  stroke="none"
                  dot={{ r: 4, fill: s.color, stroke: SURFACE, strokeWidth: 2 }}
                  activeDot={false}
                  isAnimationActive={false}
                  tooltipType="none"
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
      <figcaption className="sr-only">
        Enhedspris for {history.product.name} de sidste {Math.round((rows[last]!.ts - rows[0]!.ts) / 86_400_000)} dage
      </figcaption>
    </figure>
  );
}

function lastIndexFor(rows: Row[], key: string): number {
  for (let i = rows.length - 1; i >= 0; i--) if (rows[i]![key] != null) return i;
  return -1;
}

function ChartTooltip({
  active,
  payload,
  label,
  stores,
  unit,
}: {
  active?: boolean;
  payload?: ReadonlyArray<{ payload?: unknown }>;
  label?: string | number;
  stores: { id: string; name: string; color: string }[];
  unit: string;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload as Row | undefined;
  if (!row) return null;
  return (
    <div className="glass min-w-40 rounded-2xl px-3 py-2 text-xs">
      <p className="mb-1 text-muted">{dayFmt.format(Number(label))}</p>
      <ul className="space-y-0.5">
        {stores
          .filter((s) => row[s.id] != null)
          .map((s) => (
            <li key={s.id} className="flex items-center gap-2">
              <StoreDot color={s.color} className="ring-0" />
              <span className="text-ink-2">{s.name}</span>
              <span className="tabular ml-auto text-ink">
                {kr(row[s.id] as number)} kr/{unit}
              </span>
              {row[`${s.id}__offer`] != null && <Pill tone="lime" className="h-4 px-1.5 text-[9px]">tilbud</Pill>}
            </li>
          ))}
      </ul>
    </div>
  );
}
