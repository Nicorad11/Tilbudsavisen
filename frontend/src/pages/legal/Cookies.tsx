import { DraftNotice, LegalPage, Section, Table } from './LegalPage';

export function Cookies() {
  return (
    <LegalPage kicker="Derfor ingen cookie-banner" title="Cookies og lokal lagring" updated="8. oktober 2026">
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
            ['Service worker-cache', 'Cache Storage', 'Statiske filer (grafik, scripts), så appen åbner hurtigt og kan installeres på hjemmeskærmen. Indeholder aldrig dine data.', 'Til næste opdatering af appen'],
          ]}
        />
        <p>Den lokale lagring forlader aldrig din enhed og sendes ikke til os.</p>
      </Section>
      <Section title="Statistik uden cookies">
        <p>
          Hvis vi måler besøg, sker det med Plausible, som er cookiefrit og EU-hostet. Plausible gemmer intet på din enhed og registrerer ikke
          personoplysninger – kun samlede tal som antal besøg og hvilke sider der bruges.
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
