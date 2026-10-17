import { Suspense } from 'react';
import { PLAN } from '@tilbudsradar/shared';
import { Outlet, NavLink, Link } from 'react-router';
import clsx from 'clsx';
import { useAccess, useLaunch } from '../../lib/access';
import { useSeo } from '../../lib/seo';
import { Button } from '../ui/primitives';
import { Footer } from './Footer';
import { Wordmark } from './Wordmark';

/** Layout til de offentlige sider: landingsside, priser og juridiske sider. */
export function PublicLayout() {
  useSeo();
  const { isMember } = useAccess();
  const launch = useLaunch();
  const nav = ({ isActive }: { isActive: boolean }) =>
    clsx('hidden h-9 items-center rounded-full px-3.5 text-[13.5px] transition sm:flex', isActive ? 'bg-raised text-ink shadow-pill' : 'text-ink-2 hover:text-ink');

  return (
    <div className="mx-auto flex min-h-dvh max-w-[1180px] flex-col px-4 sm:px-6">
      <header className="sticky top-0 z-30 -mx-4 flex items-center gap-2 bg-canvas/85 px-4 py-3 backdrop-blur-md sm:-mx-6 sm:px-6">
        <Wordmark to="/" />
        <nav className="ml-auto flex items-center gap-1" aria-label="Hovedmenu">
          <NavLink to="/app/sog" className={nav}>
            Søg tilbud
          </NavLink>
          <NavLink to="/priser" className={nav}>
            Priser
          </NavLink>
          {isMember ? (
            <Link to="/app">
              <Button tone="dark" size="sm">
                Åbn appen
              </Button>
            </Link>
          ) : (
            <>
              <NavLink to="/app/konto" className={({ isActive }) => clsx('flex h-9 items-center rounded-full px-3.5 text-[13.5px] transition', isActive ? 'text-ink' : 'text-ink-2 hover:text-ink')}>
                Log ind
              </NavLink>
              <Link to="/app/konto?opret=1">
                <Button tone="dark" size="sm">
                  {launch ? (
                    <span>
                      Opret<span className="hidden sm:inline"> gratis</span> konto
                    </span>
                  ) : (
                    <span>
                      Prøv gratis<span className="hidden sm:inline"> i {PLAN.trialDays} dage</span>
                    </span>
                  )}
                </Button>
              </Link>
            </>
          )}
        </nav>
      </header>
      <main className="flex-1">
        <Suspense fallback={<div className="min-h-[70vh]" />}>
          <Outlet />
        </Suspense>
      </main>
      <Footer className="mt-16" />
    </div>
  );
}
