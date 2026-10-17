import type { AdminCustomerFilter, AdminCustomerPage, AdminCustomerSort } from '@tilbudsradar/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { ChevronLeft, ChevronRight, Search, UsersRound } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Button, Card, Chip, EmptyState, Pill, Segmented, Skeleton, TextInput } from '../../components/ui/primitives';
import { api } from '../../lib/api';
import { int, relativeTime } from '../../lib/format';
import { FILTER_LABEL, fmtDate, STATUS_LABEL, STATUS_TONE } from '../labels';

const PAGE_SIZE = 50;
const FILTERS: AdminCustomerFilter[] = ['all', 'launch', 'trial', 'active', 'past_due', 'canceled', 'expired', 'admin'];
const SORTS: { value: AdminCustomerSort; label: string }[] = [
  { value: 'created', label: 'Nyeste' },
  { value: 'lastSeen', label: 'Sidst aktiv' },
  { value: 'email', label: 'E-mail' },
];

const isFilter = (v: string | null): v is AdminCustomerFilter => FILTERS.includes(v as AdminCustomerFilter);
const isSort = (v: string | null): v is AdminCustomerSort => SORTS.some((s) => s.value === v);

/** Alle kunder (konti med e-mail): søg på e-mail, filtrér på status, klik for at redigere. */
export function Customers() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const filter = isFilter(params.get('status')) ? (params.get('status') as AdminCustomerFilter) : 'all';
  const sort = isSort(params.get('sort')) ? (params.get('sort') as AdminCustomerSort) : 'created';
  const page = Math.max(1, Number(params.get('side')) || 1);

  // Søgefeltet opdaterer adressen lidt forsinket, så der ikke hentes for hvert tastetryk.
  const [draft, setDraft] = useState(q);
  useEffect(() => setDraft(q), [q]);
  useEffect(() => {
    if (draft === q) return;
    const t = setTimeout(() => update({ q: draft, side: null }), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  function update(next: Record<string, string | null>) {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(next)) {
      if (v === null || v === '' || (k === 'status' && v === 'all') || (k === 'sort' && v === 'created') || (k === 'side' && v === '1'))
        p.delete(k);
      else p.set(k, v);
    }
    // Søgning erstatter historikken; filtre og sider kan man gå tilbage fra.
    setParams(p, { replace: 'q' in next });
  }

  const list = useQuery({
    queryKey: ['admin-customers', q, filter, sort, page],
    queryFn: () => api<AdminCustomerPage>('/admin/users', { query: { q, filter, sort, page, pageSize: PAGE_SIZE } }),
    placeholderData: keepPreviousData,
  });
  const data = list.data;
  const from = data && data.total ? (data.page - 1) * data.pageSize + 1 : 0;
  const to = data ? Math.min(data.total, data.page * data.pageSize) : 0;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="space-y-5 pb-10">
      <div className="flex flex-wrap items-end justify-between gap-4 pt-2">
        <div>
          <p className="text-sm text-muted">Konti med e-mail · gæster vises ikke</p>
          <h1 className="mt-1 text-[40px] leading-[1.04] tracking-[-0.045em] text-ink sm:text-[52px]">Kunder</h1>
        </div>
        <Segmented value={sort} options={SORTS} onChange={(v) => update({ sort: v, side: null })} />
      </div>

      <TextInput
        icon={<Search className="size-4" />}
        type="search"
        placeholder="Søg på e-mail"
        aria-label="Søg på e-mail"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        className="max-w-md"
      />

      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1" role="group" aria-label="Filtrér på status">
        {FILTERS.filter((f) => f === 'all' || f === filter || (data?.counts[f] ?? 0) > 0).map((f) => (
          <Chip key={f} active={filter === f} onClick={() => update({ status: f, side: null })}>
            {FILTER_LABEL[f]}
            {data && <span className={clsx('tabular', filter === f ? 'text-white/70' : 'text-muted')}>{int(data.counts[f] ?? 0)}</span>}
          </Chip>
        ))}
      </div>

      <Card className="p-2 sm:p-3">
        {!data ? (
          <div className="space-y-2 p-2">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-10" />
            ))}
          </div>
        ) : !data.items.length ? (
          <EmptyState
            icon={<UsersRound className="size-6" />}
            title={q || filter !== 'all' ? 'Ingen kunder matcher' : 'Ingen kunder endnu'}
          >
            {q || filter !== 'all' ? 'Prøv en anden søgning eller et andet filter.' : 'Nye konti dukker op her, så snart de er oprettet.'}
          </EmptyState>
        ) : (
          <>
            {/* Mobil: én række pr. kunde i stedet for en bred tabel. */}
            <ul className={clsx('divide-y divide-black/[0.06] md:hidden', list.isPlaceholderData && 'opacity-60')}>
              {data.items.map((u) => (
                <li key={u.id}>
                  <Link to={`/kunder/${u.id}`} className="block rounded-2xl px-3 py-3 hover:bg-black/[0.025]">
                    <p className="truncate text-[14px] text-ink">{u.email}</p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[12px] text-muted">
                      {u.isAdmin ? (
                        <Pill tone="dark">Administrator</Pill>
                      ) : (
                        <Pill tone={STATUS_TONE[u.status]}>{STATUS_LABEL[u.status]}</Pill>
                      )}
                      {!u.emailVerified && <Pill tone="ghost">ikke bekræftet</Pill>}
                      <span>aktiv {relativeTime(u.lastSeenAt)}</span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
            {/*
              Tabellen passer altid i bredden: kolonnerne kommer til, efterhånden som der er plads
              (md: e-mail, status, sidst aktiv · lg: + oprettet og prøveperiode · xl: + lister og alarmer).
              E-mailen tager resten af pladsen og forkortes med "…".
            */}
            <div className="hidden overflow-x-auto md:block">
              <table className={clsx('w-full text-left text-[13px] transition-opacity', list.isPlaceholderData && 'opacity-60')}>
                <thead className="whitespace-nowrap text-muted">
                  <tr>
                    <th className="px-3 py-2.5 font-normal">E-mail</th>
                    <th className="px-3 py-2.5 font-normal">Status</th>
                    <th className="hidden px-3 py-2.5 font-normal lg:table-cell">Oprettet</th>
                    <th className="px-3 py-2.5 font-normal">Sidst aktiv</th>
                    <th className="hidden px-3 py-2.5 font-normal lg:table-cell">Prøveperiode til</th>
                    <th className="hidden px-3 py-2.5 text-right font-normal xl:table-cell">Lister</th>
                    <th className="hidden px-3 py-2.5 text-right font-normal xl:table-cell">Alarmer</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((u) => (
                    <tr
                      key={u.id}
                      className="cursor-pointer border-t border-black/[0.06] text-ink-2 hover:bg-black/[0.025]"
                      onClick={() => navigate(`/kunder/${u.id}`)}
                    >
                      <td className="w-full max-w-0 px-3 py-2.5">
                        <div className="flex min-w-0 items-center gap-2">
                          <Link
                            to={`/kunder/${u.id}`}
                            className="min-w-0 truncate text-ink hover:underline"
                            title={u.email}
                            onClick={(e) => e.stopPropagation()}
                          >
                            {u.email}
                          </Link>
                          {!u.emailVerified && (
                            <Pill tone="ghost" className="shrink-0">
                              ikke bekræftet
                            </Pill>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        {u.isAdmin ? (
                          <Pill tone="dark">Administrator</Pill>
                        ) : (
                          <Pill tone={STATUS_TONE[u.status]}>{STATUS_LABEL[u.status]}</Pill>
                        )}
                      </td>
                      <td className="hidden px-3 py-2.5 whitespace-nowrap lg:table-cell">{fmtDate(u.createdAt)}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap">{relativeTime(u.lastSeenAt)}</td>
                      <td className="hidden px-3 py-2.5 whitespace-nowrap lg:table-cell">{fmtDate(u.trialEndsAt)}</td>
                      <td className="tabular hidden px-3 py-2.5 text-right xl:table-cell">{int(u.lists)}</td>
                      <td className="tabular hidden px-3 py-2.5 text-right xl:table-cell">{int(u.watches)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>

      {data && data.total > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 text-[13px] text-muted">
          <span className="tabular">
            {int(from)}–{int(to)} af {int(data.total)}
          </span>
          {pages > 1 && (
            <div className="flex gap-2">
              <Button
                size="sm"
                icon={<ChevronLeft className="size-4" />}
                disabled={page <= 1}
                onClick={() => update({ side: String(page - 1) })}
              >
                Forrige
              </Button>
              <Button size="sm" disabled={page >= pages} onClick={() => update({ side: String(page + 1) })}>
                Næste <ChevronRight className="size-4" />
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
