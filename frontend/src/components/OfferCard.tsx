import type { OfferDTO, TrustLevel } from '@tilbudsradar/shared';
import { categoryLabel } from '@tilbudsradar/shared';
import clsx from 'clsx';
import { BadgeCheck, CircleHelp, Plus, ShieldAlert, TrendingDown } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { kr, packageSize, pct, unitLabel, validityLabel } from '../lib/format';
import { useAddToList } from '../lib/hooks';
import { CategoryIcon } from '../lib/icons';
import { storeColor } from '../lib/storeColors';
import { IconButton, Pill, StoreDot } from './ui/primitives';

/* ------------------------------------------------------------------ */
/* Billeder                                                           */
/* ------------------------------------------------------------------ */

const CATEGORY_TINT: Record<string, [string, string]> = {
  'kod-fisk': ['#f7b9a8', '#e0573f'],
  mejeri: ['#dfe9f7', '#8fb3e6'],
  'frugt-gront': ['#d9f0b8', '#6cb33c'],
  brod: ['#f6dfb8', '#d59a45'],
  frost: ['#dff1fb', '#79bfe6'],
  kolonial: ['#f3e5c8', '#c49a55'],
  drikkevarer: ['#d6f0f0', '#4fb3b0'],
  snacks: ['#fbd3e2', '#e5578d'],
  husholdning: ['#e2e0fb', '#8a82e6'],
  pleje: ['#f5dcf3', '#c56cc0'],
  baby: ['#fdf0c8', '#e9b63a'],
  dyr: ['#efe1d2', '#a9794f'],
  elektronik: ['#dde3ea', '#5f7488'],
  'bolig-have': ['#e3eed8', '#7b9a55'],
  tekstil: ['#f0e0ea', '#b36a93'],
  andet: ['#e7e7e5', '#9a9a98'],
};

/** Glasagtig "3D-kugle" som i referencens kosttilskudskort – bruges når billedet mangler. */
export function CategoryOrb({ category, className }: { category: string; className?: string }) {
  const [light, dark] = CATEGORY_TINT[category] ?? CATEGORY_TINT.andet!;
  return (
    <div className={clsx('relative flex items-center justify-center', className)}>
      <div
        className="absolute bottom-[8%] h-[16%] w-[62%] rounded-[50%] blur-md"
        style={{ background: dark, opacity: 0.35 }}
      />
      {/* Højden styrer størrelsen, så kuglen aldrig bliver højere end boksen. */}
      <div
        className="relative grid aspect-square h-[82%] max-w-[62%] place-items-center rounded-full"
        style={{
          background: `radial-gradient(circle at 34% 28%, #fff 0%, ${light} 34%, ${dark} 100%)`,
          boxShadow: `inset -6px -8px 16px ${dark}55, inset 6px 6px 14px #ffffff90, 0 10px 24px -12px ${dark}`,
        }}
      >
        <CategoryIcon id={category} className="size-[38%] text-white drop-shadow" />
      </div>
    </div>
  );
}

