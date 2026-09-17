import { Compass } from 'lucide-react';
import { Link, Route, Routes } from 'react-router';
import { AppShell } from './components/layout/AppShell';
import { Button, EmptyState } from './components/ui/primitives';
import { Account } from './pages/Account';
import { Alerts } from './pages/Alerts';
import { Dashboard } from './pages/Dashboard';
import { Lists } from './pages/Lists';
import { MealPlan } from './pages/MealPlan';
import { Search } from './pages/Search';
import { Sources } from './pages/Sources';

export function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Dashboard />} />
        <Route path="sog" element={<Search />} />
        <Route path="lister" element={<Lists />} />
        <Route path="madplan" element={<MealPlan />} />
        <Route path="alarmer" element={<Alerts />} />
        <Route path="kilder" element={<Sources />} />
        <Route path="konto" element={<Account />} />
        <Route
          path="*"
          element={
            <EmptyState
              icon={<Compass className="size-6" />}
              title="Siden findes ikke"
              action={
                <Link to="/">
                  <Button tone="dark">Til oversigten</Button>
                </Link>
              }
            />
          }
        />
      </Route>
    </Routes>
  );
}
