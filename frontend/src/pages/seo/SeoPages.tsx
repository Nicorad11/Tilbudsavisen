import type {
  CategoryPageDTO,
  InsightPeriod,
  InsightsDTO,
  MethodPageDTO,
  StorePageDTO,
  StoresHubDTO,
  TermHubDTO,
  TermPageDTO,
  WeeklyBestDTO,
} from '@tilbudsradar/shared';
import { BellRing, Search } from 'lucide-react';
import { Link } from 'react-router';
import { Button, StoreDot } from '../../components/ui/primitives';
import { track } from '../../lib/analytics';
import { kr, TIME_ZONE, unitLabel } from '../../lib/format';
import { useSeoPage } from './data';
import { Independence, LinkList, OfferTable, PageHead, QaList, Section, SeoLoading, SeoNotFound, TrustBreakdown } from './parts';

/* Datasiderne. Alt indhold kommer fra serveren (backend/src/services/seo/pages.ts). */

const CHAINS = 'REMA 1000, Netto, føtex, Bilka eller Lidl';
const longDate = new Intl.DateTimeFormat('da-DK', { day: 'numeric', month: 'long', year: 'numeric', timeZone: TIME_ZONE });
const weekdayDate = new Intl.DateTimeFormat('da-DK', { weekday: 'long', day: 'numeric', month: 'long', timeZone: TIME_ZONE });

function Page({ children }: { children: React.ReactNode }) {
  return <div className="space-y-14 pt-6 pb-4 lg:pt-10">{children}</div>;
}

/* ---------------- /tilbud/{vare} ---------------- */

export function TermPage() {
  const { data } = useSeoPage<TermPageDTO>();
  if (data === null) return <SeoNotFound />;
  if (!data) return <SeoLoading />;
  const unit = data.unit ? unitLabel(data.unit) : null;
  const h = data.history;
  return (
    <Page>
      <PageHead
        crumbs={data.breadcrumbs}
        kicker={`Tilbud i uge ${data.week}`}
        title={`${data.label} på tilbud i uge ${data.week}`}
        summary={data.summary}
        updatedAt={data.updatedAt}
      >
        <div className="flex flex-wrap gap-3 pt-1">
          <Link
            to={`/app/alarmer?vare=${encodeURIComponent(data.phrase)}`}
            onClick={() => track('Dataside CTA', { side: 'vare', handling: 'prisalarm' })}
          >
            <Button tone="dark" icon={<BellRing className="size-4" />}>
              Få besked, når {data.phrase} kommer på tilbud
            </Button>
          </Link>
          <Link to={`/app/sog?q=${encodeURIComponent(data.phrase)}`} onClick={() => track('Dataside CTA', { side: 'vare', handling: 'søg' })}>
            <Button icon={<Search className="size-4" />}>Søg i alle tilbud</Button>
          </Link>
        </div>
      </PageHead>

      {data.offers.length > 0 && (
        <Section title={`Alle tilbud på ${data.phrase}${unit ? ` – billigst pr. ${unit} øverst` : ''}`}>
          <OfferTable offers={data.offers} now={data.generatedAt} caption={`Tilbud på ${data.phrase} i uge ${data.week}, sorteret efter pris pr. enhed`} />
          <Independence chains={CHAINS} />
        </Section>
      )}

      <TrustBreakdown counts={data.trustCounts} />

      {(h.lowest || h.medianUnitPrice != null || h.byStore.length > 0) && unit && (
        <Section title={`Prisen på ${data.phrase} over tid`}>
          <dl className="grid gap-4 sm:grid-cols-3">
            {h.lowest && (
              <Fact label={`Laveste pris siden ${longDate.format(new Date(h.since))}`}>
                {kr(h.lowest.unitPrice)} kr/{unit}
                <span className="block text-[13px] text-muted">
                  hos {h.lowest.storeName} i uge {h.lowest.week}
                </span>
              </Fact>
            )}
            {h.medianUnitPrice != null && (
              <Fact label="Typisk tilbudspris">
                {kr(h.medianUnitPrice)} kr/{unit}
                <span className="block text-[13px] text-muted">midterste pris blandt {h.offers} tilbud</span>
              </Fact>
            )}
            {h.byStore[0] && (
              <Fact label="Oftest på tilbud hos">
                {h.byStore[0].name}
                <span className="block text-[13px] text-muted">
                  {h.byStore.map((s) => `${s.name} ${s.count}`).join(' · ')}
                </span>
              </Fact>
            )}
          </dl>
        </Section>
      )}

      <QaList items={data.faq} />

      {data.related.length > 0 && (
        <Section title="Relaterede varer">
          <LinkList links={data.related} />
        </Section>
      )}
      {data.storeLinks.length > 0 && (
        <Section title="Ugens tilbud i kæderne">
          <LinkList links={data.storeLinks} columns={4} />
        </Section>
      )}
    </Page>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-[22px] bg-surface-2 p-5 shadow-soft">
      <dt className="text-[13px] text-muted">{label}</dt>
      <dd className="tabular mt-1 text-[20px] tracking-tight text-ink">{children}</dd>
    </div>
  );
}

