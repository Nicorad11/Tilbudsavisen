import clsx from 'clsx';
import { memo, useMemo } from 'react';

/**
 * Tal tegnet som prikker langs en streg – det gennemgående visuelle greb fra
 * referencedesignet ("70", "106", "103"). Hvert tegn er defineret som
 * polylinjer i et 10×16-gitter; prikkerne placeres med fast afstand langs
 * stregerne, så alle cifre får samme rytme.
 */

type Pt = [number, number];
type Stroke = Pt[];

function arc(cx: number, cy: number, rx: number, ry: number, from: number, to: number, steps = 24): Stroke {
  const pts: Stroke = [];
  for (let i = 0; i <= steps; i++) {
    const a = ((from + ((to - from) * i) / steps) * Math.PI) / 180;
    pts.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
  }
  return pts;
}

const GLYPHS: Record<string, { w: number; strokes: Stroke[] }> = {
  '0': { w: 10, strokes: [arc(5, 8, 4, 7, -90, 270, 44)] },
  '1': { w: 8, strokes: [[[1.4, 3.8], [4.6, 1], [4.6, 15]]] },
  '2': { w: 10, strokes: [[...arc(5, 5, 4, 4, 195, 385, 22), [1.2, 15], [9, 15]]] },
  '3': { w: 10, strokes: [[...arc(5, 4.4, 3.6, 3.4, 205, 450, 20), ...arc(5, 11.3, 4, 3.7, 270, 520, 24)]] },
  '4': { w: 10, strokes: [[[7, 15], [7, 1], [1, 10.8], [9.4, 10.8]]] },
  '5': { w: 10, strokes: [[[8.6, 1], [2.1, 1], [1.6, 7.3], ...arc(5, 10.6, 4.3, 4.4, 228, 515, 26)]] },
  '6': {
    w: 10,
    strokes: [
      [[8.2, 1.9], [6.4, 1.05], [4.3, 1.2], [2.5, 2.8], [1.4, 5.6], [1, 9], [1, 11]],
      arc(5, 11, 4, 4, 180, 540, 28),
    ],
  },
  '7': { w: 10, strokes: [[[1, 1], [9, 1], [3.8, 15]]] },
  '8': { w: 10, strokes: [arc(5, 4.3, 3.4, 3.3, -90, 270, 22), arc(5, 11.3, 4, 3.7, -90, 270, 26)] },
  '9': {
    w: 10,
    strokes: [arc(5, 5, 4, 4, 0, 360, 28), [[9, 5], [8.8, 8.6], [7.6, 11.6], [5.6, 13.9], [3.2, 15]]],
  },
  '%': { w: 11, strokes: [arc(2.8, 3.4, 2, 2.2, 0, 360, 12), [[9.5, 1], [1.5, 15]], arc(8.2, 12.6, 2, 2.2, 0, 360, 12)] },
  '-': { w: 8, strokes: [[[1.5, 8.5], [6.5, 8.5]]] },
  '−': { w: 8, strokes: [[[1.5, 8.5], [6.5, 8.5]]] },
  '–': { w: 8, strokes: [[[1.2, 8.5], [6.8, 8.5]]] },
  '+': { w: 10, strokes: [[[1.5, 8.5], [8.5, 8.5]], [[5, 5], [5, 12]]] },
  ',': { w: 3.2, strokes: [[[1.4, 14.8]], [[1, 16.6]]] },
  '.': { w: 3.2, strokes: [[[1.4, 15]]] },
  ':': { w: 3.2, strokes: [[[1.4, 5.5]], [[1.4, 12.5]]] },
  ' ': { w: 4, strokes: [] },
};

const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);

function sampleStroke(stroke: Stroke, spacing: number, out: Pt[]) {
  if (stroke.length === 1) {
    out.push(stroke[0]!);
    return;
  }
  out.push(stroke[0]!);
  let since = 0;
  for (let i = 1; i < stroke.length; i++) {
    const a = stroke[i - 1]!;
    const b = stroke[i]!;
    const len = dist(a, b);
    if (len < 1e-9) continue;
    let pos = spacing - since;
    while (pos <= len + 1e-9) {
      const t = pos / len;
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      pos += spacing;
    }
    since = len - (pos - spacing);
  }
  const end = stroke[stroke.length - 1]!;
  if (dist(out[out.length - 1]!, end) > spacing * 0.55) out.push(end);
}

const cache = new Map<string, Pt[]>();

function glyphDots(ch: string, spacing: number): Pt[] {
  const key = `${ch}|${spacing}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const raw: Pt[] = [];
  for (const s of GLYPHS[ch]?.strokes ?? []) sampleStroke(s, spacing, raw);
  const dots: Pt[] = [];
  for (const p of raw) if (!dots.some((d) => dist(d, p) < spacing * 0.6)) dots.push(p);
  cache.set(key, dots);
  return dots;
}

function layout(text: string, spacing: number) {
  const dots: Pt[] = [];
  let x = 0;
  const chars = [...text].filter((c) => GLYPHS[c]);
  chars.forEach((ch, i) => {
    for (const [dx, dy] of glyphDots(ch, spacing)) dots.push([x + dx, dy]);
    x += GLYPHS[ch]!.w + (i < chars.length - 1 ? 2.2 : 0);
  });
  return { dots, width: Math.max(x, 1) };
}

export interface DotNumberProps {
  value: string | number;
  /** Højde i px for et ciffer. */
  height?: number;
  className?: string;
  /** Prikradius i gitter-enheder. */
  dot?: number;
  spacing?: number;
  animate?: boolean;
  label?: string;
}

export const DotNumber = memo(function DotNumber({
  value,
  height = 40,
  className,
  dot = 0.62,
  spacing = 1.9,
  animate = true,
  label,
}: DotNumberProps) {
  const text = String(value);
  const { dots, width } = useMemo(() => layout(text, spacing), [text, spacing]);
  const vbW = width + 2;
  const vbH = 18.6;
  return (
    <svg
      role="img"
      aria-label={label ?? text}
      viewBox={`-1 -1 ${vbW} ${vbH}`}
      height={height}
      width={(height * vbW) / vbH}
      className={clsx('inline-block shrink-0 overflow-visible', className)}
    >
      {dots.map(([x, y], i) => (
        <circle
          key={`${text}-${i}`}
          cx={x}
          cy={y}
          r={dot}
          fill="currentColor"
          className={animate ? 'animate-dot-in' : undefined}
          style={
            animate
              ? { animationDelay: `${Math.min(i * 7, 600)}ms`, transformBox: 'fill-box', transformOrigin: 'center' }
              : undefined
          }
        />
      ))}
    </svg>
  );
});
