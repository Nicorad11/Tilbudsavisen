import type { ListOptimizationDTO, OfferDTO, ShoppingListDTO, StorePlan } from '@tilbudsradar/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Check, Minus, Pencil, Plus, ShoppingBasket, Sparkles, Trash2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Price, useOpenOffer } from '../components/OfferCard';
import { DotNumber } from '../components/ui/DotNumber';
import { Button, Card, Chip, EmptyState, IconButton, Pill, Segmented, Skeleton, StoreDot, TextInput } from '../components/ui/primitives';
import { authed } from '../lib/api';
import { kr } from '../lib/format';
import { useList, useLists, useOptimize, useProductSearch, useStores } from '../lib/hooks';
import { usePrefs, useUi } from '../lib/store';
import { storeColor } from '../lib/storeColors';

const QUICK = ['mælk', 'æg', 'smør', 'hakket oksekød', 'kyllingebryst', 'kartofler', 'bananer', 'kaffe', 'rugbrød', 'pasta'];

export function Lists() {
  const lists = useLists();
  const { activeListId, setActiveList } = usePrefs();
  const [params, setParams] = useSearchParams();
  const qc = useQueryClient();
  const toast = useUi((s) => s.showToast);
  const [creating, setCreating] = useState(params.get('ny') === '1');
  const [newName, setNewName] = useState('');

  const selected = lists.data?.find((l) => l.id === activeListId) ?? lists.data?.[0] ?? null;
  useEffect(() => {
    // Kun når data er friske: en netop oprettet liste findes endnu ikke i den gamle cache.
    if (!lists.data || lists.isFetching) return;
    const exists = lists.data.some((l) => l.id === activeListId);
    if (!exists) setActiveList(lists.data[0]?.id ?? null);
  }, [lists.data, lists.isFetching, activeListId, setActiveList]);

  const create = useMutation({
    mutationFn: (name: string) => authed<{ id: number }>('/lists', { method: 'POST', body: { name } }),
    onSuccess: (l) => {
      setActiveList(l.id);
      setCreating(false);
      setNewName('');
      params.delete('ny');
      setParams(params, { replace: true });
      void qc.invalidateQueries({ queryKey: ['lists'] });
    },
    onError: (e) => toast(e instanceof Error ? e.message : 'Fejl', 'error'),
  });

  return (
    <div className="space-y-5 pt-2 lg:pt-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-muted">Find den billigste tur – også på tværs af butikker</p>
          <h1 className="mt-1 text-[36px] leading-[1.05] tracking-[-0.045em] sm:text-[48px]">Indkøbslister</h1>
        </div>
        <Button tone="dark" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
          Ny liste
        </Button>
      </div>

      <div className="no-scrollbar -mx-1 flex items-center gap-2 overflow-x-auto px-1">
        {lists.isLoading && <Skeleton className="h-8 w-40 rounded-full" />}
        {lists.data?.map((l) => (
          <Chip key={l.id} active={selected?.id === l.id} onClick={() => setActiveList(l.id)}>
            {l.name}
            <span className={clsx('text-[11px]', selected?.id === l.id ? 'text-white/60' : 'text-faint')}>{l.itemCount}</span>
          </Chip>
        ))}
        {creating && (
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              create.mutate(newName.trim() || 'Min indkøbsliste');
            }}
          >
            <TextInput
              autoFocus
              className="h-9 w-56"
              placeholder="Navn, fx Weekend"
              value={newName}
              maxLength={80}
              onChange={(e) => setNewName(e.target.value)}
            />
            <IconButton label="Opret" size="sm" tone="dark" type="submit">
              <Check className="size-4" />
            </IconButton>
            <IconButton label="Annullér" size="sm" onClick={() => setCreating(false)}>
              <X className="size-4" />
            </IconButton>
          </form>
        )}
      </div>

      {lists.data && lists.data.length === 0 && !creating ? (
        <Card>
          <EmptyState
            icon={<ShoppingBasket className="size-6" />}
            title="Ingen indkøbslister endnu"
            action={
              <Button tone="dark" onClick={() => create.mutate('Min indkøbsliste')} loading={create.isPending}>
                Opret din første liste
              </Button>
            }
          >
            Tilføj de varer du plejer at købe – så finder vi ugens billigste tilbud og den bedste butikskombination.
          </EmptyState>
        </Card>
      ) : selected ? (
        <ListDetail key={selected.id} listId={selected.id} />
      ) : null}
    </div>
  );
}

