import { MutationCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { App } from './App';
import { initAnalytics } from './lib/analytics';
import { ApiError, isPaywallError, refreshSession } from './lib/api';
import { initMonitoring } from './lib/monitoring';
import { listenForNewVersions } from './lib/updates';
import { AppErrorBoundary } from './components/AppErrorBoundary';
import { registerServiceWorker } from './lib/pwa';
import { useUi } from './lib/store';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 2,
    },
  },
  // Kræver en handling konto eller abonnement, vises betalingsmuren i stedet for en fejlbesked.
  mutationCache: new MutationCache({
    onError: (err) => {
      if (isPaywallError(err)) useUi.getState().openPaywall();
    },
  }),
});

// Gendan en eksisterende session (refresh-cookie) – opretter ikke en ny gæst.
void refreshSession();
void initMonitoring();
listenForNewVersions();
initAnalytics();
registerServiceWorker();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AppErrorBoundary>
          <App />
        </AppErrorBoundary>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
