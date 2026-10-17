import { Compass } from 'lucide-react';
import { lazy, Suspense, type ComponentType } from 'react';
import { Link, Navigate, Route, Routes, useLocation, useParams } from 'react-router';
import { PublicLayout } from './components/layout/PublicLayout';
import { PageViewTracker } from './components/PageViewTracker';
import { Button, EmptyState } from './components/ui/primitives';
import { Landing } from './pages/Landing';

/** Forsiden indlæses med det samme; resten hentes, når siden besøges. */
function page<M>(load: () => Promise<M>, name: keyof M) {
  return lazy(async () => ({ default: (await load())[name] as ComponentType }));
}

const AppShell = page(() => import('./components/layout/AppShell'), 'AppShell');
const Dashboard = page(() => import('./pages/Dashboard'), 'Dashboard');
const Search = page(() => import('./pages/Search'), 'Search');
const Lists = page(() => import('./pages/Lists'), 'Lists');
const Receipts = page(() => import('./pages/Receipts'), 'Receipts');
const Alerts = page(() => import('./pages/Alerts'), 'Alerts');
const Sources = page(() => import('./pages/Sources'), 'Sources');
const Account = page(() => import('./pages/Account'), 'Account');
const ResetPassword = page(() => import('./pages/AccountFlows'), 'ResetPassword');
const VerifyEmail = page(() => import('./pages/AccountFlows'), 'VerifyEmail');
const CheckoutSuccess = page(() => import('./pages/AccountFlows'), 'CheckoutSuccess');
const CheckoutCanceled = page(() => import('./pages/AccountFlows'), 'CheckoutCanceled');
const Pricing = page(() => import('./pages/Pricing'), 'Pricing');
const Terms = page(() => import('./pages/legal/Terms'), 'Terms');
const Privacy = page(() => import('./pages/legal/Privacy'), 'Privacy');
const Cookies = page(() => import('./pages/legal/Cookies'), 'Cookies');
const About = page(() => import('./pages/legal/About'), 'About');
const Withdraw = page(() => import('./pages/legal/Withdraw'), 'Withdraw');

/** Gamle stier (før appen flyttede til /app) – bevarer forespørgsel og anker, fx ?q= og UTM-parametre. */
function LegacyRedirect({ to }: { to: string }) {
  const { search, hash } = useLocation();
  const { id } = useParams();
  return <Navigate to={`${to}${id ? `/${id}` : ''}${search}${hash}`} replace />;
}

function NotFound({ home }: { home: string }) {
  return (
    <EmptyState
      className="pt-16"
      icon={<Compass className="size-6" />}
      title="Siden findes ikke"
      action={
        <Link to={home}>
          <Button tone="dark">{home === '/app' ? 'Til oversigten' : 'Til forsiden'}</Button>
        </Link>
      }
    />
  );
}

export function App() {
  return (
    <>
      <PageViewTracker />
      <Routes>
      <Route element={<PublicLayout />}>
        <Route index element={<Landing />} />
        <Route path="priser" element={<Pricing />} />
        <Route path="handelsbetingelser" element={<Terms />} />
        <Route path="privatlivspolitik" element={<Privacy />} />
        <Route path="cookies" element={<Cookies />} />
        <Route path="om" element={<About />} />
        <Route path="fortryd" element={<Withdraw />} />
        <Route path="*" element={<NotFound home="/" />} />
      </Route>

      <Route
        path="app"
        element={
          <Suspense fallback={<div className="min-h-dvh" />}>
            <AppShell />
          </Suspense>
        }
      >
        <Route index element={<Dashboard />} />
        <Route path="sog" element={<Search />} />
        <Route path="lister" element={<Lists />} />
        <Route path="kvitteringer" element={<Receipts />} />
        <Route path="kvitteringer/:id" element={<Receipts />} />
        <Route path="alarmer" element={<Alerts />} />
        <Route path="kilder" element={<Sources />} />
        <Route path="konto" element={<Account />} />
        <Route path="nulstil-adgangskode" element={<ResetPassword />} />
        <Route path="bekraeft-email" element={<VerifyEmail />} />
        <Route path="betaling/gennemfoert" element={<CheckoutSuccess />} />
        <Route path="betaling/afbrudt" element={<CheckoutCanceled />} />
        <Route path="*" element={<NotFound home="/app" />} />
      </Route>

      <Route path="sog" element={<LegacyRedirect to="/app/sog" />} />
      <Route path="lister" element={<LegacyRedirect to="/app/lister" />} />
      <Route path="kvitteringer" element={<LegacyRedirect to="/app/kvitteringer" />} />
      <Route path="kvitteringer/:id" element={<LegacyRedirect to="/app/kvitteringer" />} />
      <Route path="alarmer" element={<LegacyRedirect to="/app/alarmer" />} />
      <Route path="kilder" element={<LegacyRedirect to="/app/kilder" />} />
      <Route path="konto" element={<LegacyRedirect to="/app/konto" />} />
      </Routes>
    </>
  );
}
