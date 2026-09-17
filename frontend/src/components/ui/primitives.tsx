import clsx from 'clsx';
import { Info, Loader2, X } from 'lucide-react';
import {
  forwardRef,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
} from 'react';

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={clsx('card', className)} {...props} />;
}

type PillTone = 'lime' | 'white' | 'ghost' | 'dark' | 'real' | 'ok' | 'warn' | 'bad' | 'glass';

const PILL_TONES: Record<PillTone, string> = {
  lime: 'bg-lime text-ink',
  white: 'bg-raised text-ink-2 shadow-pill',
  ghost: 'bg-black/[0.045] text-ink-2',
  dark: 'bg-ink text-white',
  real: 'bg-lime text-ink',
  ok: 'bg-[#e9f3d6] text-[#4d6b14]',
  warn: 'bg-[#fbe6cf] text-[#8a4a0b]',
  bad: 'bg-[#f9dcd7] text-[#8f2a1d]',
  glass: 'bg-white/25 text-white backdrop-blur-md ring-1 ring-white/40',
};

export function Pill({
  tone = 'white',
  className,
  children,
  icon,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: PillTone; icon?: ReactNode }) {
  return (
    <span
      className={clsx(
        'inline-flex h-6 items-center gap-1 rounded-full px-2.5 text-[11px] leading-none font-medium whitespace-nowrap',
        PILL_TONES[tone],
        className,
      )}
      {...props}
    >
      {icon}
      {children}
    </span>
  );
}

