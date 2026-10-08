import { BadgeCheck, BellRing } from 'lucide-react';
import { storeColor } from '../../lib/storeColors';
import { CategoryOrb } from '../OfferCard';
import { Pill } from '../ui/primitives';

/** Eksempel på billigste tilbud pr. kæde – samme visning som i appen (uge 41, 2026). */
const ROWS = [
  { id: 'bilka', name: 'Bilka', kgPrice: 61.76 },
  { id: 'rema1000', name: 'REMA 1000', kgPrice: 62.5 },
  { id: 'foetex', name: 'føtex', kgPrice: 69.41 },
  { id: 'lidl', name: 'Lidl', kgPrice: 74.88 },
  { id: 'netto', name: 'Netto', kgPrice: 87.5 },
];
const MAX = Math.max(...ROWS.map((r) => r.kgPrice));
const fmt = (n: number) => n.toLocaleString('da-DK', { minimumFractionDigits: 2 });

/** Grafikken i landingssidens hero: kilopris på tværs af kæder, "reelt tilbud" og en prisalarm. */
export function HeroVisual() {
  return (
    <div className="relative mx-auto w-full max-w-[460px] pb-10 lg:pb-0" aria-hidden>
      <div className="rounded-[32px] bg-raised p-5 shadow-[0_40px_80px_-40px_rgba(0,0,0,0.35)] sm:p-6">
        <div className="flex items-center gap-3">
          <CategoryOrb category="kod-fisk" className="size-14" />
          <div>
            <p className="text-[19px] leading-tight tracking-[-0.03em] text-ink">Hakket oksekød</p>
            <p className="text-[12.5px] text-muted">kr/kg · billigste tilbud pr. kæde</p>
          </div>
        </div>
        <div className="mt-5 space-y-2.5">
          {ROWS.map((r, i) => (
            <div key={r.id} className="flex items-center gap-3">
              <span className="flex w-[92px] shrink-0 items-center gap-2 text-[13px] text-ink-2">
                <span className="size-2 rounded-full" style={{ background: storeColor(r.id) }} />
                {r.name}
              </span>
              <span className="relative h-7 flex-1 rounded-full bg-black/[0.05]">
                <span
                  className={`absolute inset-y-0 left-0 flex items-center rounded-full pl-3 text-[11px] font-medium ${i === 0 ? 'bg-lime text-ink' : 'bg-ink/15'}`}
                  style={{ width: `${(r.kgPrice / MAX) * 100}%` }}
                >
                  {i === 0 ? 'Billigst' : ''}
                </span>
              </span>
              <span className={`tabular w-14 shrink-0 text-right text-[13.5px] ${i === 0 ? 'font-semibold text-ink' : 'text-ink-2'}`}>{fmt(r.kgPrice)}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="glass absolute -bottom-2 left-3 flex items-center gap-2.5 rounded-full px-4 py-2.5 sm:-left-6 lg:-bottom-6">
        <Pill tone="lime" icon={<BadgeCheck className="size-3.5" />}>
          Reelt tilbud
        </Pill>
        <span className="text-[13px] text-ink-2">18 % under 90-dages gns.</span>
      </div>

      <div className="glass absolute -top-10 right-0 hidden max-w-[250px] items-start gap-3 rounded-[22px] p-3 sm:flex lg:-right-4">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-lime">
          <BellRing className="size-4" strokeWidth={1.7} />
        </span>
        <span className="text-[12.5px] leading-snug text-ink-2">
          <span className="block font-medium text-ink">Prisalarm</span>
          “kaffe” er på tilbud til 39,95 kr hos Lidl
        </span>
      </div>
    </div>
  );
}
