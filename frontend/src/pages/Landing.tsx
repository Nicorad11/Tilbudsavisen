import { PLAN } from '@tilbudsradar/shared';
import { ArrowRight, BadgeCheck, BellRing, Check, ChartLine, Instagram, ListChecks, ReceiptText, Search, ShieldAlert, Store, Minus } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router';
import { Faq, FAQ } from '../components/marketing/Faq';
import { HeroVisual } from '../components/marketing/HeroVisual';
import { PriceCard } from '../components/marketing/PriceCard';
import { SearchBox } from '../components/SearchBox';
import { DotNumber } from '../components/ui/DotNumber';
import { Button, Pill } from '../components/ui/primitives';
import { useAccess } from '../lib/access';
import { track } from '../lib/analytics';
import { COMPANY } from '../lib/company';
import { useStats } from '../lib/hooks';
import { storeColor } from '../lib/storeColors';

const CHAINS = [
  { id: 'rema1000', name: 'REMA 1000' },
  { id: 'netto', name: 'Netto' },
  { id: 'foetex', name: 'føtex' },
  { id: 'bilka', name: 'Bilka' },
  { id: 'lidl', name: 'Lidl' },
];

/** Offentlig forside for besøgende. Indloggede sendes direkte til appen. */
export function Landing() {
  const { isMember } = useAccess();
  const { search } = useLocation();
  // Bevar fx UTM-parametre fra Instagram-links ved viderestilling.
  if (isMember) return <Navigate to={`/app${search}`} replace />;

  return (
    <div className="space-y-24 pt-6 sm:space-y-28 lg:pt-12">
      <Hero />
      <Stats />
      <HowItWorks />
      <Features />
      <Difference />
      <section id="priser" className="scroll-mt-24">
        <Heading kicker="Pris" title={`${PLAN.priceDkk} kr om måneden. Første ${PLAN.trialDays} dage gratis.`} />
        <div className="mt-8">
          <PriceCard />
        </div>
      </section>
      <section id="faq" className="scroll-mt-24">
        <Heading kicker="Spørgsmål og svar" title="Det spørger folk om" />
        <div className="mt-8">
          <Faq items={Object.values(FAQ)} />
        </div>
      </section>
      <FinalCta />
    </div>
  );
}

function Heading({ kicker, title, children }: { kicker: string; title: string; children?: ReactNode }) {
  return (
    <div className="max-w-[720px]">
      <p className="text-sm text-muted">{kicker}</p>
      <h2 className="mt-1 text-[32px] leading-[1.08] tracking-[-0.04em] text-ink sm:text-[44px]">{title}</h2>
      {children && <p className="mt-3 text-[16px] leading-snug text-muted">{children}</p>}
    </div>
  );
}

function Hero() {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  return (
    <section className="grid items-center gap-12 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      <div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12.5px] text-ink-2">
          {CHAINS.map((c) => (
            <span key={c.id} className="inline-flex items-center gap-1.5">
              <span className="size-2 rounded-full" style={{ background: storeColor(c.id) }} />
              {c.name}
            </span>
          ))}
        </div>
        <h1 className="mt-5 text-[46px] leading-[1.02] tracking-[-0.05em] text-ink sm:text-[64px] lg:text-[72px]">
          Alle tilbudsaviser.
          <br />
          <span className="relative inline-block">
            <span className="absolute inset-x-[-0.06em] bottom-[0.08em] h-[0.4em] rounded-[0.12em] bg-lime" aria-hidden />
            <span className="relative">Ét søgefelt.</span>
          </span>
        </h1>
        <p className="mt-5 max-w-[48ch] text-[17px] leading-snug text-muted">
          Find ugens billigste pris pr. kilo på tværs af kæderne – og se med det samme, om tilbuddet faktisk er et tilbud.
        </p>
        <SearchBox
          variant="hero"
          className="mt-7 max-w-xl"
          value={q}
          onValueChange={setQ}
          onSearch={(term, opts) => {
            track('Søgning fra forsiden');
            navigate(`/app/sog?q=${encodeURIComponent(term)}${opts?.category ? `&kategori=${encodeURIComponent(opts.category)}` : ''}`);
          }}
          placeholder="Prøv fx okse, kaffe eller kyllingebryst"
          submitLabel="Søg gratis"
        />
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Link to="/app/konto?opret=1" onClick={() => track('CTA prøv gratis', { placering: 'hero' })}>
            <Button tone="dark" size="lg" icon={<ArrowRight className="size-4" />}>
              Prøv gratis i {PLAN.trialDays} dage
            </Button>
          </Link>
          <Link to="/priser">
            <Button size="lg">Se priser</Button>
          </Link>
        </div>
        <p className="mt-3 text-[12.5px] text-muted">Intet kort · Ingen binding · Derefter {PLAN.priceDkk} kr/md, hvis du vil fortsætte</p>
      </div>
      <HeroVisual />
    </section>
  );
}

