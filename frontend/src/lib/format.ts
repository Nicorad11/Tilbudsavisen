import type { BaseUnit } from '@tilbudsradar/shared';

const krFormatter = new Intl.NumberFormat('da-DK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const intFormatter = new Intl.NumberFormat('da-DK');

export const kr = (n: number | null | undefined) => (n == null ? '–' : krFormatter.format(n));
export const krShort = (n: number | null | undefined) =>
  n == null ? '–' : Number.isInteger(n) ? intFormatter.format(n) : krFormatter.format(n);
export const int = (n: number | null | undefined) => (n == null ? '–' : intFormatter.format(Math.round(n)));
export const pct = (n: number | null | undefined, digits = 0) =>
  n == null ? '–' : `${n.toLocaleString('da-DK', { maximumFractionDigits: digits })}%`;

export const unitLabel = (unit: BaseUnit) => (unit === 'stk' ? 'stk' : unit);

export function packageSize(unit: BaseUnit, min: number | null, max: number | null): string | null {
  if (min == null) return null;
  const fmt = (v: number) => {
    if (unit === 'kg') return v < 1 ? `${Math.round(v * 1000)} g` : `${krShort(Math.round(v * 100) / 100)} kg`;
    if (unit === 'l') return v < 1 ? `${Math.round(v * 100)} cl` : `${krShort(Math.round(v * 100) / 100)} l`;
    return `${krShort(v)} stk`;
  };
  if (unit === 'stk' && min === 1 && (max ?? 1) === 1) return null;
  if (max != null && Math.abs(max - min) > 1e-6) {
    const a = fmt(min);
    const b = fmt(max);
    const [na, ua] = a.split(' ');
    const [nb, ub] = b.split(' ');
    return ua === ub ? `${na}–${nb} ${ua}` : `${a}–${b}`;
  }
  return fmt(min);
}

const dayFmt = new Intl.DateTimeFormat('da-DK', { weekday: 'short', day: 'numeric', month: 'short' });
const shortDay = new Intl.DateTimeFormat('da-DK', { weekday: 'short' });
const dateFmt = new Intl.DateTimeFormat('da-DK', { day: 'numeric', month: 'short' });
const timeFmt = new Intl.DateTimeFormat('da-DK', { hour: '2-digit', minute: '2-digit' });

export const formatDay = (iso: string) => dayFmt.format(new Date(iso));
export const formatDate = (iso: string) => dateFmt.format(new Date(iso));
export const formatTime = (iso: string) => timeFmt.format(new Date(iso));

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** "til og med søn." / "fra fre." / "i dag" */
export function validityLabel(from: string, to: string, now = new Date()): { text: string; upcoming: boolean; endsSoon: boolean } {
  const start = new Date(from);
  // Tjek angiver slut som 21:59:59 UTC – det er dagen før i dansk tid kl. 23:59.
  const end = new Date(new Date(to).getTime() - 1000);
  if (start.getTime() > now.getTime()) {
    const days = Math.round((startOfDay(start) - startOfDay(now)) / 86_400_000);
    return { text: days <= 1 ? 'fra i morgen' : `fra ${shortDay.format(start)}`, upcoming: true, endsSoon: false };
  }
  const daysLeft = Math.round((startOfDay(end) - startOfDay(now)) / 86_400_000);
  if (daysLeft <= 0) return { text: 'sidste dag i dag', upcoming: false, endsSoon: true };
  if (daysLeft === 1) return { text: 'til og med i morgen', upcoming: false, endsSoon: true };
  if (daysLeft > 60) return { text: 'fast lav pris', upcoming: false, endsSoon: false };
  return { text: `til og med ${shortDay.format(end)}`, upcoming: false, endsSoon: false };
}

export function relativeTime(iso: string | null, now = Date.now()): string {
  if (!iso) return 'aldrig';
  const diff = Math.round((now - new Date(iso).getTime()) / 1000);
  if (diff < 45) return 'lige nu';
  if (diff < 3600) return `${Math.round(diff / 60)} min. siden`;
  if (diff < 86_400) return `${Math.round(diff / 3600)} t. siden`;
  const days = Math.round(diff / 86_400);
  return days === 1 ? 'i går' : `${days} dage siden`;
}

export function greeting(now = new Date()): string {
  const h = now.getHours();
  if (h < 5) return 'God nat';
  if (h < 10) return 'God morgen';
  if (h < 12) return 'God formiddag';
  if (h < 18) return 'God eftermiddag';
  return 'God aften';
}
