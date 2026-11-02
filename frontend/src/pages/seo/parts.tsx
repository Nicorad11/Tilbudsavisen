import type { SeoFaq, SeoLink, SeoOffer, TrustCounts, TrustLevel } from '@tilbudsradar/shared';
import clsx from 'clsx';
import { ChevronRight, Compass } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Button, EmptyState, Skeleton, StoreDot } from '../../components/ui/primitives';
import { kr, packageSize, TIME_ZONE, unitLabel, validityLabel } from '../../lib/format';
import { useSeo } from '../../lib/seo';

/* Fælles byggeklodser til datasiderne (/tilbud, /butik, /kategori …). */

const updatedFmt = new Intl.DateTimeFormat('da-DK', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: TIME_ZONE,
});

export function Breadcrumbs({ links }: { links: SeoLink[] }) {
  return (
    <nav aria-label="Brødkrummer" className="text-[13px] text-muted">
      <ol className="flex flex-wrap items-center gap-1">
        {links.map((l, i) => (
          <li key={l.href} className="flex items-center gap-1">
            {i > 0 && <ChevronRight className="size-3.5 text-faint" aria-hidden />}
            {i === links.length - 1 ? (
              <span aria-current="page" className="text-ink-2">
                {l.label}
              </span>
            ) : (
              <Link to={l.href} className="hover:text-ink">
                {l.label}
              </Link>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** Overskrift, data-resumé og "Opdateret …" – det første på hver dataside. */
export function PageHead({
  crumbs,
  kicker,
  title,
  summary,
  updatedAt,
  children,
}: {
  crumbs: SeoLink[];
  kicker: string;
  title: string;
  summary?: string;
  updatedAt: string | null;
  children?: ReactNode;
}) {
  return (
    <header className="max-w-[780px] space-y-4">
      <Breadcrumbs links={crumbs} />
      <div>
        <p className="text-sm text-muted">{kicker}</p>
        <h1 className="mt-1 text-[36px] leading-[1.05] tracking-[-0.045em] text-ink sm:text-[50px]">{title}</h1>
      </div>
      {summary && <p className="text-[17px] leading-snug text-ink-2">{summary}</p>}
      {updatedAt && (
        <p className="text-[13px] text-muted">
          Opdateret <time dateTime={updatedAt}>{updatedFmt.format(new Date(updatedAt))}</time> ud fra kædernes tilbudsaviser.
        </p>
      )}
      {children}
    </header>
  );
}

export function Section({ title, id, children, className }: { title: string; id?: string; children: ReactNode; className?: string }) {
  return (
    <section id={id} className={clsx('scroll-mt-24 space-y-4', className)}>
      <h2 className="text-[26px] leading-tight tracking-[-0.035em] text-ink sm:text-[30px]">{title}</h2>
      {children}
    </section>
  );
}

const TRUST_STYLE: Record<TrustLevel, string> = {
  real: 'bg-lime text-ink',
  ok: 'bg-lime/40 text-ink',
  inflated: 'bg-[#ffd9d2] text-[#8a2a17]',
  unknown: 'bg-black/[0.06] text-ink-2',
};

export function TrustBadge({ trust }: { trust: SeoOffer['trust'] }) {
  return (
    <span className={clsx('inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-[12px] font-medium', TRUST_STYLE[trust.level])}>
      {trust.label}
      {trust.savingsPct != null && trust.level !== 'unknown' && trust.savingsPct > 0 ? ` · −${Math.round(trust.savingsPct)} %` : ''}
    </span>
  );
}

const unitPriceText = (o: SeoOffer) => (o.unitPrice == null ? '–' : `${kr(o.unitPrice)} kr/${unitLabel(o.unit)}`);

/**
 * Tilbud som tabel – sorteret af serveren. På mobil foldes kolonnerne sammen,
 * så hver række stadig kan læses (kæde og gyldighed under varen).
 * `now` er sidens beregningstidspunkt, så server og browser skriver det samme.
 */
export function OfferTable({ offers, now, caption }: { offers: SeoOffer[]; now: string; caption: string }) {
  const at = new Date(now);
  return (
    <div className="overflow-hidden rounded-[26px] bg-surface shadow-soft">
      <table className="w-full text-left text-[14px]">
        <caption className="sr-only">{caption}</caption>
        <thead className="border-b border-black/[0.06] text-[12.5px] text-muted">
          <tr>
            <th scope="col" className="px-4 py-3 font-normal">
              Vare
            </th>
            <th scope="col" className="hidden px-3 py-3 font-normal md:table-cell">
              Kæde
            </th>
            <th scope="col" className="px-3 py-3 text-right font-normal">
              Pris
            </th>
            <th scope="col" className="hidden px-3 py-3 text-right font-normal sm:table-cell">
              Pr. enhed
            </th>
            <th scope="col" className="hidden px-3 py-3 text-right font-normal lg:table-cell">
              Normalpris
            </th>
            <th scope="col" className="hidden px-3 py-3 font-normal md:table-cell">
              Gælder
            </th>
            <th scope="col" className="hidden px-4 py-3 font-normal lg:table-cell">
              Vurdering
            </th>
          </tr>
        </thead>
        <tbody>
          {offers.map((o) => {
            const validity = validityLabel(o.validFrom, o.validTo, at);
            const size = packageSize(o.unit, o.quantityMin, o.quantityMax);
            return (
              <tr key={o.id} className="border-b border-black/[0.05] align-top last:border-0">
                <td className="px-4 py-3">
                  <div className="flex gap-3">
                    {o.imageUrl ? (
                      <img
                        src={o.imageUrl}
                        alt={o.title}
                        width={56}
                        height={56}
                        loading="lazy"
                        decoding="async"
                        className="size-14 shrink-0 rounded-xl bg-white object-contain"
                      />
                    ) : (
                      <span className="size-14 shrink-0 rounded-xl bg-black/[0.04]" aria-hidden />
                    )}
                    <div className="min-w-0 space-y-1">
                      <p className="leading-snug text-ink">{o.title}</p>
                      <p className="text-[12.5px] text-muted">
                        <span className="inline-flex items-center gap-1.5 md:hidden">
                          <StoreDot color={o.store.color} />
                          {o.store.name} ·{' '}
                        </span>
                        {size && <span>{size} · </span>}
                        <span className={clsx('md:hidden', validity.upcoming && 'text-ink')}>{validity.text}</span>
                      </p>
                      <div className="lg:hidden">
                        <TrustBadge trust={o.trust} />
                      </div>
                    </div>
                  </div>
                </td>
                <td className="hidden px-3 py-3 md:table-cell">
                  <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                    <StoreDot color={o.store.color} />
                    {o.store.name}
                  </span>
                </td>
                <td className="tabular px-3 py-3 text-right whitespace-nowrap">
                  <span className="text-ink">{kr(o.offerPrice)} kr</span>
                  <span className="block text-[12.5px] text-muted sm:hidden">{unitPriceText(o)}</span>
                </td>
                <td className="tabular hidden px-3 py-3 text-right whitespace-nowrap text-ink sm:table-cell">{unitPriceText(o)}</td>
                <td className="tabular hidden px-3 py-3 text-right whitespace-nowrap text-muted lg:table-cell">
                  {o.originalPrice ? (
                    <>
                      <s>{kr(o.originalPrice)} kr</s>
                      {o.discountPct ? <span className="block text-[12.5px]">−{o.discountPct} %</span> : null}
                    </>
                  ) : (
                    '–'
                  )}
                </td>
                <td className={clsx('hidden px-3 py-3 whitespace-nowrap md:table-cell', validity.upcoming ? 'text-ink' : 'text-ink-2')}>
                  {validity.text}
                </td>
                <td className="hidden px-4 py-3 lg:table-cell">
                  <TrustBadge trust={o.trust} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const TRUST_ROWS: { level: TrustLevel; label: string; text: string }[] = [
  { level: 'real', label: 'Reelle tilbud', text: 'mindst 10 % under varens gennemsnitspris de sidste 90 dage' },
  { level: 'ok', label: 'Lille besparelse', text: '3–10 % under gennemsnittet' },
  { level: 'inflated', label: 'Ikke billigere', text: 'som eller over gennemsnittet – eller en mulig opskrevet førpris' },
  { level: 'unknown', label: 'For lidt historik', text: 'vi har endnu ikke nok priser til at vurdere tilbuddet' },
];

/** "Er tilbuddene reelle?" – fordelingen på vurderinger og et link til metoden. */
export function TrustBreakdown({ counts, title = 'Er tilbuddene reelle?' }: { counts: TrustCounts; title?: string }) {
  const total = counts.real + counts.ok + counts.inflated + counts.unknown;
  if (!total) return null;
  return (
    <Section title={title}>
      <ul className="grid gap-3 sm:grid-cols-2">
        {TRUST_ROWS.map((r) => (
          <li key={r.level} className="flex items-start gap-3 rounded-[22px] bg-surface-2 p-4 shadow-soft">
            <span className={clsx('tabular grid min-w-11 place-items-center rounded-full px-2 py-1 text-[15px] font-medium', TRUST_STYLE[r.level])}>
              {counts[r.level].toLocaleString('da-DK')}
            </span>
            <span className="text-[14px] leading-snug text-ink-2">
              <span className="block text-ink">{r.label}</span>
              {r.text}
            </span>
          </li>
        ))}
      </ul>
      <p className="text-[13.5px] text-muted">
        Vi måler hvert tilbud mod varens egen pris pr. kg, liter eller stk. de sidste 90 dage – ikke mod den førpris, kæden skriver.{' '}
        <Link to="/metode" className="text-ink underline">
          Sådan vurderer vi tilbuddene
        </Link>
        .
      </p>
    </Section>
  );
}

/** Spørgsmål og svar – altid synlige, så både læsere og søgemaskiner ser svarene. */
export function QaList({ items, title = 'Spørgsmål og svar' }: { items: SeoFaq[]; title?: string }) {
  if (!items.length) return null;
  return (
    <Section title={title}>
      <div className="divide-y divide-black/[0.07] rounded-[26px] bg-surface px-5 shadow-soft sm:px-7">
        {items.map((f) => (
          <div key={f.q} className="py-4">
            <h3 className="text-[16.5px] tracking-tight text-ink">{f.q}</h3>
            <p className="mt-1.5 text-[14.5px] leading-relaxed text-ink-2">{f.a}</p>
          </div>
        ))}
      </div>
    </Section>
  );
}

export function LinkList({ links, columns = 3 }: { links: SeoLink[]; columns?: 2 | 3 | 4 }) {
  if (!links.length) return null;
  return (
    <ul className={clsx('grid gap-2', columns === 2 ? 'sm:grid-cols-2' : columns === 3 ? 'sm:grid-cols-2 lg:grid-cols-3' : 'sm:grid-cols-3 lg:grid-cols-4')}>
      {links.map((l) => (
        <li key={l.href}>
          <Link
            to={l.href}
            className="flex items-baseline justify-between gap-3 rounded-[18px] bg-surface-2 px-4 py-3 text-[14.5px] text-ink shadow-soft transition hover:bg-raised"
          >
            <span>{l.label}</span>
            {l.detail && <span className="tabular text-[12.5px] whitespace-nowrap text-muted">{l.detail}</span>}
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** Siden findes ikke – samme 404 som de øvrige offentlige sider. */
export function SeoNotFound() {
  useSeo();
  return (
    <EmptyState
      className="pt-16"
      icon={<Compass className="size-6" />}
      title="Siden findes ikke"
      action={
        <Link to="/tilbud">
          <Button tone="dark">Se alle varer på tilbud</Button>
        </Link>
      }
    />
  );
}

/** Kun ved navigation i browseren – første visning er altid server-renderet. */
export function SeoLoading() {
  return (
    <div className="space-y-6 pt-8" aria-busy="true">
      <Skeleton className="h-4 w-48" />
      <Skeleton className="h-12 w-3/4" />
      <Skeleton className="h-5 w-2/3" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}

/** Uafhængighed: kædenavne bruges kun til at beskrive, hvor tilbuddene kommer fra. */
export function Independence({ chains }: { chains: string }) {
  return (
    <p className="text-[12.5px] leading-snug text-muted">
      Tilbudsradar er ikke tilknyttet {chains}. Priserne kommer fra kædernes tilbudsaviser – kædens pris i butikken gælder altid.
    </p>
  );
}
