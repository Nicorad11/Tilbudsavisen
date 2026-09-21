import { VISIBLE_CATEGORIES } from '@tilbudsradar/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import {
  Bell,
  Home,
  ListChecks,
  Plus,
  Radar,
  ReceiptText,
  Search,
  ShoppingCart,
  User,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate, useSearchParams } from 'react-router';
import { authed } from '../../lib/api';
import { relativeTime } from '../../lib/format';
import { useCategoryCounts, useLists, useNotifications, useWatches } from '../../lib/hooks';
import { CATEGORY_ICONS } from '../../lib/icons';
import { useAuth, usePrefs, useUi } from '../../lib/store';
import { OfferDrawer } from '../OfferDrawer';
import { DotNumber } from '../ui/DotNumber';
import { Button, IconButton, Pill } from '../ui/primitives';

const NAV = [
  { to: '/', label: 'Oversigt', icon: Home },
  { to: '/sog', label: 'Søg', icon: Search },
  { to: '/lister', label: 'Lister', icon: ListChecks },
  { to: '/kvitteringer', label: 'Kvitteringer', short: 'Kvittering', icon: ReceiptText },
  { to: '/alarmer', label: 'Alarmer', icon: Bell },
  { to: '/kilder', label: 'Kilder', icon: Radar },
];

export function Wordmark({ className }: { className?: string }) {
  return (
    <Link to="/" className={clsx('inline-flex items-center gap-2 text-[17px] font-semibold tracking-[-0.04em] text-ink', className)}>
      <span className="relative grid size-6 place-items-center rounded-[8px] bg-ink">
        <span className="absolute size-3.5 rounded-full border border-white/50" />
        <span className="size-1.5 rounded-full bg-lime" />
      </span>
      tilbudsradar
    </Link>
  );
}

function SidebarItem({
  active,
  icon,
  label,
  count,
  onClick,
  onClear,
}: {
  active?: boolean;
  icon: ReactNode;
  label: string;
  count?: ReactNode;
  onClick: () => void;
  onClear?: () => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        onClick={onClick}
        className={clsx(
          'flex h-12 min-w-0 flex-1 items-center gap-3 rounded-full pr-2 pl-4 text-left text-[14px] transition',
          active ? 'bg-raised text-ink shadow-pill' : 'text-ink-2 hover:bg-black/[0.035] hover:text-ink',
        )}
      >
        <span className={clsx('shrink-0', active ? 'text-ink' : 'text-muted')}>{icon}</span>
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {count !== undefined && (
          <span className="tabular rounded-full bg-raised px-2 py-1 text-[10.5px] text-muted shadow-pill">{count}</span>
        )}
      </button>
      {onClear && (
        <IconButton label="Nulstil" size="md" onClick={onClear}>
          <X className="size-4" />
        </IconButton>
      )}
    </div>
  );
}