export const IconButton = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { label: string; size?: 'sm' | 'md' | 'lg'; tone?: 'white' | 'ghost' | 'dark' | 'glass' }
>(function IconButton({ label, size = 'md', tone = 'white', className, children, ...props }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      title={label}
      className={clsx(
        'inline-grid shrink-0 place-items-center rounded-full transition active:scale-95 disabled:opacity-40',
        size === 'sm' && 'size-8',
        size === 'md' && 'size-10',
        size === 'lg' && 'size-12',
        tone === 'white' && 'bg-raised text-ink shadow-pill hover:bg-white',
        tone === 'ghost' && 'text-ink-2 hover:bg-black/5',
        tone === 'dark' && 'bg-ink text-white hover:bg-black',
        tone === 'glass' && 'bg-white/30 text-white ring-1 ring-white/50 backdrop-blur-md hover:bg-white/40',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
});

type ButtonTone = 'dark' | 'white' | 'lime' | 'ghost' | 'danger';

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { tone?: ButtonTone; size?: 'sm' | 'md' | 'lg'; loading?: boolean; icon?: ReactNode }
>(function Button({ tone = 'white', size = 'md', loading, icon, className, children, disabled, ...props }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      disabled={disabled || loading}
      className={clsx(
        'inline-flex shrink-0 items-center justify-center gap-2 rounded-full font-medium whitespace-nowrap transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50',
        size === 'sm' && 'h-8 px-3.5 text-[13px]',
        size === 'md' && 'h-10 px-5 text-sm',
        size === 'lg' && 'h-12 px-6 text-[15px]',
        tone === 'dark' && 'bg-ink text-white hover:bg-black',
        tone === 'white' && 'bg-raised text-ink shadow-pill hover:bg-white',
        tone === 'lime' && 'bg-lime text-ink hover:bg-[#d9ec2a]',
        tone === 'ghost' && 'text-ink-2 hover:bg-black/5',
        tone === 'danger' && 'bg-[#f9dcd7] text-[#8f2a1d] hover:bg-[#f5cbc3]',
        className,
      )}
      {...props}
    >
      {loading ? <Loader2 className="size-4 animate-spin" /> : icon}
      {children}
    </button>
  );
});

export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  className,
  size = 'md',
}: {
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange: (v: T) => void;
  className?: string;
  size?: 'sm' | 'md';
}) {
  return (
    <div
      role="radiogroup"
      className={clsx('inline-flex rounded-full bg-black/[0.05] p-1', size === 'sm' ? 'gap-0.5' : 'gap-1', className)}
    >
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
          className={clsx(
            'rounded-full font-medium whitespace-nowrap transition',
            size === 'sm' ? 'h-7 px-3 text-xs' : 'h-8 px-3.5 text-[13px]',
            o.value === value ? 'bg-raised text-ink shadow-pill' : 'text-muted hover:text-ink',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={clsx(
        'relative h-6 w-10 shrink-0 rounded-full transition disabled:opacity-40',
        checked ? 'bg-ink' : 'bg-black/15',
      )}
    >
      <span
        className={clsx(
          'absolute top-0.5 size-5 rounded-full shadow transition-all',
          checked ? 'left-[18px] bg-lime' : 'left-0.5 bg-white',
        )}
      />
    </button>
  );
}

export const TextInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { icon?: ReactNode }>(
  function TextInput({ className, icon, ...props }, ref) {
    return (
      <label
        className={clsx(
          'flex h-11 items-center gap-2 rounded-full bg-raised px-4 shadow-pill ring-ink/80 focus-within:ring-2',
          className,
        )}
      >
        {icon && <span className="text-muted">{icon}</span>}
        <input
          ref={ref}
          className="h-full w-full min-w-0 bg-transparent text-[15px] text-ink outline-none placeholder:text-faint"
          {...props}
        />
      </label>
    );
  },
);

export function Chip({
  active,
  onClick,
  children,
  color,
  onRemove,
}: {
  active?: boolean;
  onClick?: () => void;
  children: ReactNode;
  color?: string;
  onRemove?: () => void;
}) {
  return (
    <span
      className={clsx(
        'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full text-[13px] transition',
        active ? 'bg-ink text-white' : 'bg-raised text-ink-2 shadow-pill hover:text-ink',
      )}
    >
      <button type="button" onClick={onClick} aria-pressed={active} className="inline-flex h-full items-center gap-1.5 pl-3 pr-3">
        {color && <span className="size-2 rounded-full" style={{ background: color }} />}
        {children}
      </button>
      {onRemove && (
        <button type="button" onClick={onRemove} aria-label="Fjern" className="-ml-2 mr-1 grid size-6 place-items-center rounded-full hover:bg-white/15">
          <X className="size-3" />
        </button>
      )}
    </span>
  );
}

/**
 * Lille "i" der forklarer et tal. Vises ved hover og ved fokus, så den også
 * kan åbnes med tastatur og på touch. Teksten ligger i aria-label, fordi
 * boblen er dekorativ for skærmlæsere.
 */
export function InfoTip({
  label,
  text,
  tone = 'default',
  className,
  tipClassName = 'left-1/2 -translate-x-1/2',
}: {
  label: string;
  text: string;
  tone?: 'default' | 'onDark';
  className?: string;
  /** Placering af boblen, fx 'right-0' når ikonet står tæt på skærmkanten. */
  tipClassName?: string;
}) {
  return (
    <span className={clsx('group/tip relative inline-flex', className)}>
      <button
        type="button"
        aria-label={`${label}: ${text}`}
        className={clsx(
          'grid size-4 place-items-center rounded-full transition focus-visible:outline-none',
          tone === 'onDark' ? 'text-white/70 hover:text-white focus-visible:text-white' : 'text-faint hover:text-ink focus-visible:text-ink',
        )}
      >
        <Info className="size-3.5" strokeWidth={1.8} />
      </button>
      <span
        aria-hidden
        className={clsx(
          // whitespace-normal: pillerne omkring tallene sætter nowrap, som ellers arves hertil.
          'pointer-events-none absolute bottom-full z-40 mb-2 w-56 max-w-[calc(100vw-2rem)] rounded-2xl bg-ink px-3 py-2 text-left text-[11.5px] leading-snug font-normal whitespace-normal text-white/95 opacity-0 shadow-float transition group-focus-within/tip:opacity-100 group-hover/tip:opacity-100',
          tipClassName,
        )}
      >
        <span className="block font-medium text-white">{label}</span>
        {text}
      </span>
    </span>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx('shimmer rounded-2xl', className)} />;
}

export function EmptyState({
  icon,
  title,
  children,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={clsx('flex flex-col items-center gap-3 px-6 py-12 text-center', className)}>
      {icon && <div className="grid size-14 place-items-center rounded-full bg-raised text-muted shadow-pill">{icon}</div>}
      <h3 className="text-lg tracking-tight text-ink">{title}</h3>
      {children && <div className="max-w-sm text-sm text-muted">{children}</div>}
      {action}
    </div>
  );
}

export function SectionHeader({
  title,
  subtitle,
  action,
  className,
}: {
  title: string;
  subtitle?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={clsx('flex items-end justify-between gap-4', className)}>
      <div className="min-w-0">
        <h2 className="text-[22px] leading-tight tracking-[-0.02em] text-ink sm:text-2xl">{title}</h2>
        {subtitle && <p className="mt-1 text-[13px] text-muted">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function StoreDot({ color, className }: { color: string; className?: string }) {
  return <span className={clsx('inline-block size-2 shrink-0 rounded-full ring-2 ring-white', className)} style={{ background: color }} />;
}