export function ProductImage({
  src,
  category,
  alt,
  className,
}: {
  src: string | null;
  category: string;
  alt: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) return <CategoryOrb category={category} className={className} />;
  return (
    <div className={clsx('relative flex items-center justify-center', className)}>
      <div className="absolute inset-[12%] rounded-full bg-white/70 blur-xl" />
      {/* max-h/max-w frem for h-full: et grid- eller flex-spor ville ellers
          vokse til billedets egen højde, og høje avisbilleder løb ud af kortet. */}
      <img
        src={src}
        alt={alt}
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className="relative max-h-full max-w-full rounded-xl object-contain mix-blend-multiply"
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Troværdighed                                                       */
/* ------------------------------------------------------------------ */

const TRUST: Record<TrustLevel, { tone: 'real' | 'ok' | 'bad' | 'ghost'; icon: ReactNode }> = {
  real: { tone: 'real', icon: <BadgeCheck className="size-3.5" /> },
  ok: { tone: 'ok', icon: <TrendingDown className="size-3.5" /> },
  inflated: { tone: 'bad', icon: <ShieldAlert className="size-3.5" /> },
  unknown: { tone: 'ghost', icon: <CircleHelp className="size-3.5" /> },
};

export function TrustBadge({ offer, compact }: { offer: OfferDTO; compact?: boolean }) {
  const { level, label, savingsPct } = offer.trust;
  const t = TRUST[level];
  const text =
    compact && level === 'real' && savingsPct
      ? `−${pct(savingsPct)}`
      : compact && level === 'unknown' && offer.discountPct
        ? `−${pct(offer.discountPct)}`
        : label;
  return (
    <Pill tone={t.tone} icon={t.icon} title={offer.trust.explanation}>
      {text}
    </Pill>
  );
}

/* ------------------------------------------------------------------ */
/* Priser                                                             */
/* ------------------------------------------------------------------ */

export function Price({ value, className, size = 'lg' }: { value: number; className?: string; size?: 'md' | 'lg' | 'xl' }) {
  const [whole, dec] = kr(value).split(',');
  return (
    <span
      className={clsx(
        'tabular inline-flex items-baseline tracking-[-0.03em] text-ink',
        size === 'md' && 'text-lg',
        size === 'lg' && 'text-[26px] leading-none',
        size === 'xl' && 'text-[40px] leading-none',
        className,
      )}
    >
      {whole}
      <span className="text-[0.62em]">,{dec}</span>
      <span className="ml-1 text-[0.46em] font-medium tracking-normal text-muted">kr</span>
    </span>
  );
}

export function UnitPrice({ offer, className }: { offer: OfferDTO; className?: string }) {
  if (offer.unitPrice == null) return null;
  const range = offer.unitPriceMax != null && offer.unitPriceMax - offer.unitPrice > 0.5;
  return (
    <span className={clsx('tabular text-xs text-muted', className)}>
      {kr(offer.unitPrice)} kr/{unitLabel(offer.unit)}
      {range && <span className="text-faint"> · max {kr(offer.unitPriceMax)}</span>}
    </span>
  );
}

export function useOpenOffer() {
  const [params, setParams] = useSearchParams();
  return (id: number) => {
    const next = new URLSearchParams(params);
    next.set('tilbud', String(id));
    setParams(next, { preventScrollReset: true });
  };
}

/* ------------------------------------------------------------------ */
/* Kort                                                               */
/* ------------------------------------------------------------------ */

export function OfferCard({ offer, className, rank }: { offer: OfferDTO; className?: string; rank?: number }) {
  const open = useOpenOffer();
  const add = useAddToList();
  const validity = validityLabel(offer.validFrom, offer.validTo);
  const size = packageSize(offer.unit, offer.quantityMin, offer.quantityMax);

  return (
    <article
      className={clsx(
        'group relative flex min-w-0 flex-col rounded-[26px] bg-surface-2 p-4 shadow-soft transition duration-300 hover:-translate-y-0.5 hover:bg-raised hover:shadow-float',
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <TrustBadge offer={offer} compact />
        <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted">
          <StoreDot color={storeColor(offer.store.id)} />
          <span className="truncate">{offer.store.name}</span>
        </span>
      </div>

      <button
        type="button"
        onClick={() => open(offer.id)}
        className="mt-2 flex flex-1 flex-col text-left outline-none"
        aria-label={`Se detaljer for ${offer.title}`}
      >
        <ProductImage
          src={offer.imageUrl}
          category={offer.category}
          alt=""
          className="mx-auto h-[118px] w-full transition duration-500 group-hover:scale-[1.04]"
        />
        <p className="mt-3 line-clamp-2 min-h-[2.4em] text-[12.5px] leading-[1.2] text-muted">
          {rank !== undefined && <span className="mr-1 text-ink">#{rank}</span>}
          {offer.title}
        </p>
        <div className="mt-2 flex items-end justify-between gap-2">
          <div className="min-w-0">
            <Price value={offer.offerPrice} />
            <div className="mt-1 flex flex-wrap items-center gap-x-2">
              <UnitPrice offer={offer} />
              {offer.originalPrice && (
                <span className="tabular text-xs text-faint line-through">{kr(offer.originalPrice)}</span>
              )}
            </div>
          </div>
        </div>
        <div className="mt-2 flex items-center justify-between gap-2 text-[11px]">
          <span className={clsx(validity.upcoming ? 'text-[#5b7a0c]' : validity.endsSoon ? 'text-warn' : 'text-faint')}>
            {validity.text}
          </span>
          <span className="truncate text-faint">{size ?? categoryLabel(offer.category)}</span>
        </div>
      </button>

      <IconButton
        label="Tilføj til indkøbsliste"
        size="sm"
        className="absolute right-3 top-[108px] opacity-0 transition group-hover:opacity-100 focus-visible:opacity-100 max-md:opacity-100"
        onClick={() => add.mutate({ text: offer.title, productId: offer.productId })}
      >
        <Plus className="size-4" />
      </IconButton>
    </article>
  );
}

export function OfferRow({ offer, highlight, action }: { offer: OfferDTO; highlight?: boolean; action?: ReactNode }) {
  const open = useOpenOffer();
  return (
    <div
      className={clsx(
        'flex items-center gap-3 rounded-[20px] p-2 pr-3 transition',
        highlight ? 'bg-lime/40' : 'hover:bg-black/[0.03]',
      )}
    >
      <button type="button" onClick={() => open(offer.id)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        <div className="size-14 shrink-0 rounded-2xl bg-raised p-1.5 shadow-pill">
          <ProductImage src={offer.imageUrl} category={offer.category} alt="" className="size-full" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm text-ink">{offer.title}</p>
          <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted">
            <StoreDot color={storeColor(offer.store.id)} />
            {offer.store.name}
            <span className="text-faint">· {validityLabel(offer.validFrom, offer.validTo).text}</span>
          </p>
        </div>
        <div className="shrink-0 text-right">
          <Price value={offer.offerPrice} size="md" />
          <div>
            <UnitPrice offer={offer} />
          </div>
        </div>
      </button>
      {action}
    </div>
  );
}

export function OfferCardSkeleton() {
  return (
    <div className="flex flex-col gap-3 rounded-[26px] bg-surface-2 p-4">
      <div className="h-6 w-20 shimmer rounded-full" />
      <div className="mx-auto h-[118px] w-3/4 shimmer rounded-full" />
      <div className="h-3 w-full shimmer rounded" />
      <div className="h-7 w-24 shimmer rounded" />
    </div>
  );
}
