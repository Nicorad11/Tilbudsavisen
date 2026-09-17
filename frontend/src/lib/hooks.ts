import type {
  CategoryId,
  ListOptimizationDTO,
  ListSummaryDTO,
  MealPlanDTO,
  MealPlanRequest,
  NotificationDTO,
  OfferDetailResponse,
  OfferDTO,
  PriceHistoryResponse,
  ProductDTO,
  ScrapeStatusDTO,
  SearchResponse,
  SearchSort,
  ShoppingListDTO,
  StatsDTO,
  StoreDTO,
  UserDTO,
  WatchDTO,
} from '@tilbudsradar/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, authed } from './api';
import { locationParams, useAuth, usePrefs, useUi } from './store';

export interface SearchInput {
  q: string;
  stores?: string[];
  categories?: string[];
  sort?: SearchSort | null;
  onlyReal?: boolean;
  limit?: number;
  offset?: number;
}

export function useSearch(input: SearchInput, enabled = true) {
  const location = usePrefs((s) => s.location);
  const loc = locationParams(location);
  return useQuery({
    queryKey: ['search', input, loc],
    queryFn: ({ signal }) =>
      api<SearchResponse>('/search', {
        signal,
        query: {
          q: input.q,
          stores: input.stores,
          categories: input.categories,
          sort: input.sort ?? undefined,
          onlyReal: input.onlyReal ? 'true' : undefined,
          limit: input.limit ?? 30,
          offset: input.offset ?? 0,
          ...loc,
        },
      }),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export const useStats = () =>
  useQuery({ queryKey: ['stats'], queryFn: () => api<StatsDTO>('/stats'), refetchInterval: 60_000 });

export const useTopDeals = (limit = 12, stores?: string[]) =>
  useQuery({
    queryKey: ['top', limit, stores],
    queryFn: () => api<OfferDTO[]>('/offers/top', { query: { limit, stores } }),
  });

export const useStores = () => useQuery({ queryKey: ['stores'], queryFn: () => api<StoreDTO[]>('/stores'), staleTime: 60_000 });

export const useOffer = (id: number | null) =>
  useQuery({
    queryKey: ['offer', id],
    queryFn: () => api<OfferDetailResponse>(`/offers/${id}`),
    enabled: id !== null,
  });

export const usePriceHistory = (productId: number | null, days = 180) =>
  useQuery({
    queryKey: ['history', productId, days],
    queryFn: () => api<PriceHistoryResponse>(`/products/${productId}/history`, { query: { days } }),
    enabled: productId !== null,
  });

export const useProductSearch = (q: string) =>
  useQuery({
    queryKey: ['products', q],
    queryFn: ({ signal }) => api<(ProductDTO & { activeOffers: number })[]>('/products/search', { query: { q }, signal }),
    enabled: q.trim().length >= 2,
    staleTime: 30_000,
  });

export const useCategoryCounts = () => {
  const stats = useStats();
  const counts = new Map<CategoryId, number>();
  for (const c of stats.data?.categoryCounts ?? []) counts.set(c.id as CategoryId, c.count);
  return counts;
};

/* ---------------- Bruger ---------------- */

export const useMe = () => {
  const token = useAuth((s) => s.accessToken);
  return useQuery({
    queryKey: ['me', token],
    queryFn: () => api<UserDTO>('/auth/me'),
    enabled: Boolean(token),
  });
};

/** `enabled=false` undgår at oprette en gæstesession blot for at vise en tæller. */
export const useLists = (enabled = true) =>
  useQuery({ queryKey: ['lists'], queryFn: () => authed<ListSummaryDTO[]>('/lists'), enabled });

export const useList = (id: number | null) =>
  useQuery({
    queryKey: ['list', id],
    queryFn: () => authed<ShoppingListDTO>(`/lists/${id}`),
    enabled: id !== null,
    placeholderData: keepPreviousData,
  });

export const useOptimize = (id: number | null, maxStores: number, stores: string[]) =>
  useQuery({
    queryKey: ['optimize', id, maxStores, stores],
    queryFn: () =>
      authed<ListOptimizationDTO & { offers: Record<number, Record<string, OfferDTO>> }>(`/lists/${id}/optimize`, {
        query: { maxStores, stores },
      }),
    enabled: id !== null,
    placeholderData: keepPreviousData,
  });

export const useWatches = (enabled = true) =>
  useQuery({ queryKey: ['watches'], queryFn: () => authed<WatchDTO[]>('/watchlist'), enabled });

export const useNotifications = (enabled = true) =>
  useQuery({
    queryKey: ['notifications'],
    queryFn: () => authed<NotificationDTO[]>('/notifications'),
    enabled,
    refetchInterval: 120_000,
  });

export const useMealPlans = () => useQuery({ queryKey: ['mealplans'], queryFn: () => authed<MealPlanDTO[]>('/meal-plans') });

export const useScrapeStatus = () =>
  useQuery({
    queryKey: ['scrape-status'],
    queryFn: () => api<ScrapeStatusDTO & { adminOpen: boolean }>('/admin/status'),
    refetchInterval: (q) => (q.state.data?.running ? 2500 : 15_000),
  });

/* ---------------- Mutationer ---------------- */

export function useAddToList() {
  const qc = useQueryClient();
  const toast = useUi((s) => s.showToast);
  const { activeListId, setActiveList } = usePrefs();
  return useMutation({
    mutationFn: async (item: { text: string; productId?: number | null; listId?: number | null }) => {
      let listId = item.listId ?? activeListId;
      const lists = await authed<ListSummaryDTO[]>('/lists');
      if (!listId || !lists.some((l) => l.id === listId)) {
        listId =
          lists[0]?.id ??
          (await authed<ListSummaryDTO>('/lists', { method: 'POST', body: { name: 'Min indkøbsliste' } })).id;
        setActiveList(listId);
      }
      await authed(`/lists/${listId}/items`, { method: 'POST', body: { text: item.text, productId: item.productId ?? null } });
      return lists.find((l) => l.id === listId)?.name ?? 'Min indkøbsliste';
    },
    onSuccess: (name, vars) => {
      void qc.invalidateQueries({ queryKey: ['lists'] });
      void qc.invalidateQueries({ queryKey: ['list'] });
      void qc.invalidateQueries({ queryKey: ['optimize'] });
      toast(`“${vars.text}” er tilføjet til ${name}`);
    },
    onError: (err) => toast(err instanceof Error ? err.message : 'Kunne ikke tilføje', 'error'),
  });
}

export function useAddWatch() {
  const qc = useQueryClient();
  const toast = useUi((s) => s.showToast);
  return useMutation({
    mutationFn: (w: { query: string; productId?: number | null; targetPrice: number }) =>
      authed('/watchlist', { method: 'POST', body: w }),
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: ['watches'] });
      toast(`Du får besked, når “${vars.query}” koster under ${vars.targetPrice} kr`);
    },
    onError: (err) => toast(err instanceof Error ? err.message : 'Kunne ikke oprette prisalarm', 'error'),
  });
}

export function useCreateMealPlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req: MealPlanRequest) => authed<MealPlanDTO>('/meal-plans', { method: 'POST', body: req }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['mealplans'] }),
  });
}
