import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { ApiError, refreshSession } from '../lib/api';
import { initMonitoring } from '../lib/monitoring';
import { listenForNewVersions } from '../lib/updates';
import { AppErrorBoundary } from '../components/AppErrorBoundary';
import { AdminApp } from './AdminApp';
import '../index.css';

/**
 * Admin-appen (admin.tilbudsradaren.dk). Egen indgang, så intet af den ligger i
 * hjemmesidens kode: ingen besøgsstatistik, ingen service worker og ingen links
 * fra hjemmesiden. Login-sessionen er adskilt fra hjemmesidens (egen cookie pr. domæne).
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      refetchOnWindowFocus: true,
      retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 2,
    },
  },
});

void refreshSession();
void initMonitoring();
listenForNewVersions();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AppErrorBoundary>
          <AdminApp />
        </AppErrorBoundary>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
