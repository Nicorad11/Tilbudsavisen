import type { CommunityReportDTO, OfferDTO } from '@tilbudsradar/shared';
import { categoryLabel } from '@tilbudsradar/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import {
  BellPlus,
  ExternalLink,
  MessageSquareWarning,
  Plus,
  ShieldCheck,
  ThumbsDown,
  ThumbsUp,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { authed } from '../lib/api';
import { formatDay, kr, packageSize, pct, unitLabel, validityLabel } from '../lib/format';
import { useAddToList, useAddWatch, useOffer, usePriceHistory } from '../lib/hooks';
import { useUi } from '../lib/store';
import { storeColor } from '../lib/storeColors';
import { OfferRow, Price, ProductImage, TrustBadge } from './OfferCard';
import { PriceHistoryChart } from './PriceHistoryChart';
import { RulerTicks } from './ui/charts';
import { Button, IconButton, Pill, Skeleton, StoreDot, TextInput } from './ui/primitives';

/** Detaljepanel for et tilbud – åbnes fra alle sider via ?tilbud=<id>. */
export function OfferDrawer() {
  const [params, setParams] = useSearchParams();
  const id = params.get('tilbud') ? Number(params.get('tilbud')) : null;
  const panelRef = useRef<HTMLDivElement>(null);

  const close = () => {
    const next = new URLSearchParams(params);
    next.delete('tilbud');
    setParams(next, { preventScrollReset: true });
  };

  useEffect(() => {
    if (id === null) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    panelRef.current?.focus();
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (id === null) return null;
  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label="Tilbud">
      <button type="button" aria-label="Luk" className="absolute inset-0 bg-[#1a1a1a]/25 backdrop-blur-[2px]" onClick={close} />
      <div
        ref={panelRef}
        tabIndex={-1}
        className="relative flex h-full w-full max-w-[640px] animate-rise flex-col overflow-y-auto bg-canvas shadow-2xl outline-none sm:m-3 sm:h-[calc(100%-24px)] sm:rounded-[34px]"
      >
        <DrawerBody id={id} onClose={close} />
      </div>
    </div>
  );
}

function DrawerBody({ id, onClose }: { id: number; onClose: () => void }) {
  const { data, isLoading, error } = useOffer(id);
  const offer = data?.offer;
  const history = usePriceHistory(offer?.productId ?? null);

  return (
    <>
      <div className="sticky top-0 z-10 flex items-center justify-between gap-3 bg-canvas/85 px-5 py-4 backdrop-blur-md sm:px-7">
        <span className="flex items-center gap-2 text-sm text-muted">
          {offer && (
            <>
              <StoreDot color={storeColor(offer.store.id)} />
              {offer.store.name} · {categoryLabel(offer.category)}
            </>
          )}
        </span>
        <IconButton label="Luk" onClick={onClose}>
          <X className="size-4" />
        </IconButton>
      </div>

      {isLoading && (
        <div className="space-y-4 px-7">
          <Skeleton className="h-56" />
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="h-40" />
        </div>
      )}
      {error && <p className="px-7 text-bad">Tilbuddet kunne ikke hentes.</p>}

      {offer && data && (
        <div className="space-y-4 px-4 pb-8 sm:px-6">
          <section className="card overflow-hidden p-5 sm:p-6">
            <div className="grid gap-5 sm:grid-cols-[200px_1fr]">
              <div className="rounded-[24px] bg-raised p-4 shadow-pill">
                <ProductImage src={offer.imageUrl} category={offer.category} alt={offer.title} className="h-44 w-full" />
              </div>
              <div className="flex min-w-0 flex-col">
                <div className="flex flex-wrap gap-1.5">
                  <TrustBadge offer={offer} />
                  <ValidityPill offer={offer} />
                </div>
                <h2 className="mt-3 text-2xl leading-tight tracking-[-0.02em] text-ink">{offer.title}</h2>
                {offer.description && <p className="mt-1 text-sm text-muted">{offer.description}</p>}
                <div className="mt-auto flex flex-wrap items-end gap-x-4 gap-y-1 pt-4">
                  <Price value={offer.offerPrice} size="xl" />
                  {offer.originalPrice && (
                    <span className="pb-1 text-sm text-muted">
                      før <span className="line-through">{kr(offer.originalPrice)}</span>
                      {offer.discountPct && <span className="ml-1 text-ink">−{pct(offer.discountPct)}</span>}
                    </span>
                  )}
                </div>
                <p className="tabular mt-1 text-sm text-ink-2">
                  {offer.unitPrice != null && (
                    <>
                      {kr(offer.unitPrice)} kr/{unitLabel(offer.unit)}
                    </>
                  )}
                  {packageSize(offer.unit, offer.quantityMin, offer.quantityMax) && (
                    <span className="text-muted"> · {packageSize(offer.unit, offer.quantityMin, offer.quantityMax)}</span>
                  )}
                </p>
              </div>
            </div>
            <Actions offer={offer} />
          </section>

          <TrustPanel offer={offer} />

          <section className="card p-5 sm:p-6">
            <h3 className="text-lg tracking-tight">Prishistorik</h3>
            <p className="mb-4 text-xs text-muted">Enhedspris for den kanoniske vare på tværs af kæder, 180 dage</p>
            {offer.productId === null ? (
              <p className="text-sm text-muted">Varen er ikke koblet til en kanonisk vare endnu.</p>
            ) : history.isLoading ? (
              <Skeleton className="h-60" />
            ) : history.data ? (
              <PriceHistoryChart history={history.data} currentUnitPrice={offer.unitPrice} highlightStore={offer.store.id} />
            ) : null}
          </section>

          {data.alternatives.length > 0 && (
            <section className="card p-4 sm:p-5">
              <h3 className="px-1 text-lg tracking-tight">Samme vare i andre kæder</h3>
              <p className="mb-2 px-1 text-xs text-muted">Sorteret efter pris pr. {unitLabel(offer.unit)}</p>
              <div className="space-y-1">
                {data.alternatives.map((alt) => (
                  <OfferRow
                    key={alt.id}
                    offer={alt}
                    highlight={alt.unitPrice != null && offer.unitPrice != null && alt.unitPrice < offer.unitPrice}
                  />
                ))}
              </div>
            </section>
          )}

          <Community offer={offer} reports={data.reports} />

          <a
            href={offer.sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="flex items-center justify-center gap-2 py-2 text-sm text-muted hover:text-ink"
          >
            Se kilden <ExternalLink className="size-3.5" />
          </a>
        </div>
      )}
    </>
  );
}

function ValidityPill({ offer }: { offer: OfferDTO }) {
  const v = validityLabel(offer.validFrom, offer.validTo);
  return (
    <Pill tone={v.upcoming ? 'lime' : v.endsSoon ? 'warn' : 'white'} title={`${formatDay(offer.validFrom)} – ${formatDay(offer.validTo)}`}>
      {v.text}
    </Pill>
  );
}

function Actions({ offer }: { offer: OfferDTO }) {
  const add = useAddToList();
  const watch = useAddWatch();
  const [watchOpen, setWatchOpen] = useState(false);
  const [target, setTarget] = useState(() => String(Math.floor(offer.offerPrice)));
  const query = offer.title.length > 60 ? offer.title.slice(0, 60) : offer.title;

  return (
    <div className="mt-5 border-t border-line/70 pt-4">
      <div className="flex flex-wrap gap-2">
        <Button
          tone="dark"
          icon={<Plus className="size-4" />}
          loading={add.isPending}
          onClick={() => add.mutate({ text: offer.title, productId: offer.productId })}
        >
          Tilføj til liste
        </Button>
        <Button icon={<BellPlus className="size-4" />} onClick={() => setWatchOpen((v) => !v)}>
          Prisalarm
        </Button>
      </div>
      {watchOpen && (
        <form
          className="mt-3 flex flex-wrap items-center gap-2 rounded-[22px] bg-black/[0.03] p-3"
          onSubmit={(e) => {
            e.preventDefault();
            const price = Number(target.replace(',', '.'));
            if (price > 0) watch.mutate({ query, productId: offer.productId, targetPrice: price }, { onSuccess: () => setWatchOpen(false) });
          }}
        >
          <span className="text-sm text-ink-2">Giv besked når prisen er under</span>
          <TextInput
            className="w-28"
            inputMode="decimal"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            aria-label="Målpris i kr"
          />
          <span className="text-sm text-muted">kr</span>
          <Button type="submit" tone="lime" size="sm" loading={watch.isPending}>
            Opret
          </Button>
        </form>
      )}
    </div>
  );
}

function TrustPanel({ offer }: { offer: OfferDTO }) {
  const t = offer.trust;
  const gradient =
    t.level === 'real' ? 'grad-green' : t.level === 'ok' ? 'grad-lime' : t.level === 'inflated' ? 'grad-orange' : 'grad-sky';
  // Linealen går fra −30 % (dyrere) til +50 % (billigere) i forhold til normalen.
  const position = t.savingsPct == null ? null : (Math.max(-30, Math.min(50, t.savingsPct)) + 30) / 80;
  return (
    <section className={clsx('grad-card p-5 sm:p-6', gradient)}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm opacity-90">Er dette et reelt tilbud?</p>
          <p className="mt-1 text-[28px] leading-tight tracking-[-0.02em]">{t.label}</p>
        </div>
        <ShieldCheck className="size-7 opacity-80" strokeWidth={1.5} />
      </div>
      <p className="mt-2 max-w-md text-sm leading-snug opacity-95">{t.explanation}</p>
      <div className="mt-5 grid grid-cols-3 gap-3 text-sm">
        <Metric
          label="Faktisk besparelse"
          value={t.savingsPct == null ? '–' : t.savingsPct >= 0 ? pct(t.savingsPct, 1) : `${pct(Math.abs(t.savingsPct), 1)} dyrere`}
        />
        <Metric label="Kædens rabat" value={t.claimedSavingsPct == null ? '–' : pct(t.claimedSavingsPct)} />
        <Metric
          label={`Gns. 90 dage (kr/${unitLabel(offer.unit)})`}
          value={t.avgUnitPrice90d == null ? '–' : kr(t.avgUnitPrice90d)}
        />
      </div>
      <RulerTicks value={position} tone={t.level === 'ok' ? 'dark' : 'light'} className="mt-5" height={30} count={48} />
      <div className="mt-1 flex justify-between text-[10px] opacity-75">
        <span>dyrere</span>
        <span>normalpris</span>
        <span>billigere</span>
      </div>
      <p className="mt-3 text-[11px] opacity-75">
        Baseret på {t.samples} prismålinger. {offer.community.score !== null && `Fællesskabet: ${offer.community.score}% mener det er reelt.`}
      </p>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-white/20 px-3 py-2 ring-1 ring-white/30 backdrop-blur-sm">
      <p className="text-[11px] leading-tight opacity-80">{label}</p>
      <p className="tabular mt-0.5 text-lg leading-tight">{value}</p>
    </div>
  );
}

function Community({ offer, reports }: { offer: OfferDTO; reports: CommunityReportDTO[] }) {
  const qc = useQueryClient();
  const toast = useUi((s) => s.showToast);
  const [verdict, setVerdict] = useState<'real' | 'misleading' | null>(null);
  const [comment, setComment] = useState('');
  const mine = reports.find((r) => r.isMine);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['offer', offer.id] });
    void qc.invalidateQueries({ queryKey: ['search'] });
  };
  const report = useMutation({
    mutationFn: () => authed(`/offers/${offer.id}/reports`, { method: 'POST', body: { verdict, comment } }),
    onSuccess: () => {
      toast('Tak for din vurdering');
      setComment('');
      setVerdict(null);
      refresh();
    },
    onError: (e) => toast(e instanceof Error ? e.message : 'Fejl', 'error'),
  });
  const vote = useMutation({
    mutationFn: ({ reportId, value }: { reportId: number; value: number }) =>
      authed(`/reports/${reportId}/vote`, { method: 'POST', body: { value } }),
    onSuccess: refresh,
    onError: (e) => toast(e instanceof Error ? e.message : 'Fejl', 'error'),
  });

  const total = offer.community.real + offer.community.misleading;

  return (
    <section className="card p-5 sm:p-6">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h3 className="text-lg tracking-tight">Fællesskabet</h3>
          <p className="text-xs text-muted">Er tilbuddet reelt eller misvisende? Del din erfaring.</p>
        </div>
        {total > 0 && (
          <div className="text-right">
            <p className="tabular text-2xl tracking-tight">{offer.community.score}%</p>
            <p className="text-[11px] text-muted">
              reelt · {total} {total === 1 ? 'vurdering' : 'vurderinger'}
            </p>
          </div>
        )}
      </div>
      {total > 0 && (
        <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-black/5" aria-hidden>
          <div className="bg-real" style={{ width: `${offer.community.score}%` }} />
          <div className="ml-0.5 flex-1 bg-bad/70" />
        </div>
      )}

      <div className="mt-4 rounded-[22px] bg-black/[0.03] p-3">
        <p className="mb-2 text-sm text-ink-2">{mine ? 'Opdater din vurdering' : 'Din vurdering'}</p>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            tone={verdict === 'real' ? 'lime' : 'white'}
            icon={<ThumbsUp className="size-3.5" />}
            onClick={() => setVerdict('real')}
          >
            Reelt tilbud
          </Button>
          <Button
            size="sm"
            tone={verdict === 'misleading' ? 'danger' : 'white'}
            icon={<MessageSquareWarning className="size-3.5" />}
            onClick={() => setVerdict('misleading')}
          >
            Misvisende
          </Button>
        </div>
        {verdict && (
          <form
            className="mt-3 flex flex-col gap-2 sm:flex-row"
            onSubmit={(e) => {
              e.preventDefault();
              report.mutate();
            }}
          >
            <TextInput
              className="flex-1"
              placeholder="Kort kommentar (valgfri), fx “samme pris som sidste måned”"
              maxLength={280}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />
            <Button type="submit" tone="dark" loading={report.isPending}>
              Send
            </Button>
          </form>
        )}
      </div>

      {reports.length > 0 && (
        <ul className="mt-4 space-y-2">
          {reports.map((r) => (
            <li key={r.id} className="flex gap-3 rounded-[20px] bg-raised p-3 shadow-pill">
              <Pill tone={r.verdict === 'real' ? 'real' : 'bad'} className="mt-0.5">
                {r.verdict === 'real' ? 'Reelt' : 'Misvisende'}
              </Pill>
              <div className="min-w-0 flex-1">
                <p className="text-sm text-ink">{r.comment ?? <span className="text-muted">Ingen kommentar</span>}</p>
                <p className="mt-0.5 text-[11px] text-muted">
                  {r.author} · {formatDay(r.createdAt)}
                </p>
              </div>
              {!r.isMine && (
                <div className="flex shrink-0 items-center gap-1">
                  <IconButton
                    size="sm"
                    tone={r.myVote === 1 ? 'dark' : 'ghost'}
                    label="Hjælpsom"
                    onClick={() => vote.mutate({ reportId: r.id, value: r.myVote === 1 ? 0 : 1 })}
                  >
                    <ThumbsUp className="size-3.5" />
                  </IconButton>
                  <span className="tabular w-6 text-center text-xs text-ink-2">{r.upvotes - r.downvotes}</span>
                  <IconButton
                    size="sm"
                    tone={r.myVote === -1 ? 'dark' : 'ghost'}
                    label="Ikke hjælpsom"
                    onClick={() => vote.mutate({ reportId: r.id, value: r.myVote === -1 ? 0 : -1 })}
                  >
                    <ThumbsDown className="size-3.5" />
                  </IconButton>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
