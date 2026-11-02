/**
 * Server-rendering af de offentlige sider (bygges med `vite build --ssr` til
 * dist/server/entry-server.js og indlæses af backend/src/http/ssr.ts).
 *
 * Træet er det samme som i main.tsx, så React i browseren kan hydrere HTML'en.
 * Siderne importeres direkte (ikke lazy), så serveren aldrig sender en
 * Suspense-fallback. Data hentes af serveren på forhånd og lægges i
 * query-cachen med de samme nøgler, som sidernes hooks bruger.
 */
import type { SeoMeta } from '@tilbudsradar/shared';
import { dehydrate, QueryClient, QueryClientProvider, type DehydratedState, type QueryKey } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { renderToString } from 'react-dom/server';
import { StaticRouter } from 'react-router';
import { App, type PublicPages } from './App';
import { AppErrorBoundary } from './components/AppErrorBoundary';
import { HeadContext, type HeadCollector } from './lib/seo';
import { About } from './pages/legal/About';
import { Cookies } from './pages/legal/Cookies';
import { Privacy } from './pages/legal/Privacy';
import { Terms } from './pages/legal/Terms';
import { Withdraw } from './pages/legal/Withdraw';
import { Pricing } from './pages/Pricing';

const pages: PublicPages = { Pricing, Terms, Privacy, Cookies, About, Withdraw };

export interface PrefetchedQuery {
  queryKey: QueryKey;
  data: unknown;
}

export interface RenderResult {
  html: string;
  /** Sidens meta (titel, canonical, robots, JSON-LD …) – null hvis ingen side satte den. */
  meta: SeoMeta | null;
  /** Query-cachen til browseren (<script id="tr-state">). */
  state: DehydratedState;
}

export function render(url: string, queries: PrefetchedQuery[] = []): RenderResult {
  const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  for (const q of queries) queryClient.setQueryData(q.queryKey, q.data);
  const head: HeadCollector = { meta: null };
  const html = renderToString(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <StaticRouter location={url}>
          <HeadContext.Provider value={head}>
            <AppErrorBoundary>
              <App pages={pages} />
            </AppErrorBoundary>
          </HeadContext.Provider>
        </StaticRouter>
      </QueryClientProvider>
    </StrictMode>,
  );
  return { html, meta: head.meta, state: dehydrate(queryClient) };
}