function ListDetail({ listId }: { listId: number }) {
  const { data: list, isLoading } = useList(listId);
  const [maxStores, setMaxStores] = useState(2);
  // Tom liste = backend bruger brugerens foretrukne kæder (fra Konto), ellers alle.
  const optimize = useOptimize(listId, maxStores, []);

  if (isLoading || !list) {
    return (
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Skeleton className="h-96 rounded-[30px]" />
        <Skeleton className="h-96 rounded-[30px]" />
      </div>
    );
  }

  return (
    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
      <ItemsCard list={list} />
      <div className="space-y-4 xl:sticky xl:top-20">
        <PlanCard
          list={list}
          plan={optimize.data}
          loading={optimize.isLoading}
          fetching={optimize.isFetching}
          maxStores={maxStores}
          setMaxStores={setMaxStores}
        />
        {optimize.data && optimize.data.singleStores.length > 1 && <SingleStoreComparison plans={optimize.data.singleStores} itemCount={optimize.data.itemCount} />}
      </div>
    </div>
  );
}

function ItemsCard({ list }: { list: ShoppingListDTO }) {
  const qc = useQueryClient();
  const toast = useUi((s) => s.showToast);
  const [text, setText] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(list.name);
  const [showSuggest, setShowSuggest] = useState(false);
  const suggest = useProductSearch(text);
  const inputRef = useRef<HTMLInputElement>(null);
  const { setActiveList } = usePrefs();

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['list', list.id] });
    void qc.invalidateQueries({ queryKey: ['optimize', list.id] });
    void qc.invalidateQueries({ queryKey: ['lists'] });
  };
  const onError = (e: unknown) => toast(e instanceof Error ? e.message : 'Fejl', 'error');

  const add = useMutation({
    mutationFn: (item: { text: string; productId?: number | null }) =>
      authed(`/lists/${list.id}/items`, { method: 'POST', body: item }),
    onSuccess: () => {
      setText('');
      setShowSuggest(false);
      inputRef.current?.focus();
      invalidate();
    },
    onError,
  });
  const patch = useMutation({
    mutationFn: ({ id, ...body }: { id: number; checked?: boolean; quantity?: number }) =>
      authed(`/lists/${list.id}/items/${id}`, { method: 'PATCH', body }),
    onSuccess: invalidate,
    onError,
  });
  const remove = useMutation({
    mutationFn: (id: number) => authed(`/lists/${list.id}/items/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
    onError,
  });
  const rename = useMutation({
    mutationFn: (n: string) => authed(`/lists/${list.id}`, { method: 'PATCH', body: { name: n } }),
    onSuccess: () => {
      setRenaming(false);
      invalidate();
    },
    onError,
  });
  const del = useMutation({
    mutationFn: () => authed(`/lists/${list.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      setActiveList(null);
      void qc.invalidateQueries({ queryKey: ['lists'] });
      toast('Listen er slettet');
    },
    onError,
  });

  const total = list.items.filter((i) => !i.checked).reduce((s, i) => s + (i.bestOffer?.offerPrice ?? 0) * i.quantity, 0);
  const open = list.items.filter((i) => !i.checked).length;

  return (
    <Card className="min-w-0 p-4 sm:p-6">
      <div className="flex items-start justify-between gap-3">
        {renaming ? (
          <form
            className="flex flex-1 items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim()) rename.mutate(name.trim());
            }}
          >
            <TextInput autoFocus className="h-10 flex-1" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
            <IconButton label="Gem" size="sm" tone="dark" type="submit">
              <Check className="size-4" />
            </IconButton>
          </form>
        ) : (
          <div>
            <h2 className="text-2xl tracking-[-0.03em]">{list.name}</h2>
            <p className="text-[13px] text-muted">
              {open} {open === 1 ? 'vare' : 'varer'} tilbage · billigste tilbud i alt{' '}
              <span className="tabular text-ink">{kr(total)} kr</span>
            </p>
          </div>
        )}
        <div className="flex gap-1">
          <IconButton label="Omdøb" size="sm" tone="ghost" onClick={() => setRenaming((v) => !v)}>
            <Pencil className="size-4" />
          </IconButton>
          <IconButton
            label="Slet liste"
            size="sm"
            tone="ghost"
            onClick={() => window.confirm(`Slet “${list.name}”?`) && del.mutate()}
          >
            <Trash2 className="size-4" />
          </IconButton>
        </div>
      </div>

      <form
        className="relative mt-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) add.mutate({ text: text.trim() });
        }}
      >
        <div className="flex items-center gap-2">
          <TextInput
            ref={inputRef}
            icon={<Plus className="size-4" />}
            className="h-12 flex-1"
            placeholder="Tilføj vare – fx “mælk” eller “hakket oksekød”"
            value={text}
            maxLength={120}
            onChange={(e) => {
              setText(e.target.value);
              setShowSuggest(true);
            }}
            onBlur={() => setTimeout(() => setShowSuggest(false), 150)}
          />
          <Button type="submit" tone="dark" size="lg" loading={add.isPending} disabled={!text.trim()}>
            Tilføj
          </Button>
        </div>
        {showSuggest && (suggest.data?.length ?? 0) > 0 && (
          <ul className="glass absolute inset-x-0 z-20 mt-2 max-h-72 overflow-y-auto rounded-[22px] p-1.5">
            {suggest.data!.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-3 rounded-2xl px-3 py-2 text-left text-sm hover:bg-white/70"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => add.mutate({ text: p.name, productId: p.id })}
                >
                  <span className="truncate">{p.name}</span>
                  {p.activeOffers > 0 && <Pill tone="lime">{p.activeOffers} tilbud</Pill>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </form>

      {list.items.length === 0 ? (
        <div className="mt-6">
          <p className="mb-2 text-[13px] text-muted">Hurtig start</p>
          <div className="flex flex-wrap gap-2">
            {QUICK.map((q) => (
              <Chip key={q} onClick={() => add.mutate({ text: q })}>
                <Plus className="size-3" /> {q}
              </Chip>
            ))}
          </div>
        </div>
      ) : (
        <ul className="mt-4 divide-y divide-line/60">
          {list.items.map((item) => (
            <li key={item.id} className={clsx('flex items-center gap-3 py-2.5', item.checked && 'opacity-45')}>
              <button
                type="button"
                role="checkbox"
                aria-checked={item.checked}
                aria-label={`Afkryds ${item.text}`}
                onClick={() => patch.mutate({ id: item.id, checked: !item.checked })}
                className={clsx(
                  'grid size-7 shrink-0 place-items-center rounded-full transition',
                  item.checked ? 'bg-ink text-lime' : 'bg-raised shadow-pill hover:bg-white',
                )}
              >
                {item.checked && <Check className="size-4" />}
              </button>
              <div className="min-w-0 flex-1">
                <p className={clsx('truncate text-[15px]', item.checked && 'line-through')}>{item.text}</p>
                <ItemOffer offer={item.bestOffer} />
              </div>
              <div className="flex items-center gap-1 rounded-full bg-black/[0.04] p-0.5">
                <IconButton
                  label="Færre"
                  size="sm"
                  tone="ghost"
                  className="size-7"
                  disabled={item.quantity <= 1}
                  onClick={() => patch.mutate({ id: item.id, quantity: item.quantity - 1 })}
                >
                  <Minus className="size-3" />
                </IconButton>
                <span className="tabular w-5 text-center text-sm">{item.quantity}</span>
                <IconButton
                  label="Flere"
                  size="sm"
                  tone="ghost"
                  className="size-7"
                  onClick={() => patch.mutate({ id: item.id, quantity: item.quantity + 1 })}
                >
                  <Plus className="size-3" />
                </IconButton>
              </div>
              <IconButton label={`Fjern ${item.text}`} size="sm" tone="ghost" onClick={() => remove.mutate(item.id)}>
                <X className="size-4" />
              </IconButton>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function ItemOffer({ offer }: { offer: OfferDTO | null }) {
  const open = useOpenOffer();
  if (!offer) return <p className="text-xs text-faint">Ikke på tilbud lige nu</p>;
  return (
    <button type="button" onClick={() => open(offer.id)} className="flex w-full min-w-0 items-center gap-1.5 text-left text-xs text-muted hover:text-ink">
      <StoreDot color={storeColor(offer.store.id)} />
      <span className="shrink-0">{offer.store.name}</span>
      <span className="tabular shrink-0 text-ink">{kr(offer.offerPrice)} kr</span>
      <span className="min-w-0 truncate text-faint">· {offer.title}</span>
    </button>
  );
}

function PlanCard({
  list,
  plan,
  loading,
  fetching,
  maxStores,
  setMaxStores,
}: {
  list: ShoppingListDTO;
  plan?: ListOptimizationDTO & { offers: Record<number, Record<string, OfferDTO>> };
  loading: boolean;
  fetching: boolean;
  maxStores: number;
  setMaxStores: (n: number) => void;
}) {
  const stores = useStores();
  const name = (id: string) => stores.data?.find((s) => s.id === id)?.name ?? id;
  const best: StorePlan | null = plan?.bestSplit ?? plan?.bestSingle ?? null;
  const itemName = (id: number) => list.items.find((i) => i.id === id)?.text ?? '';

  return (
    <div className="grad-card grad-green p-5 sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-white/85">Billigste tur</p>
        <Segmented
          size="sm"
          value={maxStores}
          onChange={setMaxStores}
          className="bg-white/25"
          options={[
            { value: 1, label: '1 butik' },
            { value: 2, label: '2' },
            { value: 3, label: '3' },
          ]}
        />
      </div>

      {loading ? (
        <div className="py-14 text-center text-white/80">Beregner…</div>
      ) : !plan || !best || plan.itemCount === 0 ? (
        <div className="py-12 text-center text-white/85">Tilføj varer for at se den billigste kombination af butikker.</div>
      ) : (
        <>
          <div className={clsx('mt-4 flex flex-col items-center transition', fetching && 'opacity-60')}>
            <div className="flex items-end gap-2">
              <DotNumber value={Math.round(best.total)} height={54} />
              <span className="pb-1 text-sm text-white/85">kr</span>
            </div>
            <p className="mt-2 text-center text-sm text-white">
              {best.storeIds.map(name).join(' + ')} · {best.covered} af {plan.itemCount} {plan.itemCount === 1 ? 'vare' : 'varer'} på tilbud
            </p>
            {plan.bestSplit && plan.savings != null && plan.savings > 0.5 && plan.bestSingle && (
              <p className="mt-3 flex items-center gap-1.5 rounded-full bg-white/25 px-3 py-1.5 text-[13px] ring-1 ring-white/40 backdrop-blur-md">
                <Sparkles className="size-4" />
                Spar {kr(plan.savings)} kr ved at handle i {plan.bestSplit.storeIds.map(name).join(' og ')} i stedet for kun{' '}
                {name(plan.bestSingle.storeIds[0]!)}
              </p>
            )}
            {plan.bestSplit && plan.bestSingle && plan.bestSplit.covered > plan.bestSingle.covered && (
              <p className="mt-2 text-center text-[12px] text-white/85">
                Dækker {plan.bestSplit.covered - plan.bestSingle.covered} vare(r) mere end den bedste enkeltbutik.
              </p>
            )}
          </div>

          <div className="mt-5 space-y-2">
            {best.perStore.map((ps) => (
              <div key={ps.storeId} className="rounded-[20px] bg-white/85 p-3 text-ink shadow-pill">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2 text-sm">
                    <StoreDot color={storeColor(ps.storeId)} />
                    {name(ps.storeId)}
                  </span>
                  <Price value={ps.subtotal} size="md" />
                </div>
                <ul className="mt-1.5 space-y-0.5">
                  {ps.itemIds.map((id) => {
                    const o = plan.offers[id]?.[ps.storeId];
                    return (
                      <li key={id} className="flex min-w-0 justify-between gap-3 text-xs text-ink-2">
                        <span className="min-w-0 truncate">
                          {itemName(id)}
                          {o && <span className="text-faint"> · {o.title}</span>}
                        </span>
                        {o && <span className="tabular shrink-0">{kr(o.offerPrice)}</span>}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
            {best.missing.length > 0 && (
              <p className="px-1 text-xs text-white/85">
                Ikke på tilbud: {best.missing.map(itemName).join(', ')}
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function SingleStoreComparison({ plans, itemCount }: { plans: StorePlan[]; itemCount: number }) {
  const stores = useStores();
  const max = Math.max(...plans.map((p) => p.total), 1);
  return (
    <Card className="p-5">
      <p className="text-sm text-ink">Kun én butik</p>
      <p className="text-xs text-muted">Pris for de varer hver kæde har på tilbud</p>
      <ul className="mt-3 space-y-2.5">
        {plans.map((p) => {
          const id = p.storeIds[0]!;
          return (
            <li key={id}>
              <div className="flex items-center justify-between text-[13px]">
                <span className="flex items-center gap-2">
                  <StoreDot color={storeColor(id)} className="ring-0" />
                  {stores.data?.find((s) => s.id === id)?.name ?? id}
                  <span className="text-faint">
                    {p.covered}/{itemCount}
                  </span>
                </span>
                <span className="tabular">{kr(p.total)} kr</span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-black/[0.05]">
                <div className="h-full rounded-full" style={{ width: `${(p.total / max) * 100}%`, background: storeColor(id) }} />
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

