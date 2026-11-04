import { Instagram, Mail } from 'lucide-react';
import { Link } from 'react-router';
import { COMPANY } from '../../lib/company';
import { useSeo } from '../../lib/seo';
import { LegalPage, Section, Table } from './LegalPage';

export function About() {
  useSeo();
  return (
    <LegalPage kicker="Hvem står bag" title="Om Tilbudsradar">
      <Section title="Idéen">
        <p>
          Tilbudsradar samler ugens tilbudsaviser fra REMA 1000, Netto, føtex, Bilka og Lidl i ét søgefelt. Vi regner prisen om pr. kilo,
          liter eller stk., så du kan sammenligne på tværs af kæderne, og vi måler hvert tilbud mod varens pris de sidste 90 dage – så du kan
          se, om besparelsen er reel.
        </p>
        <p>
          Tilbudsradar er uafhængigt og ikke tilknyttet kæderne. Priserne kommer fra kædernes offentlige tilbudsaviser og opdateres to gange
          om dagen. Kædens egen pris i butikken gælder altid.
        </p>
      </Section>
      <Section title="Sådan arbejder vi">
        <p>
          Hvert tilbud gemmes med pris, førpris, pakkestørrelse og gyldighed. Ud fra pakkestørrelsen regner vi prisen om pr. enhed, og vi
          sammenligner med varens egne priser over tid – ikke med den førpris, kæden selv skriver. Hvordan vi gør, står i detaljer under{' '}
          <Link to="/metode" className="text-ink underline">
            metode
          </Link>
          .
        </p>
        <p>
          Der er ingen annoncer eller betalte placeringer, og rækkefølgen afgøres kun af pris og målt besparelse. Tilbudsradar finansieres af
          abonnementer på appen. Ugens tal kan alle se uden konto – fx{' '}
          <Link to="/tilbud" className="text-ink underline">
            alle varer på tilbud
          </Link>
          ,{' '}
          <Link to="/ugens-bedste-tilbud" className="text-ink underline">
            ugens bedste tilbud
          </Link>{' '}
          og{' '}
          <Link to="/butikker" className="text-ink underline">
            tilbudsaviserne pr. kæde
          </Link>
          .
        </p>
        <p>Finder du en fejl i en pris eller en vurdering, så skriv til os – så retter vi den.</p>
      </Section>
      <Section title="Virksomheden">
        <Table
          head={['', '']}
          rows={[
            ...(COMPANY.name ? [['Navn', COMPANY.name]] : []),
            ...(COMPANY.cvr ? [['CVR-nr.', COMPANY.cvr]] : []),
            ...(COMPANY.address ? [['Adresse', COMPANY.address]] : []),
            ['E-mail', <a key="m" href={`mailto:${COMPANY.email}`} className="underline">{COMPANY.email}</a>],
          ]}
        />
      </Section>
      <Section title="Kontakt">
        <div className="flex flex-wrap gap-3">
          <a href={`mailto:${COMPANY.email}`} className="inline-flex items-center gap-2 rounded-full bg-raised px-4 py-2 text-ink shadow-pill">
            <Mail className="size-4" strokeWidth={1.6} /> {COMPANY.email}
          </a>
          {COMPANY.instagram && (
            <a href={COMPANY.instagram} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-full bg-raised px-4 py-2 text-ink shadow-pill">
              <Instagram className="size-4" strokeWidth={1.6} /> Instagram
            </a>
          )}
        </div>
        <p>
          Spørgsmål om dit abonnement finder du under{' '}
          <Link to="/app/konto#abonnement" className="text-ink underline">
            Konto
          </Link>
          . Læs også vores{' '}
          <Link to="/handelsbetingelser" className="text-ink underline">
            handelsbetingelser
          </Link>{' '}
          og{' '}
          <Link to="/privatlivspolitik" className="text-ink underline">
            privatlivspolitik
          </Link>
          .
        </p>
      </Section>
    </LegalPage>
  );
}
