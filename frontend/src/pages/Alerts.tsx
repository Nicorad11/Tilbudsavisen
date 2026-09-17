import { useMutation, useQueryClient } from '@tanstack/react-query';
import { BellRing, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { OfferRow } from '../components/OfferCard';
import { PulseRow, RadarRings } from '../components/ui/charts';
import { Button, Card, EmptyState, IconButton, Pill, SectionHeader, Skeleton, TextInput } from '../components/ui/primitives';
import { authed } from '../lib/api';
import { kr, relativeTime } from '../lib/format';
import { useAddWatch, useNotifications, useWatches } from '../lib/hooks';

export function Alerts() {
  const watches = useWatches();
  const notes = useNotifications();
  const add = useAddWatch();
  const qc = useQueryClient();
  const [query, setQuery] = useState('');
  const [price, setPrice] = useState('');
  const remove = useMutation({
    mutationFn: (id: number) => authed(`/watchlist/${id}`, { method: 'DELETE' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['watches'] }),
  });
  const triggered = watches.data?.filter((w) => w.triggered).length ?? 0;

  return (
    <div className="space-y-5 pt-2 lg:pt-4">
      <div>
        <p className="text-sm text-muted">Vi holder øje med alle aviser for dig</p>
        <h1 className="mt-1 text-[36px] leading-[1.05] tracking-[-0.045em] sm:text-[48px]">Prisalarmer</h1>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Card className="p-5 sm:p-6">
          <p className="text-lg tracking-tight">Følg en vare</p>
          <p className="text-sm text-muted">Du får besked (og e-mail hvis du har en konto), når varen er på tilbud under din pris.</p>
          <form
            className="mt-4 flex flex-col gap-2 sm:flex-row"
            onSubmit={(e) => {
              e.preventDefault();
              const target = Number(price.replace(',', '.'));
              if (query.trim().length >= 2 && target > 0) {
                add.mutate(
                  { query: query.trim(), targetPrice: target },
                  {
                    onSuccess: () => {
                      setQuery('');
                      setPrice('');
                    },
                  },
                );
              }
            }}
          >
            <TextInput className="flex-1" placeholder="Vare, fx “kaffe” eller “lurpak smør”" value={query} maxLength={80} onChange={(e) => setQuery(e.target.value)} />
            <TextInput
              className="sm:w-40"
              inputMode="decimal"
              placeholder="Under kr"
              value={price}
              onChange={(e) => setPrice(e.target.value.replace(/[^\d,.]/g, ''))}
            />
            <Button type="submit" tone="dark" loading={add.isPending}>
              Opret alarm
            </Button>
          </form>
        </Card>

        <div className="grad-card grad-pink flex min-h-[180px] items-center gap-4 p-5">
          <RadarRings className="size-24 shrink-0" />
          <div>
            <p className="text-3xl tracking-tight">{watches.data?.length ?? 0} følger</p>
            <p className="text-sm text-white/85">{triggered} på tilbud lige nu</p>
            <PulseRow className="mt-3 justify-start" />
          </div>
        </div>
      </div>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div>
          <SectionHeader title="Dine alarmer" />
          <div className="mt-3 space-y-3">
            {watches.isLoading && <Skeleton className="h-24 rounded-[26px]" />}
            {watches.data?.length === 0 && (
              <Card>
                <EmptyState icon={<BellRing className="size-6" />} title="Ingen alarmer endnu">
                  Opret en alarm ovenfor – eller tryk “Prisalarm” på et tilbud.
                </EmptyState>
              </Card>
            )}
            {watches.data?.map((w) => (
              <Card key={w.id} className="p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-[15px]">{w.query}</p>
                    <p className="text-xs text-muted">under {kr(w.targetPrice)} kr · oprettet {relativeTime(w.createdAt)}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {w.triggered ? <Pill tone="lime">På tilbud</Pill> : <Pill tone="ghost">Venter</Pill>}
                    <IconButton label="Slet alarm" size="sm" tone="ghost" onClick={() => remove.mutate(w.id)}>
                      <Trash2 className="size-4" />
                    </IconButton>
                  </div>
                </div>
                {w.currentBest && (
                  <div className="mt-2 rounded-[20px] bg-black/[0.025]">
                    <OfferRow offer={w.currentBest} highlight={w.triggered} />
                  </div>
                )}
              </Card>
            ))}
          </div>
        </div>
        <div>
          <SectionHeader title="Notifikationer" />
          <Card className="mt-3 p-2">
            {notes.data?.length ? (
              <ul>
                {notes.data.map((n) => (
                  <li key={n.id} className="rounded-2xl px-3 py-2.5">
                    <p className="text-[13px] leading-snug">{n.message}</p>
                    <p className="text-[11px] text-muted">{relativeTime(n.createdAt)}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="p-4 text-sm text-muted">Når en alarm udløses efter en scraping, dukker den op her.</p>
            )}
          </Card>
        </div>
      </section>
    </div>
  );
}
