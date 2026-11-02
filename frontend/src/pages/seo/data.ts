import type { SeoMeta } from '@tilbudsradar/shared';
import { useQuery } from '@tanstack/react-query';
import { useLocation } from 'react-router';
import { api, ApiError } from '../../lib/api';
import { useSeo } from '../../lib/seo';

/**
 * Datasidens indhold. Query-nøglen er ['seo', ...stiens dele] – den samme som
 * serveren bruger, når den renderer siden (backend/src/http/ssr.ts), så første
 * visning kommer direkte fra den server-renderede HTML. null = siden findes ikke.
 */
export function useSeoPage<T extends { meta: SeoMeta }>() {
  const { pathname } = useLocation();
  const path = pathname.replace(/\/+$/, '');
  const query = useQuery({
    queryKey: ['seo', ...path.split('/').filter(Boolean)],
    queryFn: async () => {
      try {
        return await api<T>(`/seo${path}`);
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) return null;
        throw err;
      }
    },
    staleTime: 5 * 60_000,
  });
  const data = query.data;
  // Meta fra data – 404 når siden ikke findes – og ingenting, mens data hentes.
  useSeo(data === undefined ? null : data === null ? undefined : data.meta);
  return { data, isError: query.isError };
}
