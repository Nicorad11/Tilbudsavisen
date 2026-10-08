import clsx from 'clsx';
import { Link } from 'react-router';

export function Wordmark({ className, to = '/' }: { className?: string; to?: string }) {
  return (
    <Link to={to} className={clsx('inline-flex items-center gap-2 text-[17px] font-semibold tracking-[-0.04em] text-ink', className)}>
      <span className="relative grid size-6 place-items-center rounded-[8px] bg-ink">
        <span className="absolute size-3.5 rounded-full border border-white/50" />
        <span className="size-1.5 rounded-full bg-lime" />
      </span>
      tilbudsradar
    </Link>
  );
}