/* ---------------- /tilbud ---------------- */

export function TermHubPage() {
  const { data } = useSeoPage<TermHubDTO>();
  if (data === null) return <SeoNotFound />;
  if (!data) return <SeoLoading />;
  return (
    <Page>
      <PageHead
        crumbs={data.breadcrumbs}
        kicker={`Uge ${data.week}`}
        title="Dagligvarer på tilbud A–Å"
        summary={`${data.termCount} dagligvarer med den laveste pris pr. kg, liter eller stk. i ugens aviser fra REMA 1000, Netto, føtex, Bilka og Lidl.`}
        updatedAt={data.updatedAt}
      />
      <nav aria-label="Bogstaver" className="flex flex-wrap gap-1.5">
        {data.groups.map((g) => (
          <a key={g.letter} href={`#bogstav-${g.letter}`} className="grid size-9 place-items-center rounded-full bg-surface-2 text-[14px] text-ink shadow-soft">
            {g.letter}
          </a>
        ))}
      </nav>
      {data.groups.map((g) => (
        <Section key={g.letter} id={`bogstav-${g.letter}`} title={g.letter}>
          <LinkList links={g.terms} />
        </Section>
      ))}
      <p className="text-[13.5px] text-muted">
        Priserne er de laveste pr. enhed blandt ugens tilbud.{' '}
        <Link to="/metode" className="text-ink underline">
          Sådan regner vi
        </Link>
        .
      </p>
    </Page>
  );
}

/* ---------------- /butikker ---------------- */

export function StoresHubPage() {
  const { data } = useSeoPage<StoresHubDTO>();
  if (data === null) return <SeoNotFound />;
  if (!data) return <SeoLoading />;
  return (
    <Page>
      <PageHead
        crumbs={data.breadcrumbs}
        kicker={`Uge ${data.week}`}
        title="Ugens tilbudsaviser"
        summary="Ugens tilbud fra de fem kæder samlet ét sted – med pris pr. kg og vurdering af, om tilbuddene er reelle."
        updatedAt={data.updatedAt}
      />
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {data.stores.map((s) => (
          <li key={s.slug}>
            <Link to={`/butik/${s.slug}`} className="block rounded-[26px] bg-surface-2 p-6 shadow-soft transition hover:bg-raised">
              <span className="flex items-center gap-2 text-[20px] tracking-tight text-ink">
                <StoreDot color={s.color} className="size-3" />
                {s.name} tilbud
              </span>
              <span className="mt-2 block text-[14px] text-ink-2">
                {s.offerCount} tilbud · {s.realCount} reelle
              </span>
              {s.nextCatalogAt && (
                <span className="mt-1 block text-[13px] text-muted">Næste avis fra {weekdayDate.format(new Date(s.nextCatalogAt))}</span>
              )}
            </Link>
          </li>
        ))}
      </ul>
      <Independence chains={CHAINS} />
    </Page>
  );
}