function Sidebar() {
  const [tab, setTab] = useState<'tilbud' | 'lister'>('tilbud');
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const counts = useCategoryCounts();
  const token = useAuth((s) => s.accessToken);
  const lists = useLists(Boolean(token));
  const { activeListId, setActiveList } = usePrefs();
  const activeCategory = location.pathname === '/sog' ? params.get('kategori') : null;
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  const [promoHidden, setPromoHidden] = useState(() => {
    try {
      return localStorage.getItem('tilbudsradar:promo') === 'skjult';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    if (location.pathname.startsWith('/lister')) setTab('lister');
  }, [location.pathname]);

  const categories = VISIBLE_CATEGORIES.filter((c) => (counts.get(c.id) ?? 0) > 0 || counts.size === 0);

  return (
    <aside className="sticky top-0 hidden h-dvh w-[292px] shrink-0 flex-col px-5 pt-7 pb-5 lg:flex">
      <Wordmark className="px-2" />
      <div className="mt-9 flex items-baseline gap-5 px-2" role="tablist">
        {(['tilbud', 'lister'] as const).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={clsx('text-[28px] leading-none tracking-[-0.035em] transition', tab === t ? 'text-ink' : 'text-faint hover:text-muted')}
          >
            {t === 'tilbud' ? 'Tilbud' : 'Lister'}
          </button>
        ))}
      </div>

      <nav className="no-scrollbar mt-6 -mx-1 flex-1 space-y-1 overflow-y-auto px-1 pb-4">
        {tab === 'tilbud' ? (
          <>
            <SidebarItem
              active={!activeCategory}
              icon={(() => {
                const I = CATEGORY_ICONS.alle;
                return <I className="size-[18px]" strokeWidth={1.5} />;
              })()}
              label="Alle tilbud"
              count={total ? total.toLocaleString('da-DK') : undefined}
              onClick={() => navigate('/sog')}
              onClear={activeCategory ? () => navigate('/sog') : undefined}
            />
            {categories.map((c) => {
              const Icon = CATEGORY_ICONS[c.id];
              return (
                <SidebarItem
                  key={c.id}
                  active={activeCategory === c.id}
                  icon={<Icon className="size-[18px]" strokeWidth={1.5} />}
                  label={c.label}
                  count={counts.get(c.id)?.toLocaleString('da-DK')}
                  onClick={() => navigate(`/sog?kategori=${c.id}`)}
                />
              );
            })}
          </>
        ) : (
          <>
            {!token && (
              <p className="px-3 py-2 text-sm text-muted">Dine indkøbslister gemmes, så snart du opretter den første.</p>
            )}
            {lists.data?.map((l) => (
              <SidebarItem
                key={l.id}
                active={location.pathname.startsWith('/lister') && activeListId === l.id}
                icon={<ShoppingCart className="size-[18px]" strokeWidth={1.5} />}
                label={l.name}
                count={`${l.itemCount} varer`}
                onClick={() => {
                  setActiveList(l.id);
                  navigate('/lister');
                }}
              />
            ))}
            <SidebarItem
              icon={<Plus className="size-[18px]" strokeWidth={1.5} />}
              label="Ny liste"
              onClick={() => navigate('/lister?ny=1')}
            />
          </>
        )}
      </nav>

      {!promoHidden && <PromoCard onHide={() => {
        setPromoHidden(true);
        try {
          localStorage.setItem('tilbudsradar:promo', 'skjult');
        } catch {
          /* valgfrit */
        }
      }} />}
    </aside>
  );
}

function PromoCard({ onHide }: { onHide: () => void }) {
  const token = useAuth((s) => s.accessToken);
  const watches = useWatches(Boolean(token));
  const count = token ? (watches.data?.length ?? 0) : 0;
  return (
    <div className="card relative mt-2 p-4">
      <Pill tone="lime">Prisalarm</Pill>
      <IconButton label="Skjul" size="sm" className="absolute top-3 right-3" onClick={onHide}>
        <X className="size-3.5" />
      </IconButton>
      <p className="mt-3 text-[15px] leading-snug tracking-tight text-ink">Få besked når prisen falder</p>
      <p className="mt-1 text-[12px] leading-snug text-muted">Følg dine faste varer – vi holder øje med alle aviser.</p>
      <div className="mt-3 flex items-end justify-between">
        <div className="flex items-baseline gap-1.5 text-ink">
          <DotNumber value={count} height={26} animate={false} />
          <span className="text-[11px] text-muted">følger</span>
        </div>
        <Link to="/alarmer">
          <Button size="sm">Prøv det</Button>
        </Link>
      </div>
    </div>
  );
}

