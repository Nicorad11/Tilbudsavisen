# Lanceringstjekliste – Tilbudsradar

> **Alle juridiske tekster er udkast og skal gennemgås af en jurist før lancering.** Det gælder handelsbetingelserne (`shared/src/legal.ts`), privatlivspolitikken, cookiesiden, fortrydelsessiden (`/fortryd`), oplysningerne før betaling, ordrebekræftelsen og de øvrige e-mails (`backend/src/services/emails.ts`) samt påstande på landingssiden. Teksterne bygger på kilderne nederst, men er ikke juridisk rådgivning.

Koden er klar til testnøgler. Det, der står herunder, kræver konti, betalingsoplysninger, domæne eller beslutninger, som du selv skal tage. Rækkefølgen er den anbefalede.

---

## 1. Virksomhed og pladsholdere

- [ ] Virksomheden er registreret, og du har CVR-nummer (virk.dk).
- [ ] Udfyld i Render (eller `.env`). Værdierne vises i footer, på `/om`, i betingelserne, i privatlivspolitikken og i alle e-mails – uden nyt build:
  - `COMPANY_NAME` – `[UDFYLD: firmanavn]`
  - `COMPANY_CVR` – `[UDFYLD: CVR]`
  - `COMPANY_ADDRESS` – `[UDFYLD: adresse]`
  - `CONTACT_EMAIL` – standard `kontakt@tilbudsradaren.dk` (postkassen skal findes, se trin 3)
  - `VITE_INSTAGRAM_URL` – `[UDFYLD: https://www.instagram.com/<profil>]` (vises kun, når den starter med `https://`)
- [ ] Søg i koden efter `[UDFYLD` for at sikre, at intet er glemt: `git grep -n "UDFYLD"`.
- [ ] Sæt `ADMIN_EMAILS` til din egen e-mail (admin har altid fuld adgang og styrer kilderne).

## 2. Stripe

- [ ] Opret en Stripe-konto på virksomheden og **aktivér den** (CVR, bankkonto, ID-verifikation). Indtil da virker kun testnøgler.
- [ ] **Indstillinger → Betalingsmetoder:** slå **kort** til. Apple Pay og Google Pay følger med kort i den Stripe-hostede Checkout og kræver ingen domæneverifikation der. MobilePay i Stripe understøtter ikke tilbagevendende betaling og kan derfor ikke bruges til abonnementet; koden beder kun om kort.
- [ ] **Indstillinger → Kundemails:** slå *kvitteringer for gennemførte betalinger* og *refusioner* til. Slå *mails om mislykkede betalinger* til, hvis du vil have Stripes egne rykkermails ud over appens.
- [ ] **Indstillinger → Abonnementer og e-mails → Håndtering af mislykkede betalinger:** brug Smart Retries over ca. 1 uge, og vælg *annullér abonnementet*, når alle forsøg er brugt. Appen giver adgang i `PAST_DUE_GRACE_DAYS` (5) dage efter første fejl.
- [ ] **Indstillinger → Virksomhed → Offentlige oplysninger:** navn "Tilbudsradar", support-e-mail, `https://tilbudsradaren.dk/handelsbetingelser` og `https://tilbudsradaren.dk/privatlivspolitik`. Kontoudtog-tekst fx `TILBUDSRADAR`.
- [ ] Kør opsætningen – først med testnøgle, siden med live-nøgle (scriptet er idempotent):
  ```bash
  STRIPE_SECRET_KEY=sk_test_… APP_URL=https://tilbudsradaren.dk npm run stripe:setup
  ```
  Det opretter produktet *Tilbudsradar*, prisen **49 kr/md inkl. moms** (`lookup_key: tilbudsradar_maaned_49`), kundeportalen (opsig ved periodens udløb, skift kort, se fakturaer) og webhooken `https://tilbudsradaren.dk/api/billing/webhook` med hændelserne `checkout.session.completed`, `customer.subscription.created|updated|deleted`, `invoice.paid` og `invoice.payment_failed`. Til sidst skrives `STRIPE_PRICE_ID` og `STRIPE_PORTAL_CONFIG_ID` ud.