/* ---------------- /butik/{kæde} ---------------- */

export function StorePage() {
  const { data } = useSeoPage<StorePageDTO>();
  if (data === null) return <SeoNotFound />;
  if (!data) return <SeoLoading />;
  const name = data.store.name;
  return (
    <Page>
      <PageHead crumbs={data.breadcrumbs} kicker={`Uge ${data.week}`} title={`${name} tilbud i uge ${data.week}`} summary={data.summary} updatedAt={data.updatedAt} />
      {data.best.length > 0 && (
        <Section title={`De bedste tilbud hos ${name}`}>
          <p className="text-[14.5px] text-ink-2">Sorteret efter den reelle besparelse – målt mod varens egen pris de sidste 90 dage.</p>
          <OfferTable offers={data.best} now={data.generatedAt} caption={`De bedste tilbud hos ${name} i uge ${data.week}`} />
        </Section>
      )}
      <TrustBreakdown counts={data.trustCounts} title={`Er tilbuddene hos ${name} reelle?`} />
      {data.cheapestFor.length > 0 && (
        <Section title={`Her er ${name} billigst lige nu`}>
          <LinkList links={data.cheapestFor} />
        </Section>
      )}
      {data.categories.length > 0 && (
        <Section title="Tilbud pr. kategori">
          <LinkList links={data.categories.map((c) => ({ href: c.href, label: c.label, detail: `${c.count} tilbud` }))} />
        </Section>
      )}
      <Independence chains={name} />
    </Page>
  );
}

/* ---------------- /kategori/{kategori} ---------------- */

export function CategoryPage() {
  const { data } = useSeoPage<CategoryPageDTO>();
  if (data === null) return <SeoNotFound />;
  if (!data) return <SeoLoading />;
  const label = data.label.toLocaleLowerCase('da-DK');
  return (
    <Page>
      <PageHead
        crumbs={data.breadcrumbs}
        kicker={`Uge ${data.week}`}
        title={`${data.label} på tilbud i uge ${data.week}`}
        summary={data.summary}
        updatedAt={data.updatedAt}
      />
      {data.best.length > 0 && (
        <Section title={`De bedste tilbud på ${label}`}>
          <OfferTable offers={data.best} now={data.generatedAt} caption={`De bedste tilbud på ${label} i uge ${data.week}`} />
        </Section>
      )}
      <TrustBreakdown counts={data.trustCounts} />
      {data.terms.length > 0 && (
        <Section title={`Varer i ${label}`}>
          <LinkList links={data.terms} />
        </Section>
      )}
      {data.stores.length > 0 && (
        <Section title="Tilbud pr. kæde">
          <LinkList links={data.stores.map((s) => ({ href: `/butik/${s.slug}`, label: s.name, detail: `${s.count} tilbud` }))} columns={4} />
        </Section>
      )}
      <Independence chains={CHAINS} />
    </Page>
  );
}

/* ---------------- /ugens-bedste-tilbud ---------------- */

export function WeeklyBestPage() {
  const { data } = useSeoPage<WeeklyBestDTO>();
  if (data === null) return <SeoNotFound />;
  if (!data) return <SeoLoading />;
  return (
    <Page>
      <PageHead crumbs={data.breadcrumbs} kicker={`Uge ${data.week}`} title="Ugens bedste tilbud" summary={data.summary} updatedAt={data.updatedAt} />
      {data.best.length > 0 && (
        <Section title="De største reelle besparelser">
          <OfferTable offers={data.best} now={data.generatedAt} caption={`Ugens bedste reelle tilbud i uge ${data.week}`} />
        </Section>
      )}
      {data.byStore.map((s) => (
        <Section key={s.store.href} title={`Bedst hos ${s.store.label}`}>
          <OfferTable offers={s.offers} now={data.generatedAt} caption={`De bedste reelle tilbud hos ${s.store.label}`} />
          <Link to={s.store.href} className="inline-block text-[14px] text-ink underline">
            Alle tilbud hos {s.store.label}
          </Link>
        </Section>
      ))}
      <TrustBreakdown counts={data.trustCounts} title="Alle ugens tilbud fordelt på vurdering" />
      <Independence chains={CHAINS} />
    </Page>
  );
}

