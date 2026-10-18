import { DraftNotice, LegalPage, Section, Table } from './LegalPage';

export function Cookies() {
  return (
    <LegalPage kicker="Derfor ingen cookie-banner" title="Cookies og lokal lagring" updated="17. oktober 2026">
      <DraftNotice />
      <Section title="Kort fortalt">
        <p>
          Tilbudsradar bruger kun det, der er nødvendigt for at levere den tjeneste, du selv beder om – fx at holde dig logget ind og huske de
          valg, du selv har truffet. Vi bruger ingen cookies til statistik, markedsføring eller sporing, og vi deler intet med annoncører.
          Derfor beder vi dig ikke om samtykke.
        </p>
      </Section>
      <Section title="Det gemmer vi i din browser">
        <Table
          head={['Navn', 'Type', 'Formål', 'Varighed']}
          rows={[
            ['tr_refresh', 'Cookie (httpOnly, Secure, SameSite=Lax)', 'Holder dig logget ind. Sættes først, når du logger ind eller opretter en konto.', '30 dage, eller til du logger ud'],
            ['tilbudsradar:prefs', 'Lokal lagring', 'Husker den placering og den indkøbsliste, du selv har valgt.', 'Til du rydder den'],
            ['tr:recent-searches', 'Lokal lagring', 'Dine seneste søgninger, så du kan søge igen med ét klik. Kan ryddes i søgefeltet.', 'Til du rydder den'],
            ['tilbudsradar:promo', 'Lokal lagring', 'Husker at du har lukket et informationskort.', 'Til du rydder den'],
            ['tr:reload', 'Sessionslagring', 'Tidspunkt for seneste automatiske genindlæsning, hvis appen er blevet opdateret, mens siden var åben – så det højst sker én gang.', 'Til fanen lukkes'],
            ['Service worker-cache', 'Cache Storage', 'Statiske filer (grafik, scripts), så appen åbner hurtigt og kan installeres på hjemmeskærmen. Indeholder aldrig dine data.', 'Til næste opdatering af appen'],
          ]}
        />
        <p>Den lokale lagring forlader aldrig din enhed og sendes ikke til os.</p>
      </Section>
      <Section title="Statistik uden cookies">
        <p>
          Vi tæller besøg på vores egen server – uden cookies og uden at gemme noget på din enhed. For hver side registrerer vi stien (fx
          /priser), hvilken side du kom fra (kun domænet, fx instagram.com), eventuelle kampagnekoder i linket og om du bruger mobil, tablet
          eller computer.
        </p>
        <p>
          For at kunne tælle unikke besøgende laver vi en kode ud fra din IP-adresse og browser sammen med et tilfældigt tal, der skiftes og
          slettes hver dag. IP-adressen gemmes aldrig, og koden kan ikke bruges til at genkende dig fra dag til dag. Bruger din browser
          "Do Not Track" eller "Global Privacy Control", tæller vi dig ikke med.
        </p>
      </Section>
      <Section title="Betaling hos Stripe">
        <p>
          Når du tegner et abonnement eller åbner kundeportalen, sendes du videre til Stripe på checkout.stripe.com og billing.stripe.com.
          Stripe bruger sine egne nødvendige cookies til sikker betaling og til at forebygge svindel. De er omfattet af Stripes egen
          cookiepolitik.
        </p>
      </Section>
    </LegalPage>
  );
}
