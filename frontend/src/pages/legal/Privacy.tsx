import { PLAN } from '@tilbudsradar/shared';
import { Link } from 'react-router';
import { COMPANY } from '../../lib/company';
import { DraftNotice, LegalPage, Section, Table } from './LegalPage';

export function Privacy() {
  return (
    <LegalPage kicker="Sådan behandler vi dine personoplysninger" title="Privatlivspolitik" updated="17. oktober 2026">
      <DraftNotice />

      <Section title="Dataansvarlig">
        <p>
          {COMPANY.name}, CVR-nr. {COMPANY.cvr}, {COMPANY.address}, er dataansvarlig for behandlingen af dine personoplysninger på
          Tilbudsradar. Kontakt os på <a href={`mailto:${COMPANY.email}`} className="text-ink underline">{COMPANY.email}</a>.
        </p>
      </Section>

      <Section title="Uden konto">
        <p>
          Du kan søge i tilbudsaviserne og se ugens tilbud uden at oprette en konto. Vi registrerer ikke, hvem du er. Søger du i nærheden
          af et postnummer eller din position, bruges oplysningen kun til at besvare søgningen og gemmes ikke på serveren.
        </p>
      </Section>

      <Section title="Hvilke oplysninger og hvorfor">
        <Table
          head={['Oplysninger', 'Formål', 'Retsgrundlag']}
          rows={[
            ['E-mail og krypteret adgangskode (scrypt-hash)', 'Oprette og logge ind på din konto, sende links til bekræftelse og nulstilling', 'Aftale (art. 6, stk. 1, litra b)'],
            ['Præferencer: foretrukne kæder, postnummer, afstand', 'Tilpasse søgning og indkøbslister', 'Aftale (litra b)'],
            ['Indkøbslister, prisalarmer og notifikationer', 'Levere funktionerne, herunder e-mails når en vare er på tilbud', 'Aftale (litra b)'],
            ['Kvitteringslinjer (varer og beløb – ikke billedet)', 'Vise hvad du sparede og mulige fejl ved kassen', 'Aftale (litra b)'],
            ['Antal kvitteringsscanninger og tokenforbrug', 'Håndhæve månedsloftet og følge omkostningen', 'Aftale (litra b) og legitim interesse (litra f)'],
            ['Prøveperiode, abonnementsstatus, Stripe-kunde-id', 'Give adgang i prøveperioden og abonnementet, sende mails om prøveperioden og betalinger', 'Aftale (litra b)'],
            ['Accept af handelsbetingelserne (tidspunkt og version)', 'Dokumentere aftalen', 'Retlig forpligtelse og legitim interesse (litra c og f)'],
            [
              'SHA-256-hash af din e-mail',
              `Sikre at hver e-mail kun får én gratis prøveperiode på ${PLAN.trialDays} dage – også efter sletning af kontoen`,
              'Legitim interesse (litra f) i at undgå misbrug',
            ],
            ['Fortrydelser (navn, e-mail, tidspunkt)', 'Behandle og dokumentere din fortrydelse', 'Retlig forpligtelse (litra c)'],
            ['Tekniske fejldata (uden navn og e-mail)', 'Finde og rette fejl', 'Legitim interesse (litra f)'],
            [
              'Besøgsstatistik: side, henvisende domæne, kampagnekode, enhedstype og en daglig skiftende kode beregnet ud fra IP-adresse og browser (IP-adressen gemmes ikke)',
              'Tælle besøg og se, hvilke sider der bruges, og hvor besøgende kommer fra',
              'Legitim interesse (litra f) i at forbedre tjenesten',
            ],
          ]}
        />
        <p>Betalingskort håndteres udelukkende af Stripe. Vi ser og gemmer aldrig dine kortoplysninger.</p>
      </Section>

      <Section title="Databehandlere og modtagere">
        <p>Vi bruger disse leverandører, som behandler oplysninger på vores vegne efter databehandleraftaler:</p>
        <Table
          head={['Leverandør', 'Hvad', 'Placering og overførsel']}
          rows={[
            ['Render Services, Inc.', 'Hosting af hjemmeside, API og database (konto, lister, alarmer og kvitteringslinjer)', 'EU (Frankfurt). Amerikansk selskab – EU-standardkontrakter og EU-US Data Privacy Framework.'],
            ['Stripe Payments Europe, Ltd.', 'Betaling, abonnement, fakturaer og kundeportal', 'EU (Irland), med overførsel til Stripe, Inc. i USA under Data Privacy Framework og standardkontrakter. Stripe er selvstændigt dataansvarlig for visse betalingsoplysninger.'],
            ['E-mailudbyder (Resend eller Postmark)', 'Afsendelse af mails om konto, prøveperiode, betaling og prisalarmer', 'EU-region hvor muligt; ellers USA under Data Privacy Framework og standardkontrakter.'],
            ['Anthropic PBC', 'Aflæsning af kvitteringsbilleder med Claude – kun når du selv scanner en kvittering', 'USA under Data Privacy Framework og standardkontrakter. Billedet bruges ikke til at træne modeller og slettes hos Anthropic efter en kort periode.'],
            ['Functional Software, Inc. (Sentry) – kun hvis slået til', 'Fejlovervågning uden navn, e-mail og IP-adresse', 'EU (Frankfurt).'],
            ['Plausible Insights OÜ – kun hvis slået til', 'Cookiefri besøgsstatistik uden persondata', 'EU (Tyskland/Finland).'],
          ]}
        />
        <p>
          Priserne i appen hentes fra kædernes offentlige tilbudsaviser via Tjek (eTilbudsavis). Der sendes ingen oplysninger om dig til
          kæderne eller til Tjek.
        </p>
      </Section>

      <Section title="Hvor længe gemmer vi oplysningerne">
        <Table
          head={['Oplysninger', 'Opbevaring']}
          rows={[
            ['Konto, præferencer, lister, alarmer og kvitteringslinjer', 'Indtil du sletter dem eller din konto'],
            ['Gæstesessioner (fra før betalingsmuren)', 'Slettes automatisk efter 30 dages inaktivitet'],
            ['Login-sessioner', '30 dage'],
            ['Links til bekræftelse og nulstilling', '48 timer og 1 time – slettes et døgn efter udløb'],
            ['Kvitteringsbilleder', 'Gemmes ikke. Billedet behandles kun i hukommelsen og sendes eventuelt til Anthropic for at blive læst'],
            ['Hash af e-mail til prøveperioden', 'Varigt – den kan ikke føres tilbage til din e-mail'],
            ['Fakturaer og betalinger (hos Stripe)', '5 år fra regnskabsårets udløb (bogføringsloven)'],
            ['Fortrydelser', '5 år som dokumentation'],
            ['Fejldata i Sentry', 'Op til 90 dage'],
            ['Besøgsstatistik', '13 måneder. Koden for den besøgende kan ikke genskabes efter den dag, den blev lavet'],
          ]}
        />
      </Section>

      <Section title="Dine rettigheder">
        <p>
          Du har ret til indsigt i de oplysninger, vi har om dig, og til at få dem rettet eller slettet. Du kan også gøre indsigelse, bede om
          begrænsning og få dine data udleveret i et maskinlæsbart format (dataportabilitet). Under{' '}
          <Link to="/app/konto" className="text-ink underline">
            Konto
          </Link>{' '}
          kan du selv hente alle dine data som JSON og slette din konto med alt tilknyttet. Et aktivt abonnement opsiges med det samme, når du sletter kontoen.
        </p>
        <p>
          Du kan klage til Datatilsynet, Carl Jacobsens Vej 35, 2500 Valby, dt@datatilsynet.dk, datatilsynet.dk – men skriv gerne til os først.
        </p>
      </Section>

      <Section title="Cookies">
        <p>
          Vi bruger kun en strengt nødvendig login-cookie og lokal lagring af dine egne valg. Læs mere i vores{' '}
          <Link to="/cookies" className="text-ink underline">
            cookiepolitik
          </Link>
          .
        </p>
      </Section>
    </LegalPage>
  );
}