function NotificationsButton() {
  const token = useAuth((s) => s.accessToken);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const qc = useQueryClient();
  const notes = useNotifications(Boolean(token));
  const unread = notes.data?.filter((n) => !n.readAt).length ?? 0;
  const [params, setParams] = useSearchParams();
  const markRead = useMutation({
    mutationFn: () => authed('/notifications/read', { method: 'POST', body: {} }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['notifications'] }),
  });

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <IconButton
        label="Notifikationer"
        className="relative"
        onClick={() => {
          setOpen((v) => !v);
          if (!open && unread) markRead.mutate();
        }}
      >
        <Bell className="size-[18px]" strokeWidth={1.6} />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 grid size-4 place-items-center rounded-full bg-lime text-[9px] font-semibold text-ink">
            {unread}
          </span>
        )}
      </IconButton>
      {open && (
        <div className="glass absolute right-0 z-40 mt-2 w-80 animate-rise rounded-[24px] p-2">
          <p className="px-3 pt-2 pb-1 text-sm text-ink">Prisalarmer</p>
          {!notes.data?.length ? (
            <p className="px-3 pb-3 text-[13px] text-muted">Ingen notifikationer endnu. Opret en prisalarm på et tilbud.</p>
          ) : (
            <ul className="max-h-80 overflow-y-auto">
              {notes.data.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    className="w-full rounded-2xl px-3 py-2 text-left hover:bg-white/60"
                    onClick={() => {
                      if (n.offerId) {
                        const next = new URLSearchParams(params);
                        next.set('tilbud', String(n.offerId));
                        setParams(next);
                      }
                      setOpen(false);
                    }}
                  >
                    <p className={clsx('text-[13px] leading-snug', n.readAt ? 'text-ink-2' : 'text-ink')}>{n.message}</p>
                    <p className="mt-0.5 text-[11px] text-muted">{relativeTime(n.createdAt)}</p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function TopBar() {
  const token = useAuth((s) => s.accessToken);
  const lists = useLists(Boolean(token));
  const itemCount = token ? (lists.data?.reduce((s, l) => s + l.itemCount, 0) ?? 0) : 0;
  return (
    <header className="sticky top-0 z-30 flex items-center gap-3 bg-canvas/80 px-4 py-3 backdrop-blur-md sm:px-6 lg:-mx-3 lg:px-3 lg:pt-5 lg:pb-3">
      <Wordmark className="lg:hidden" />
      <nav className="mx-auto hidden rounded-full bg-black/[0.045] p-1 md:flex" aria-label="Hovedmenu">
        {NAV.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.to === '/'}
            className={({ isActive }) =>
              clsx(
                'flex h-8 items-center rounded-full px-3.5 text-[13px] font-medium transition',
                isActive ? 'bg-raised text-ink shadow-pill' : 'text-muted hover:text-ink',
              )
            }
          >
            {n.label}
          </NavLink>
        ))}
      </nav>
      <div className="ml-auto flex items-center gap-2 md:ml-0">
        <NotificationsButton />
        <Link to="/lister" aria-label="Indkøbslister" className="relative">
          <IconButton label="Indkøbslister" tabIndex={-1}>
            <ShoppingCart className="size-[18px]" strokeWidth={1.6} />
          </IconButton>
          {itemCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-ink px-1 text-[9px] font-semibold text-white">
              {itemCount}
            </span>
          )}
        </Link>
        <Link to="/konto" aria-label="Konto">
          <IconButton label="Konto" tabIndex={-1}>
            <User className="size-[18px]" strokeWidth={1.6} />
          </IconButton>
        </Link>
      </div>
    </header>
  );
}

function MobileNav() {
  return (
    <nav
      className="glass fixed inset-x-3 bottom-3 z-40 flex justify-around rounded-full px-2 py-1.5 md:hidden"
      style={{ paddingBottom: 'max(0.375rem, env(safe-area-inset-bottom))' }}
      aria-label="Menu"
    >
      {NAV.slice(0, 5).map((n) => (
        <NavLink
          key={n.to}
          to={n.to}
          end={n.to === '/'}
          className={({ isActive }) =>
            clsx(
              'flex w-14 flex-col items-center gap-0.5 rounded-full py-1 text-[10px] transition',
              isActive ? 'text-ink' : 'text-muted',
            )
          }
        >
          {({ isActive }) => (
            <>
              <span className={clsx('grid h-7 w-10 place-items-center rounded-full', isActive && 'bg-lime')}>
                <n.icon className="size-[18px]" strokeWidth={1.6} />
              </span>
              {n.short ?? n.label}
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}

function Toast() {
  const toast = useUi((s) => s.toast);
  if (!toast) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-24 z-[60] flex justify-center px-4 md:bottom-8">
      <div
        key={toast.id}
        role="status"
        className={clsx(
          'glass animate-rise rounded-full px-5 py-3 text-sm',
          toast.tone === 'error' ? 'text-bad' : 'text-ink',
        )}
      >
        {toast.text}
      </div>
    </div>
  );
}

export function AppShell() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [pathname]);

  return (
    <div className="mx-auto flex min-h-dvh max-w-[1560px]">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col lg:pr-6">
        <TopBar />
        <main className="flex-1 px-4 pb-28 sm:px-6 md:pb-12 lg:px-0">
          <Outlet />
        </main>
      </div>
      <MobileNav />
      <OfferDrawer />
      <Toast />
    </div>
  );
}