function Stats() {
  const stats = useStats();
  const total = stats.data?.totalOffers;
  return (
    <section className="grid gap-4 sm:grid-cols-3">
      <Stat
        value={total ? total.toLocaleString('da-DK').replace(/\./g, '.') : '1.500'}
        suffix={total ? '' : '+'}
        label="aktive tilbud lige nu"
      />
      <Stat value="5" label="kæder sammenlignet" />
      <Stat value="2" suffix="×" label="opdateret hver dag" />
    </section>
  );
}

function Stat({ value, suffix, label }: { value: string; suffix?: string; label: string }) {
  return (
    <div className="flex items-end gap-3 rounded-[28px] bg-surface-2 px-6 py-5 shadow-soft">
      <span className="flex items-end text-ink">
        <DotNumber value={value.replace(/[^\d.]/g, '')} height={44} animate={false} />
        {suffix && <span className="ml-1 pb-1 text-2xl text-ink-2">{suffix}</span>}
      </span>
      <span className="pb-1 text-[14px] text-muted">{label}</span>
    </div>
  );
}

function HowItWorks() {
  const steps = [
    { icon: Search, title: 'Søg én gang', text: 'Skriv "okse" – vi foreslår "hakket oksekød" og finder alle tilbud i ugens aviser.' },
    { icon: ChartLine, title: 'Sammenlign pr. kilo', text: 'Vi regner prisen om pr. kg, liter eller stk. og sorterer, så den billigste står øverst.' },
    { icon: BadgeCheck, title: 'Køb det der er reelt', text: 'Hvert tilbud måles mod varens pris de sidste 90 dage, så du ser om besparelsen er ægte.' },
  ];
  return (
    <section>
      <Heading kicker="Sådan virker det" title="Fra fem aviser til ét svar">
        Ingen bladren. Tilbudsradar henter aviserne automatisk to gange om dagen.
      </Heading>
      <div className="mt-8 grid gap-4 md:grid-cols-3">
        {steps.map((s, i) => (
          <div key={s.title} className="card p-6">
            <div className="flex items-center justify-between">
              <span className="grid size-11 place-items-center rounded-full bg-lime">
                <s.icon className="size-5" strokeWidth={1.7} />
              </span>
              <span className="text-[13px] text-faint">0{i + 1}</span>
            </div>
            <p className="mt-5 text-[20px] tracking-[-0.02em] text-ink">{s.title}</p>
            <p className="mt-2 text-[14.5px] leading-snug text-muted">{s.text}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function Features() {
  const items = [
    { icon: Search, title: 'Søg på tværs af alle aviser', text: 'Ét søgefelt for REMA 1000, Netto, føtex, Bilka og Lidl – også næste uges aviser.', free: true },
    { icon: BadgeCheck, title: 'Reelt tilbud eller ej', text: 'Målt mod varens egen pris de sidste 90 dage, med advarsel om opskrevne førpriser.', free: true },
    { icon: ListChecks, title: 'Butiks-splitting', text: 'Indkøbslisten finder den billigste kombination af en eller to butikker.' },
    { icon: BellRing, title: 'Prisalarmer', text: 'Få en mail, når din kaffe eller dit smør kommer på tilbud under din pris.' },
    { icon: ReceiptText, title: 'Kvitteringstjek', text: 'Scan kvitteringen og se hvad du sparede – og om kassen slog forkert ind.' },
    { icon: ChartLine, title: 'Prishistorik', text: 'Følg prisen på en vare i hver kæde over tid, så du ved hvornår du skal slå til.' },
  ];
  return (
    <section id="funktioner" className="scroll-mt-24">
      <Heading kicker="Funktioner" title="Alt det, tilbudsaviserne ikke regner ud for dig" />
      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((f) => (
          <div key={f.title} className="rounded-[26px] bg-surface-2 p-6 shadow-soft">
            <div className="flex items-center justify-between gap-3">
              <span className="grid size-10 place-items-center rounded-full bg-raised shadow-pill">
                <f.icon className="size-[18px]" strokeWidth={1.6} />
              </span>
              <Pill tone={f.free ? 'ghost' : 'lime'}>{f.free ? 'Gratis' : 'Med abonnement'}</Pill>
            </div>
            <p className="mt-5 text-[18px] tracking-[-0.02em] text-ink">{f.title}</p>
            <p className="mt-1.5 text-[14px] leading-snug text-muted">{f.text}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function Difference() {
  const rows: [string, string][] = [
    ['Du bladrer i én avis ad gangen', 'Ét søgefelt på tværs af alle aviser'],
    ['Prisen står pr. pakke, som avisen skriver den', 'Pris pr. kg, liter og stk. – sorteret med den billigste øverst'],
    ['"Spar 40 %" som kæden skriver det', 'Målt mod varens egen pris de sidste 90 dage'],
    ['Én indkøbsliste – men hvilken butik?', 'Billigste kombination af butikker til hele listen'],
    ['Kvitteringen ryger i skraldespanden', 'Kvitteringstjek: hvad du sparede, og fejl ved kassen'],
  ];
  return (
    <section>
      <Heading kicker="Forskellen" title="Mere end en avis-app">
        De fleste gratis tilbudsapps viser aviserne side for side. Tilbudsradar regner på priserne for dig.
      </Heading>
      <div className="mt-8 overflow-hidden rounded-[30px] bg-surface shadow-soft">
        <div className="grid grid-cols-2 border-b border-black/[0.06] text-[13px]">
          <p className="px-5 py-4 text-muted sm:px-7">Typisk tilbudsavis-app</p>
          <p className="flex items-center gap-2 bg-lime/40 px-5 py-4 font-medium text-ink sm:px-7">Tilbudsradar</p>
        </div>
        {rows.map(([them, us]) => (
          <div key={us} className="grid grid-cols-2 border-b border-black/[0.06] text-[14px] leading-snug last:border-0">
            <p className="flex items-start gap-2.5 px-5 py-4 text-muted sm:px-7">
              <Minus className="mt-0.5 size-4 shrink-0 text-faint" />
              {them}
            </p>
            <p className="flex items-start gap-2.5 bg-lime/25 px-5 py-4 text-ink sm:px-7">
              <Check className="mt-0.5 size-4 shrink-0" strokeWidth={2.2} />
              {us}
            </p>
          </div>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2 text-[12.5px] text-muted">
        <ShieldAlert className="size-4" strokeWidth={1.6} /> Vi er uafhængige og ikke tilknyttet kæderne.
        <Store className="ml-2 size-4" strokeWidth={1.6} /> Kædens egen pris i butikken gælder altid.
      </div>
    </section>
  );
}

function FinalCta() {
  return (
    <section className="grad-card grad-green flex flex-col items-start gap-6 p-7 sm:p-10 lg:flex-row lg:items-end lg:justify-between">
      <div>
        <p className="text-sm text-white/80">Klar til at spare på næste indkøbstur?</p>
        <p className="mt-2 max-w-[18ch] text-[34px] leading-[1.05] tracking-[-0.04em] text-white sm:text-[46px]">Bladr mindre. Spar mere.</p>
      </div>
      <div className="flex flex-col items-start gap-3">
        <Link to="/app/konto?opret=1" onClick={() => track('CTA prøv gratis', { placering: 'bund' })}>
          <Button tone="lime" size="lg" icon={<ArrowRight className="size-4" />}>
            Prøv gratis i {PLAN.trialDays} dage
          </Button>
        </Link>
        {COMPANY.instagram && (
          <a href={COMPANY.instagram} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 text-[14px] text-white/90 hover:text-white">
            <Instagram className="size-4" strokeWidth={1.7} /> Ugens bedste tilbud på Instagram
          </a>
        )}
      </div>
    </section>
  );
}
