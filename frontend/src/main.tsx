import { hydrate, MutationCache, QueryClient, QueryClientProvider, type DehydratedState } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot, hydrateRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { App } from './App';
import { AppErrorBoundary } from './components/AppErrorBoundary';
import { initAnalytics } from './lib/analytics';
import { ApiError, isPaywallError, refreshSession } from './lib/api';
import { initMonitoring, reportError } from './lib/monitoring';
import { registerServiceWorker } from './lib/pwa';
import { HeadContext } from './lib/seo';
import { useUi } from './lib/store';
import { listenForNewVersions } from './lib/updates';
import { lazyPublicPages, preloadPublicPage } from './publicPages';
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

/** Data, serveren brugte til siden (samme query-nøgler som her), så første render er identisk. */
function serverState(): DehydratedState | null {
  try {
    const text = document.getElementById('tr-state')?.textContent;
    return text ? (JSON.parse(text) as DehydratedState) : null;
  } catch {
    return null;
  }
}

const state = serverState();
if (state) hydrate(queryClient, state);

// Gendan en eksisterende session (refresh-cookie) – opretter ikke en ny gæst. Første render er
// altid "logget ud" ligesom på serveren (zustand bruger starttilstanden under hydrering).
void refreshSession();
void initMonitoring();
listenForNewVersions();
initAnalytics();
registerServiceWorker();

const tree = (
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <HeadContext.Provider value={null}>
          <AppErrorBoundary>
            <App pages={lazyPublicPages} />
          </AppErrorBoundary>
        </HeadContext.Provider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>
);

const container = document.getElementById('root')!;
if (container.firstElementChild) {
  // Server-renderet side: hent sidens kode først, så React kan overtage HTML'en uden at den blinker.
  void preloadPublicPage(window.location.pathname).then(() => {
    hydrateRoot(container, tree, {
      onRecoverableError: (error, info) => {
        console.error('Hydrering:', error);
        reportError(error, info.componentStack ?? undefined);
      },
    });
  });
} else {
  createRoot(container).render(tree);
}