- [ ] Kopiér webhookens **signeringsnøgle** (`whsec_…`) fra *Udviklere → Webhooks* til `STRIPE_WEBHOOK_SECRET`.
- [ ] Sæt `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID` og `STRIPE_PORTAL_CONFIG_ID` i Render. Brug gerne en **begrænset nøgle** (`rk_live_…`) med skriveadgang til Checkout Sessions, Customers, Customer Portal, Subscriptions og Refunds og læseadgang til Invoices.
- [ ] Bemærk: Stripe-CLI-flowet (`stripe listen` + testbetaling ende til ende) er **ikke kørt** under udviklingen, fordi der ikke var en testnøgle. Webhook-logikken er dækket af automatiske tests med signerede testhændelser, men kør testplanen i trin 8 med testnøgler før live.

## 3. E-mail

- [ ] Opret en konto hos en e-mailudbyder med EU-region, fx Resend (EU) eller Postmark.
- [ ] Verificér domænet `tilbudsradaren.dk`: tilføj udbyderens **SPF**- og **DKIM**-records og en **DMARC**-record (start med `v=DMARC1; p=none; rua=mailto:<din adresse>`, skærp til `quarantine` når alt virker).
- [ ] Sæt `SMTP_URL` (fx `smtps://resend:<api-nøgle>@smtp.resend.com:465`) og `MAIL_FROM=Tilbudsradar <noreply@tilbudsradaren.dk>`.
- [ ] Opret postkassen i `CONTACT_EMAIL` (fx via domæneudbyderen eller Google Workspace). Fortrydelser, som ikke kan matches til en konto, sendes hertil.
- [ ] Send en testmail (opret en konto) og tjek, at den ikke lander i spam, og at links peger på `https://tilbudsradaren.dk`.

## 4. Domæne, hosting og database

