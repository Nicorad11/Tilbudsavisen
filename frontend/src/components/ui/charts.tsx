import clsx from 'clsx';
import { useId, useMemo } from 'react';

/**
 * Lineal med tynde streger og én fremhævet markør ("Biological age"-kortet og
 * biomarkør-kortene). `value` er 0-1 langs linealen.
 */
export function RulerTicks({
  value,
  count = 36,
  className,
  tone = 'dark',
  height = 36,
}: {
  value: number | null;
  count?: number;
  className?: string;
  tone?: 'dark' | 'light';
  height?: number;
}) {
  const active = value == null ? -1 : Math.round(Math.min(1, Math.max(0, value)) * (count - 1));
  return (
    <div className={clsx('flex items-end justify-between', className)} style={{ height }} aria-hidden>
      {Array.from({ length: count }, (_, i) => {
        const major = i % 5 === 0;
        const isActive = i === active;
        const h = isActive ? height : major ? height * 0.62 : height * 0.36 + ((i * 7) % 5) * 1.5;
        return (
          <span
            key={i}
            className={clsx(
              'rounded-full transition-all duration-700',
              isActive ? 'w-[3px]' : 'w-px',
              tone === 'dark'
                ? isActive
                  ? 'bg-ink'
                  : 'bg-ink/25'
                : isActive
                  ? 'bg-white shadow-[0_0_8px_rgba(255,255,255,.9)]'
                  : 'bg-white/45',
            )}
            style={{ height: h }}
          />
        );
      })}
    </div>
  );
}

/**
 * Søjlediagram af prikker (bunden af "Superpower Score"-kortet). Hver søjle er
 * en kolonne af prikker; den valgte søjle står skarpt, resten er dæmpet.
 */
export function DotBars({
  values,
  highlight,
  rows = 5,
  className,
  tone = 'light',
}: {
  values: number[];
  highlight?: number;
  rows?: number;
  className?: string;
  tone?: 'light' | 'dark';
}) {
  const max = Math.max(1, ...values);
  const cols = values.length;
  const w = cols * 7;
  const h = rows * 7;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className={clsx('w-full', className)} preserveAspectRatio="xMidYMax meet" aria-hidden>
      {values.map((v, c) => {
        const filled = Math.max(1, Math.round((v / max) * rows));
        return Array.from({ length: filled }, (_, r) => {
          const on = highlight === undefined || c === highlight;
          const near = highlight !== undefined && Math.abs(c - highlight) <= 2;
          return (
            <circle
              key={`${c}-${r}`}
              cx={c * 7 + 3.5}
              cy={h - r * 7 - 3.5}
              r={on ? 1.45 : 1.2}
              fill={tone === 'light' ? 'white' : 'currentColor'}
              opacity={on ? 1 : near ? 0.55 : 0.3}
            />
          );
        });
      })}
    </svg>
  );
}

/** Blød bølgelinje med en trekant-markør (næringsstof-kortet i referencen). */
export function WaveSpark({ values, marker, className }: { values: number[]; marker?: number; className?: string }) {
  const path = useMemo(() => {
    if (values.length < 2) return '';
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1;
    const pts = values.map((v, i) => [(i / (values.length - 1)) * 200, 34 - ((v - min) / span) * 26] as const);
    let d = `M ${pts[0]![0]} ${pts[0]![1]}`;
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1]!;
      const [x1, y1] = pts[i]!;
      const cx = (x0 + x1) / 2;
      d += ` C ${cx} ${y0}, ${cx} ${y1}, ${x1} ${y1}`;
    }
    return d;
  }, [values]);
  const mx = marker === undefined ? null : Math.min(1, Math.max(0, marker)) * 200;
  return (
    <svg viewBox="0 0 200 40" className={clsx('w-full overflow-visible', className)} aria-hidden>
      <line x1="0" x2="200" y1="36" y2="36" stroke="currentColor" strokeOpacity="0.12" />
      <path d={path} fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      {mx !== null && <path d={`M ${mx - 4} 6 L ${mx + 4} 6 L ${mx} 12 Z`} fill="currentColor" />}
    </svg>
  );
}

/** Koncentriske ringe – radar-illustrationen på det lyserøde kort. */
export function RadarRings({ className }: { className?: string }) {
  const id = `radar${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  return (
    <svg viewBox="0 0 120 120" className={clsx('overflow-visible', className)} aria-hidden>
      {[52, 40, 28].map((r, i) => (
        <circle key={r} cx="60" cy="60" r={r} fill="none" stroke="white" strokeOpacity={0.35 + i * 0.15} strokeWidth="1" />
      ))}
      <circle cx="60" cy="60" r="16" fill="white" fillOpacity="0.25" />
      <circle cx="60" cy="60" r="9" fill="#e2f33b" />
      <circle cx="60" cy="60" r="4" fill="#ee437c" />
      <g className="origin-center animate-[spin_6s_linear_infinite]" style={{ transformBox: 'view-box' }}>
        <path d="M60 60 L60 8 A52 52 0 0 1 104 34 Z" fill={`url(#${id})`} opacity="0.5" />
      </g>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="white" stopOpacity="0.9" />
          <stop offset="1" stopColor="white" stopOpacity="0" />
        </linearGradient>
      </defs>
    </svg>
  );
}

/** Række af "(((●)))"-pulser under radaren. */
export function PulseRow({ className }: { className?: string }) {
  return (
    <div className={clsx('flex items-center justify-center gap-[3px] text-white', className)} aria-hidden>
      {[5, 4, 3, 2].map((n) => (
        <span key={`l${n}`} className="h-3.5 w-1.5 rounded-l-full border-l border-white" style={{ opacity: 1 - n * 0.14 }} />
      ))}
      <span className="mx-0.5 size-3 rounded-full border border-white bg-white/40" />
      {[2, 3, 4, 5].map((n) => (
        <span key={`r${n}`} className="h-3.5 w-1.5 rounded-r-full border-r border-white" style={{ opacity: 1 - n * 0.14 }} />
      ))}
    </div>
  );
}