/* ---------------- /indsigt ---------------- */

const pct1 = (n: number) => `${n.toLocaleString('da-DK', { maximumFractionDigits: 1 })} %`;
const signedPct = (n: number) => (n < 0 ? `+${pct1(-n)}` : `−${pct1(n)}`);
const dayMonthFmt = new Intl.DateTimeFormat('da-DK', { day: 'numeric', month: 'long', timeZone: TIME_ZONE });
const periodDates = (p: InsightPeriod) => `${dayMonthFmt.format(new Date(p.from))} – ${dayMonthFmt.format(new Date(p.to))}`;

/** Andel reelle tilbud pr. kæde som tabel med en tynd bjælke – tallet står altid ved siden af. */
function ChainTable({ period }: { period: InsightPeriod }) {
  const max = Math.max(1, ...period.stores.map((s) => s.realShare ?? 0));
  return (
    <div className="overflow-hidden rounded-[26px] bg-surface shadow-soft">
      <table className="w-full text-left text-[14px]">
        <caption className="sr-only">
          Andel reelle tilbud pr. kæde, {lowerFirst(period.label)} ({periodDates(period)})
        </caption>
        <thead className="border-b border-black/[0.06] text-[12.5px] text-muted">
          <tr>
            <th scope="col" className="px-4 py-3 font-normal">
              Kæde
            </th>
            <th scope="col" className="px-3 py-3 font-normal">
              Andel reelle
            </th>
            <th scope="col" className="hidden px-3 py-3 text-right font-normal sm:table-cell">
              Reelle / vurderede
            </th>
            <th scope="col" className="px-4 py-3 text-right font-normal">
              Gns. pris mod normalpris
            </th>
          </tr>
        </thead>
        <tbody>
          {period.stores.map((s) => (
            <tr key={s.slug} className="border-b border-black/[0.05] last:border-0">
              <th scope="row" className="px-4 py-3 font-normal text-ink">
                <Link to={`/butik/${s.slug}`} className="hover:underline">
                  {s.name}
                </Link>
              </th>
              <td className="px-3 py-3">
                {s.realShare == null ? (
                  <span className="text-[13px] text-muted">for få vurderede</span>
                ) : (
                  <span className="flex items-center gap-2.5">
                    <span className="hidden h-2 w-24 overflow-hidden rounded-full bg-black/[0.06] sm:block" aria-hidden>
                      <span className="block h-full rounded-full bg-ink" style={{ width: `${(s.realShare / max) * 100}%` }} />
                    </span>
                    <span className="tabular text-ink">{pct1(s.realShare)}</span>
                  </span>
                )}
              </td>
              <td className="tabular hidden px-3 py-3 text-right text-ink-2 sm:table-cell">
                {s.counts.real} / {s.assessed}
              </td>
              <td className="tabular px-4 py-3 text-right text-ink-2">
                {s.avgSavingsPct == null ? (
                  <span className="text-[13px] text-muted">for få målinger</span>
                ) : (
                  <>
                    {signedPct(s.avgSavingsPct)}
                    <span className="block text-[12px] text-muted">{s.measured} målinger</span>
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const lowerFirst = (s: string) => s.charAt(0).toLocaleLowerCase('da-DK') + s.slice(1);

export function InsightsPage() {
  const { data } = useSeoPage<InsightsDTO>();
  if (data === null) return <SeoNotFound />;
  if (!data) return <SeoLoading />;
  const [week, month] = data.periods as [InsightPeriod, InsightPeriod];
  const claimed = week.stores.filter((s) => s.claimed);
  return (
    <Page>
      <PageHead crumbs={data.breadcrumbs} kicker={`Indsigt · uge ${data.week}`} title="Hvor reelle er tilbuddene?" summary={data.summary} updatedAt={data.updatedAt} />

      <section className="grid gap-3 sm:grid-cols-2" aria-label="Hovedtal">
        {[week, month].map((p) => (
          <div key={p.key} className="rounded-[26px] bg-surface-2 px-6 py-5 shadow-soft">
            <p className="text-[13px] text-muted">
              {p.label} · {periodDates(p)}
            </p>
            <p className="tabular mt-2 text-[44px] leading-none tracking-[-0.04em] text-ink">{pct1(p.realShare)}</p>
            <p className="mt-2 text-[14px] text-ink-2">
              af {p.assessed.toLocaleString('da-DK')} vurderede tilbud var reelle{p.mostReal ? ` · flest hos ${p.mostReal.name} (${p.mostReal.count})` : ''}
            </p>
            <p className="mt-1 text-[12.5px] text-muted">
              {p.offers.toLocaleString('da-DK')} tilbud i alt – {(p.offers - p.assessed).toLocaleString('da-DK')} med for lidt prishistorik til en vurdering
            </p>
          </div>
        ))}
      </section>

      <Section title="Andel reelle tilbud pr. kæde">
        <p className="max-w-[760px] text-[15px] leading-snug text-ink-2">
          Reel betyder mindst 10 % under varens gennemsnitspris pr. enhed de sidste 90 dage. Andelen er regnet af de tilbud, vi kunne vurdere.
          Sidste kolonne er tilbudsprisen mod varens normalpris i gennemsnit – for alle kædens tilbud, hvor vi har normalpriser at måle mod,
          også dem, der ikke er billigere. Normalpriser har vi kun fra REMA 1000's webshop, så for de andre kæder er det REMA 1000's
          normalpris for samme vare. Med under 20 vurderede tilbud eller målinger viser vi ikke et tal.
        </p>
        <h3 className="pt-2 text-[17px] text-ink">
          {week.label} <span className="text-muted">· {periodDates(week)}</span>
        </h3>
        <ChainTable period={week} />
        <h3 className="pt-4 text-[17px] text-ink">
          {month.label} <span className="text-muted">· {periodDates(month)}</span>
        </h3>
        <ChainTable period={month} />
      </Section>

      {claimed.length > 0 && (
        <Section title="Rabatten i avisen mod den målte besparelse">
          <p className="max-w-[760px] text-[15px] leading-snug text-ink-2">
            Tilbud med en førpris, {lowerFirst(week.label)}: den rabat, kæden skriver i avisen, ved siden af besparelsen målt mod varens egen
            gennemsnitspris pr. enhed.
          </p>
          <div className="overflow-hidden rounded-[26px] bg-surface shadow-soft">
            <table className="w-full text-left text-[14px]">
              <caption className="sr-only">Rabat ifølge kæden og målt besparelse pr. kæde</caption>
              <thead className="border-b border-black/[0.06] text-[12.5px] text-muted">
                <tr>
                  <th scope="col" className="px-4 py-3 font-normal">
                    Kæde
                  </th>
                  <th scope="col" className="hidden px-3 py-3 text-right font-normal sm:table-cell">
                    Tilbud
                  </th>
                  <th scope="col" className="px-3 py-3 text-right font-normal">
                    Rabat i avisen
                  </th>
                  <th scope="col" className="px-4 py-3 text-right font-normal">
                    Målt mod normalpris
                  </th>
                </tr>
              </thead>
              <tbody>
                {claimed.map((s) => (
                  <tr key={s.slug} className="border-b border-black/[0.05] last:border-0">
                    <th scope="row" className="px-4 py-3 font-normal text-ink">
                      {s.name}
                    </th>
                    <td className="tabular hidden px-3 py-3 text-right text-ink-2 sm:table-cell">{s.claimed!.n}</td>
                    <td className="tabular px-3 py-3 text-right text-ink-2">−{pct1(s.claimed!.claimedPct)}</td>
                    <td className="tabular px-4 py-3 text-right text-ink">{signedPct(s.claimed!.measuredPct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {data.drops.length > 0 && (
        <Section title="Ugens største prisfald">
          <p className="max-w-[760px] text-[15px] leading-snug text-ink-2">
            Tilbud, der gælder nu, med den største besparelse mod kædens egen normalpris for varen pr. enhed. Normalpriser har vi kun fra
            REMA 1000's webshop – de andre kæder offentliggør dem ikke. Besparelser over 60 % er udeladt: de skyldes oftest, at to
            pakkestørrelser ikke kan sammenlignes.
          </p>
          <ol className="space-y-2">
            {data.drops.map((d) => (
              <li key={`${d.store.id}-${d.title}`} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 rounded-[22px] bg-surface-2 px-5 py-4 shadow-soft">
                <span className="min-w-0">
                  <span className="block text-[15px] text-ink">{d.title}</span>
                  <span className="text-[13px] text-muted">
                    {d.store.name}
                    {d.term && (
                      <>
                        {' · '}
                        <Link to={d.term.href} className="underline hover:text-ink">
                          alle tilbud på {d.term.label.toLocaleLowerCase('da-DK')}
                        </Link>
                      </>
                    )}
                  </span>
                </span>
                <span className="tabular text-right text-[14px] text-ink-2">
                  {kr(d.unitPrice)} kr/{unitLabel(d.unit)} <span className="text-muted">mod {kr(d.normalUnitPrice)}</span>
                  <span className="ml-2 rounded-full bg-lime px-2.5 py-0.5 text-[13px] font-medium text-ink">−{pct1(d.savingsPct)}</span>
                </span>
              </li>
            ))}
          </ol>
        </Section>
      )}

      <TrustBreakdown counts={week.counts} title={`${week.label}: alle tilbud fordelt på vurdering`} />
      <QaList items={data.faq} />

      <Section title="Om tallene">
        <div className="max-w-[760px] space-y-3 text-[15px] leading-relaxed text-ink-2">
          <p>
            Tallene dækker alle tilbud fra kædernes tilbudsaviser, der har gældt i perioden – ikke næste uges avis. Hvert tilbud er vurderet
            på samme måde som resten af Tilbudsradar: mod varens gennemsnitspris pr. enhed de sidste 90 dage. Mange varer har vi endnu for
            lidt prishistorik på – de tæller med i det samlede antal, men ikke i andelene. Tilbud, hvor vi kun har tidligere tilbudspriser at
            måle mod, tæller med i fordelingen, men ikke i gennemsnittene. Andele og gennemsnit vises først med mindst 20 tilbud bag.
          </p>
          <p>
            Siden opdateres, hver gang nye aviser hentes.{' '}
            <Link to="/metode" className="text-ink underline">
              Sådan vurderer vi tilbuddene
            </Link>
            .
          </p>
        </div>
      </Section>
      <Independence chains={CHAINS} />
    </Page>
  );
}

/* ---------------- /metode ---------------- */

export function MethodPage() {
  const { data } = useSeoPage<MethodPageDTO>();
  if (data === null) return <SeoNotFound />;
  if (!data) return <SeoLoading />;
  const t = data.thresholds;
  return (
    <Page>
      <PageHead
        crumbs={data.breadcrumbs}
        kicker="Metode"
        title="Sådan beregner vi kilopris og reelle tilbud"
        summary={`Tilbudsradar sammenligner ugens tilbud på pris pr. kg, liter eller stk. og måler hvert tilbud mod varens egen pris de sidste ${t.windowDays} dage. Her er præcis, hvordan vi gør.`}
        updatedAt={data.updatedAt}
      />
      <div className="legal max-w-[760px] space-y-10 text-[15.5px] leading-relaxed text-ink-2">
        <Section title="Hvor priserne kommer fra">
          <p>
            Vi henter tilbudsaviserne fra REMA 1000, Netto, føtex, Bilka og Lidl automatisk to gange om dagen – kl. 6.15 og 18.15 – og gemmer
            hvert tilbud med pris, førpris, pakkestørrelse og gyldighed. Normalpriser (hyldepriser uden tilbud) henter vi fra REMA 1000's webshop
            – de andre kæder offentliggør ikke deres hyldepriser.
            {data.dataSince && (
              <>
                {' '}
                Siden {longDate.format(new Date(data.dataSince))} har vi registreret {data.offersAnalyzed.toLocaleString('da-DK')} tilbud.
              </>
            )}
          </p>
          <p>Kædens egen pris i butikken gælder altid. Finder du en fejl, så skriv til os – se kontaktoplysningerne på siden Om Tilbudsradar.</p>
          <p>
            Hvor mange af ugens tilbud der er reelle i hver kæde, kan du se under{' '}
            <Link to="/indsigt" className="text-ink underline">
              hvor reelle er tilbuddene?
            </Link>
          </p>
        </Section>
        <Section title="Pris pr. kilo, liter og stk.">
          <p>
            Avisernes priser står pr. pakke. Vi læser pakkestørrelsen i tilbuddet – fx 500 g, 6 × 33 cl eller 10 stk. – og regner prisen om til kr
            pr. kg, liter eller stk. Så kan en 400-grams pakke kaffe sammenlignes direkte med en på 500 gram. Gælder tilbuddet flere størrelser,
            bruger vi den laveste pris pr. enhed.
          </p>
        </Section>
        <Section title="Hvornår er et tilbud reelt?">
          <p>
            Vi sammenligner tilbudsprisen pr. enhed med varens gennemsnitspris de sidste {t.windowDays} dage – ikke med den førpris, kæden selv
            skriver. Først bruger vi normalprisen i samme kæde. Har vi ikke nok af den, bruger vi normalpriser for samme vare i en anden kæde. Har
            vi kun tidligere tilbudspriser, kan et tilbud aldrig blive vurderet som reelt – højst som "lavere end før".
          </p>
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <strong className="font-medium text-ink">Reelt tilbud:</strong> mindst {t.realPct} % under gennemsnittet.
            </li>
            <li>
              <strong className="font-medium text-ink">Lille besparelse:</strong> {t.okPct}–{t.realPct} % under gennemsnittet.
            </li>
            <li>
              <strong className="font-medium text-ink">Ikke billigere:</strong> mindre end {t.okPct} % under – eller over – gennemsnittet.
            </li>
            <li>
              <strong className="font-medium text-ink">Opskrevet førpris?</strong> kæden reklamerer med mindst {t.inflatedClaimPct} % rabat, men prisen
              er under {t.inflatedMaxSavingsPct} % lavere end gennemsnittet.
            </li>
            <li>
              <strong className="font-medium text-ink">For lidt historik:</strong> vi har endnu ikke nok priser på varen til at vurdere tilbuddet.
            </li>
          </ul>
        </Section>
        <Section title="Sådan samler vi varesiderne">
          <p>
            Hver vareside – fx{' '}
            <Link to="/tilbud/smoer" className="text-ink underline">
              smør på tilbud
            </Link>{' '}
            – viser de tilbud, hvor varens navn står som et helt ord i titlen, inden for varens kategori. Derfor kommer smørbar ikke med på siden
            for smør, og leverpostej med bacon ikke på siden for bacon. Den laveste pris og den typiske tilbudspris beregnes ud fra de samme
            tilbud de sidste {t.windowDays} dage. Har en vare for få tilbud til at sige noget sikkert, står det på siden.
          </p>
        </Section>
        <Section title="Rækkefølge og uafhængighed">
          <p>
            Der er ingen annoncer eller betalte placeringer. Rækkefølgen afgøres kun af pris pr. enhed og den målte besparelse, og alle kæder
            behandles ens. Tilbudsradar finansieres af abonnementer på appen.
          </p>
        </Section>
        <Section title="Hvem står bag">
          <p>
            Tilbudsradar er uafhængigt og ikke tilknyttet kæderne. Læs mere om, hvem der står bag, på{' '}
            <Link to="/om" className="text-ink underline">
              Om Tilbudsradar
            </Link>
            .
          </p>
        </Section>
      </div>
    </Page>
  );
}