- [x] Domænet `tilbudsradaren.dk` er købt hos DNS.services (DNS styres i deres kundeområde: <https://dns.services/clientarea/domains/>). Husk at forny det inden 13/10/2027 – eller slå automatisk fornyelse til.
- [ ] Opret en Render-konto og vælg **New → Blueprint** med dette repository. `render.yaml` opretter webservicen og en Postgres-database i **Frankfurt**. Webservicen skal mindst være på *Starter* (gratis-instanser sover, og så kører cron-jobs ikke).
- [ ] Udfyld alle værdier markeret `sync: false` (Stripe, SMTP, firmaoplysninger, `ADMIN_EMAILS`, `ANTHROPIC_API_KEY` …). `JWT_SECRET` genereres automatisk.
- [ ] Første deploy: tjek loggen. Mangler `DATABASE_URL`, `APP_URL`, `ADMIN_EMAILS` eller `JWT_SECRET`, stopper serveren med en liste over, hvad der mangler. Stripe og SMTP kan tilføjes senere – indtil da står der advarsler i loggen, prøveperioder kører, men abonnementer kan ikke tegnes. Dockerfilen er ikke bygget lokalt (Docker var ikke installeret under udviklingen) – den første build på Render er derfor også testen af den.
- [ ] Domænet står i `render.yaml`. Opret de DNS-records, Render viser under *Settings → Custom Domains* (A-record for roden, CNAME for `www`), i DNS.services, og tryk *Verify*. Render udsteder TLS-certifikatet.
- [ ] Tjek `https://tilbudsradaren.dk/api/health`, `https://tilbudsradaren.dk/robots.txt` og `https://tilbudsradaren.dk/sitemap.xml`.
- [ ] Første scraping starter automatisk ved opstart, når databasen er tom (3–4 minutter). Følg med under **Kilder**.
- [ ] Aktivér automatisk backup/point-in-time recovery for databasen (betalt Render-plan) – eller planlæg et dagligt `pg_dump`.
- [ ] Bruger du Neon eller Supabase i stedet for Render Postgres: vælg EU-region, tilføj `?sslmode=require` til `DATABASE_URL`, og **tilføj udbyderen i privatlivspolitikken** (`frontend/src/pages/legal/Privacy.tsx`).

## 5. Kvitteringer, overvågning og statistik

- [ ] `ANTHROPIC_API_KEY` fra console.anthropic.com. Standardmodellen er `claude-sonnet-5-5`, og hver bruger kan scanne `RECEIPT_SCANS_PER_MONTH` (20) kvitteringer pr. måned. Tokenforbruget pr. scanning står i tabellen `receipt_scans`. Sæt et forbrugsloft i Anthropic Console. Uden nøgle bruges tekstgenkendelse på serveren.
- [ ] (Valgfrit) Sentry med **EU-datalagring**: sæt `SENTRY_DSN` (backend) og `VITE_SENTRY_DSN` (browser). Persondata fjernes, før hændelser sendes. CSP'en åbner kun for Sentry, når DSN'en er sat.
- [ ] (Valgfrit) Plausible (EU-hostet, cookiefri): opret sitet `tilbudsradaren.dk` og sæt `VITE_PLAUSIBLE_DOMAIN=tilbudsradaren.dk`. Opret målene *Prøveperiode startet* og *Checkout startet* for at se konverteringen. UTM-parametre fra Instagram-links (fx `?utm_source=instagram&utm_campaign=lancering`) registreres automatisk.
- [ ] Indgå databehandleraftaler (DPA) med Render, Stripe, e-mailudbyderen, Anthropic og evt. Sentry/Plausible. De fleste accepteres i deres dashboard eller er en del af vilkårene – gem en kopi.

## 6. Jurist

Få en jurist med speciale i e-handel og persondata til at gennemgå:

- [ ] **Handelsbetingelserne** (`/handelsbetingelser`, `shared/src/legal.ts`) og den vedhæftede tekstversion i ordrebekræftelsen.
- [ ] **Oplysningerne før betaling** (`SubscribePanel` i frontenden og teksten under knappen i Stripe Checkout). Forbrugeraftalelovens § 12 kræver, at bestillingsknappen tydeligt angiver betalingsforpligtelse. Stripe viser "Betal"/"Abonnér" (`submit_type: 'pay'`), og appens egen knap hedder "Start abonnement – 49 kr/md" – få bekræftet, at det er tilstrækkeligt.
- [ ] **Fortrydelsesretten:** Vi har valgt at refundere **hele** beløbet ved fortrydelse inden for 14 dage (mere end § 25 kræver), så forbrugeren ikke skal give samtykke til straks-levering og miste retten. Fortrydelsesfunktionen `/fortryd` er linket fra footer på alle sider (krav om digital fortrydelsesfunktion fra 19. juni 2026).
- [ ] **Privatlivspolitikken:** formål, retsgrundlag, opbevaringsperioder, databehandlere og tredjelandsoverførsler (Stripe, Anthropic m.fl. under EU-US Data Privacy Framework).
- [ ] **Cookiesiden:** at login-cookien, præferencer i `localStorage` (`tilbudsradar:prefs`, `tr:recent-searches`, `tilbudsradar:promo`) og service worker-cachen er strengt nødvendige, så der ikke skal være samtykke/cookie-banner.
- [ ] **Markedsføring på landingssiden:** sammenligninger med kæderne, "reelt tilbud"-vurderingen og eksempelpriserne (markedsføringsloven og prismarkedsføringsreglerne). Eksemplet med hakket oksekød er fra uge 41, 2026.
- [ ] **Uafhængighed:** teksten om, at Tilbudsradar ikke er tilknyttet kæderne, og brugen af kædenavne og -farver.
- [ ] **Datakilden:** tilbuds-API'et bag eTilbudsavis (Tjek) er ikke officielt dokumenteret – afklar vilkår for kommerciel brug (håndteres separat).

## 7. Moms

- [ ] Priserne er **inkl. 25 % moms** (49 kr). Virksomheden skal momsregistreres, når salget overstiger **50.000 kr. over 12 måneder** – svarende til ca. 85 aktive abonnenter i et år.
- [ ] Når virksomheden er momsregistreret: kør `npm run stripe:setup -- --tax` og sæt `STRIPE_TAX_RATE_ID`. Fakturaerne viser derefter momsen. Prisen for kunden er uændret (momsen er inklusiv).
- [ ] Sælger du til forbrugere i andre EU-lande for over 10.000 € om året, gælder deres moms (OSS). Appen er rettet mod Danmark.
- [ ] Aftal bogføring med en revisor (Stripe-udbetalinger, gebyrer og refusioner).

## 8. Testplan før lancering

Med **testnøgler** på en staging-udgave (eller lokalt med `stripe listen`):

1. [ ] Opret konto → prøveperioden starter (14 dage), bekræftelsesmail modtages, linket virker.
2. [ ] Opret konto igen med samme e-mail efter sletning (også med `+tag` eller punktummer i Gmail) → ingen ny prøveperiode.
3. [ ] Glemt adgangskode → mail → nyt kodeord → alle andre sessioner er logget ud, og der kommer en mail om ændringen.
4. [ ] Uden konto: søgning virker. Lister, alarmer, kvitteringer, prishistorik og community viser betalingsmuren.
5. [ ] Tegn abonnement under prøveperioden med testkort `4242 4242 4242 4242` → ingen betaling før prøveperioden slutter, ordrebekræftelse med betingelser vedhæftet, status "Aktiv".
6. [ ] Tegn abonnement efter udløbet prøveperiode → betaling trækkes straks.
7. [ ] Kundeportal: skift kort, opsig → status "Opsagt", adgang til periodens udløb. Genoptag.
8. [ ] Fejlet betaling (`4000 0000 0000 0341`, eller *Simulér* i Stripe) → mail om fejlet betaling, adgang i 5 dage, banner i appen.
9. [ ] `/fortryd` inden for 14 dage (logget ind og logget ud) → abonnementet stopper straks, refusion i Stripe, kvittering på e-mail.
10. [ ] Slet konto med aktivt abonnement → abonnementet opsiges i Stripe først.
11. [ ] Hent dataudtræk (Konto → Hent mine data) og tjek indholdet.
12. [ ] Prøveperiode-mails: sæt `trial_ends_at` for en testbruger til om 2 dage hhv. i går, og sæt midlertidigt `BILLING_CRON=*/5 * * * *` → påmindelse og "prøveperioden er slut" sendes hver én gang.
13. [ ] Kvitteringsscanning: scan, og tjek at forbruget tæller, og at loftet giver en venlig besked.
14. [ ] Mobil (iPhone Safari og Android Chrome): landingsside, oprettelse, Checkout, "Føj til hjemmeskærm" (PWA).
15. [ ] Del `https://tilbudsradaren.dk` og `/priser` i en besked/Instagram-DM → forhåndsvisning med billede og titel.

Gentag 5, 7 og 9 med **live-nøgler** og dit eget kort, og refundér bagefter.

## 9. Efter lancering

- [ ] Hold øje med Sentry, Render-loggen (JSON) og Stripe → *Udviklere → Webhooks* (fejlede leveringer).
- [ ] Følg Anthropic-forbruget de første uger og justér `RECEIPT_SCANS_PER_MONTH`.
- [ ] Hold scraperne under opsyn under **Kilder** (strukturændringer giver notifikation via `SLACK_WEBHOOK_URL`/`ALERT_EMAIL_TO`).
- [ ] Ændres betingelserne væsentligt: hæv `TERMS_VERSION` i `shared/src/billing.ts` (nye abonnementer skal acceptere den nye version) og giv eksisterende kunder besked med rimeligt varsel.

---

## Beslutninger truffet under udviklingen

| Emne | Beslutning | Hvorfor |
|---|---|---|
| Prøveperiode | 14 dage fra oprettelse, uden kort, stopper af sig selv | Ingen overraskende træk, ingen "abonnementsfælde". Kræver aktiv tilmelding |
| Én prøveperiode pr. e-mail | SHA-256 af normaliseret e-mail i `trial_claims` (små bogstaver, uden `+tag`, Gmail-punktummer fjernet) | Forhindrer gentagne prøveperioder, også efter sletning, uden at gemme e-mailen |
| Eksisterende brugere | Får en ny prøveperiode på 14 dage ved migrationen | Rimeligt over for tidlige brugere |
| Tegning under prøveperioden | Første betaling udskydes til prøveperiodens udløb (`trial_end` i Stripe) | Man mister ikke de resterende gratis dage |
| Krav før betaling | Bekræftet e-mail og accepterede betingelser (versioneret) | Kvittering og ordrebekræftelse når frem. Dokumentation for accept |
| Betalingsmetode | Kun kort (inkl. Apple Pay/Google Pay) | MobilePay understøtter ikke tilbagevendende betaling i Stripe |
| Fortrydelse | Fuld refusion inden for 14 dage, via `/fortryd` uden login | Enklere og mere kundevenligt end forholdsmæssig betaling efter § 25 |
| Opsigelse | I Stripes kundeportal, virker fra periodens udløb | Ingen binding, ingen refusion for påbegyndt måned (står i betingelserne) |
| Fejlet betaling | 5 dages fortsat adgang, én mail pr. rykkerforløb | Kortudløb skal ikke straks låse brugeren ude |
| Udløbet adgang | Egne data kan stadig ses, hentes og slettes, men ikke ændres | GDPR (indsigt og sletning) og tillid |
| Gæster | Frontenden opretter ikke længere anonyme gæster | Betalte funktioner kræver konto. Endpointet findes stadig for ældre klienter |
| Cookies | Kun strengt nødvendig lagring, Plausible er cookiefri | Intet cookie-banner nødvendigt |
| Database | Render Postgres i Frankfurt | Én databehandler mindre end Neon/Supabase, alt i EU |
| Firmaoplysninger m.m. | Indsættes af serveren ved hver sidevisning | Ét sæt miljøvariabler, intet nyt build når de ændres |
| Kvitteringsmodel | `claude-sonnet-5-5`, 20 scanninger pr. måned, forbrug logges | Billigere end Opus til aflæsning, forudsigelige omkostninger |

## Kilder

Forbrugeraftaler, fortrydelsesret og oplysningspligt:

- Forbrugeraftaleloven, LBK nr. 723 af 2025 – <https://www.retsinformation.dk/eli/lta/2025/723>
- § 8 (oplysninger før aftalen) – <https://danskelove.dk/forbrugeraftaleloven/8>
- § 12 (bestillingsknap og betalingsforpligtelse) – <https://danskelove.dk/forbrugeraftaleloven/12>
- § 18 og § 19 (fortrydelsesret og frist) – <https://danskelove.dk/forbrugeraftaleloven/18>, <https://danskelove.dk/forbrugeraftaleloven/19>
- § 20 og § 20 a (udøvelse og digital fortrydelsesfunktion) – <https://danskelove.dk/forbrugeraftaleloven/20>, <https://danskelove.dk/forbrugeraftaleloven/20a>
- § 24 og § 25 (refusion og betaling for leverede ydelser) – <https://danskelove.dk/forbrugeraftaleloven/24>, <https://danskelove.dk/forbrugeraftaleloven/25>
- DI: Ny regel – fortrydelsesretten skal være synlig og digital fra 19. juni 2026 – <https://www.danskindustri.dk/vi-radgiver-dig/ecommerce/nyhedsarkiv/nyheder/2026/06/ny-regel-rammer-webshops-fortrydelsesretten-skal-vare-synlig-og-digital-fra-19.-juni-2026>
- Poul Schmith: Nye krav til fortrydelsesret ved onlinesalg – <https://poulschmith.dk/nyheder/nye-krav-til-fortrydelsesret-ved-onlinesalg>
- Bech-Bruun: Lovændringer styrker forbrugerbeskyttelse ved online køb – <https://www.bechbruun.com/nyheder/faglige-nyheder/lovaendringer-styrker-forbrugerbeskyttelse-og-gennemsigtighed-ved-online-koeb/>

Cookies og persondata:

- Erhvervsstyrelsen: Vejledning om cookiebekendtgørelsen – <https://erhvervsstyrelsen.dk/sites/default/files/2019-10/vejledning-cookiebekendtgorelse.pdf>
- Datatilsynet (vejledninger om de registreredes rettigheder og oplysningspligt) – <https://www.datatilsynet.dk>

Prismarkedsføring og moms:

- DI: Prismarkedsføring – <https://www.danskindustri.dk/brancher/di-handel/radgivning/viden-om/prismarkedsforing/>
- Dinero: Hvornår skal jeg momsregistreres (grænsen på 50.000 kr.) – <https://dinero.dk/tips/hvornaar-skal-jeg-momsregistreres/>
- Skattestyrelsen: Momsregistrering i de EU-lande, du sælger til (OSS) – <https://skat.dk/erhverv/moms/moms-ved-handel-med-udlandet/moms-ved-salg-til-private/salg-til-private-i-eu/momsregistrering-i-de-eu-lande-du-saelger-til>

Stripe (teknisk): Checkout, Customer Portal, webhooks og testkort i Stripes dokumentation (docs.stripe.com) – API-version `2026-09-30.endive`.
