import type { SearchSort } from '@tilbudsradar/shared';
import { VISIBLE_CATEGORIES, categoryLabel, unitPriceLabel } from '@tilbudsradar/shared';
import clsx from 'clsx';
import { LayoutGrid, List, Search as SearchIcon, SearchX, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { LocationPicker } from '../components/LocationPicker';
import { OfferCard, OfferCardSkeleton, OfferRow } from '../components/OfferCard';
import { Button, Chip, EmptyState, IconButton, Segmented, Toggle } from '../components/ui/primitives';
import { ApiError } from '../lib/api';
import { int } from '../lib/format';
import { useSearch, useStores } from '../lib/hooks';
import { CategoryIcon } from '../lib/icons';
import { storeColor } from '../lib/storeColors';

const PAGE = 36;
const MAX_PAGES = 8; // API'et leverer højst 300 resultater ad gangen
const SORTS: { value: SearchSort; label: string }[] = [
  { value: 'unit', label: 'Pris pr. enhed' },
  { value: 'price', label: 'Pris' },
  { value: 'discount', label: 'Besparelse' },
  { value: 'relevance', label: 'Relevans' },
];
const SUGGESTIONS = ['hakket oksekød', 'mælk', 'kaffe', 'kyllingebryst', 'æg', 'smør', 'bleer', 'toiletpapir'];

const list = (v: string | null) => (v ? v.split(',').filter(Boolean) : []);

export function Search() {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const categories = list(params.get('kategori'));
  const storesFilter = list(params.get('kaeder'));
  const onlyReal = params.get('reelle') === '1';
  const sortParam = params.get('sortering') as SearchSort | null;
  const sort: SearchSort = sortParam ?? (q ? 'unit' : 'discount');
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [draft, setDraft] = useState(q);
  const [pages, setPages] = useState(1);

  const update = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === '') next.delete(k);
      else next.set(k, v);
    }
    setParams(next, { replace: true });
  };

  // Debounce: søg mens man skriver.
  useEffect(() => setDraft(q), [q]);
  useEffect(() => {
    if (draft === q) return;
    const t = setTimeout(() => update({ q: draft.trim() || null }), 280);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);
  useEffect(() => setPages(1), [q, sort, onlyReal, params.get('kategori'), params.get('kaeder')]);

  const search = useSearch({
    q,
    categories,
    stores: storesFilter,
    sort,
    onlyReal,
    limit: PAGE * pages,
  });
  const stores = useStores();
  const data = search.data;
  const dominantUnit = data?.items[0]?.unit;

  const storeFacets = useMemo(() => {
    const counts = new Map((data?.facets.stores ?? []).map((f) => [f.id, f.count]));
    return (stores.data ?? [])
      .filter((s) => s.enabled && (counts.get(s.id) || storesFilter.includes(s.id)))
      .map((s) => ({ ...s, count: counts.get(s.id) ?? 0 }))
      .sort((a, b) => b.count - a.count);
  }, [data?.facets.stores, stores.data, storesFilter]);

  const title = categories.length === 1 ? categoryLabel(categories[0]!) : q ? `“${q}”` : 'Alle tilbud';
  const locationError = search.error instanceof ApiError && search.error.status === 422 ? search.error.message : null;

  return (
    <div className="space-y-5 pt-2 lg:pt-4">
      <div>
        <p className="text-sm text-muted">Søg på tværs af alle kæder</p>
        <h1 className="mt-1 truncate text-[36px] leading-[1.05] tracking-[-0.045em] sm:text-[48px]">{title}</h1>
      </div>

      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          update({ q: draft.trim() || null });
        }}
        className="flex h-14 items-center gap-3 rounded-full bg-raised pr-2 pl-5 shadow-float ring-ink/80 focus-within:ring-2"
      >
        <SearchIcon className="size-5 text-muted" strokeWidth={1.6} />
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Søg efter en vare – fx hakket oksekød, kaffe eller bleer"
          aria-label="Søg"
          className="h-full min-w-0 flex-1 bg-transparent text-[17px] tracking-tight outline-none placeholder:text-faint"
          autoFocus={!q}
          enterKeyHint="search"
        />
        {draft && (
          <IconButton label="Ryd" size="sm" tone="ghost" onClick={() => setDraft('')}>
            <X className="size-4" />
          </IconButton>
        )}
        <Button type="submit" tone="dark" className="max-sm:hidden">
          Søg
        </Button>
      </form>

      {!q && !categories.length && (
        <div className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1">
          {SUGGESTIONS.map((s) => (
            <Chip key={s} onClick={() => update({ q: s })}>
              {s}
            </Chip>
          ))}
        </div>
      )}

      {/* Kategorier på små skærme (sidebaren viser dem på desktop) */}
      <div className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 lg:hidden">
        {VISIBLE_CATEGORIES.map((c) => (
          <Chip
            key={c.id}
            active={categories.includes(c.id)}
            onClick={() =>
              update({ kategori: categories.includes(c.id) ? categories.filter((x) => x !== c.id).join(',') : c.id })
            }
          >
            <CategoryIcon id={c.id} className="size-3.5" />
            {c.label}
          </Chip>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Segmented value={sort} onChange={(v) => update({ sortering: v })} options={SORTS} />
        <label className="flex h-10 items-center gap-2 rounded-full bg-raised px-3 text-[13px] text-ink-2 shadow-pill">
          <Toggle checked={onlyReal} onChange={(v) => update({ reelle: v ? '1' : null })} label="Kun reelle tilbud" />
          Kun reelle tilbud
        </label>
        <div className="ml-auto flex items-center gap-2">
          <LocationPicker />
          <Segmented
            size="sm"
            value={view}
            onChange={setView}
            options={[
              { value: 'grid', label: <LayoutGrid className="size-4" aria-label="Gitter" /> },
              { value: 'list', label: <List className="size-4" aria-label="Liste" /> },
            ]}
          />
        </div>
      </div>

      {storeFacets.length > 0 && (
        <div className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1">
          {storeFacets.map((s) => (
            <Chip
              key={s.id}
              color={storeColor(s.id)}
              active={storesFilter.includes(s.id)}
              onClick={() =>
                update({
                  kaeder: storesFilter.includes(s.id) ? storesFilter.filter((x) => x !== s.id).join(',') : [...storesFilter, s.id].join(','),
                })
              }
            >
              {s.name}
              <span className={clsx('tabular text-[11px]', storesFilter.includes(s.id) ? 'text-white/60' : 'text-faint')}>
                {int(s.count)}
              </span>
            </Chip>
          ))}
          {storesFilter.length > 0 && (
            <Button size="sm" tone="ghost" onClick={() => update({ kaeder: null })}>
              Nulstil kæder
            </Button>
          )}
        </div>
      )}

      {locationError && <p className="rounded-2xl bg-[#fbe6cf] px-4 py-3 text-sm text-[#8a4a0b]">{locationError}</p>}

      {data && (
        <p className="text-sm text-muted">
          <span className="text-ink">{int(data.total)}</span> tilbud
          {sort === 'unit' && dominantUnit && <> · sorteret efter {unitPriceLabel(dominantUnit)}</>}
          {data.location && <> · inden for {data.location.radiusKm} km</>}
          {search.isFetching && <span className="ml-2 animate-pulse-soft">opdaterer…</span>}
        </p>
      )}

      {search.isLoading ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
          {Array.from({ length: 10 }, (_, i) => (
            <OfferCardSkeleton key={i} />
          ))}
        </div>
      ) : data && data.items.length === 0 ? (
        <EmptyState icon={<SearchX className="size-6" />} title="Ingen tilbud fundet">
          Prøv et andet søgeord, fjern filtre eller udvid afstanden. Nye aviser hentes automatisk to gange dagligt.
        </EmptyState>
      ) : view === 'grid' ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
          {data?.items.map((o) => (
            <OfferCard key={o.id} offer={o} />
          ))}
        </div>
      ) : (
        <div className="card space-y-0.5 p-2">
          {data?.items.map((o) => (
            <OfferRow key={o.id} offer={o} />
          ))}
        </div>
      )}

      {data && data.items.length < data.total && pages < MAX_PAGES && (
        <div className="flex justify-center pt-2">
          <Button onClick={() => setPages((p) => p + 1)} loading={search.isFetching}>
            Vis flere ({int(data.total - data.items.length)} tilbage)
          </Button>
        </div>
      )}
    </div>
  );
}
