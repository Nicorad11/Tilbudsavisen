# Lanceringstjekliste – Tilbudsradar

> **Alle juridiske tekster er udkast og skal gennemgås af en jurist før lancering.** Det gælder handelsbetingelserne (`shared/src/legal.ts`), privatlivspolitikken, cookiesiden, fortrydelsessiden (`/fortryd`), oplysningerne før betaling, ordrebekræftelsen og de øvrige e-mails (`backend/src/services/emails.ts`) samt påstande på landingssiden. Teksterne bygger på kilderne nederst, men er ikke juridisk rådgivning.

## Status pr. 18. oktober 2026

**Live:** <https://tilbudsradaren.dk> (hjemmeside og app) og <https://admin.tilbudsradaren.dk> (admin-app), begge på Render i Frankfurt med HTTPS.

| Område | Status |
|---|---|
| Domæne og DNS | ✅ tilbudsradaren.dk hos DNS.services – rod, `www` og `admin` peger på Render |
| Hosting og database | ✅ Render Blueprint `tilbudsradar` (Starter) + Postgres `tilbudsradar-db` (basic-256mb), Frankfurt. Deployer automatisk fra `main` |
| Konti og login | ✅ Oprettelse, login, bekræftelse af e-mail og nulstilling af adgangskode virker |
| E-mail | ✅ Resend (EU), domænet er verificeret, sender fra `noreply@tilbudsradaren.dk`. Testmail leveret 17/10 |
| Fejlovervågning | ✅ Sentry (EU), organisation `kodo-rg`, projekt `tilbudsradar`. Mail ved alvorlige fejl |
| Besøgsstatistik | ✅ Egen, cookiefri statistik – vises i admin-appen (Overblik) |
| Admin | ✅ admin.tilbudsradaren.dk – overblik, kunder og kilder. Administratorer: `ADMIN_EMAILS` |
| Betaling | ⏳ **Lanceringsperiode:** Stripe er ikke sat op endnu (afventer CVR), så alle konti har alt gratis |
| Firmaoplysninger | ⏳ Footer, `/om` og betingelserne viser `[UDFYLD …]`, til virksomheden er oprettet |
| Kontaktmail | ⏳ `kontakt@tilbudsradaren.dk` kan endnu ikke modtage mails |
| Jurist | ⏳ Ikke gennemgået |

Rækkefølgen herunder er den anbefalede for det, der mangler.

---

## 1. Virksomhed og pladsholdere

- [ ] Virksomheden er registreret, og du har CVR-nummer (virk.dk).
- [ ] Udfyld i Render → tilbudsradar → **Environment**. Værdierne vises i footer, på `/om`, i betingelserne, i privatlivspolitikken og i alle e-mails – uden nyt build:
  - `COMPANY_NAME` – vises nu som `[UDFYLD: firmanavn]`
  - `COMPANY_CVR` – vises nu som `[UDFYLD: CVR]`
  - `COMPANY_ADDRESS` – vises nu som `[UDFYLD: adresse]`
  - `VITE_INSTAGRAM_URL` – fx `https://www.instagram.com/<profil>` (linket vises kun, når den starter med `https://`)
- [x] `ADMIN_EMAILS` = `nicorad2005@gmail.com,nicorad120@gmail.com`. Admin-rollen sættes ved login – log ind igen, når listen ændres.
- [ ] Søg i koden efter `[UDFYLD` for at sikre, at intet er glemt: `git grep -n "UDFYLD"`.

## 2. E-mail

- [x] Resend-konto (EU, Irland). Domænet `tilbudsradaren.dk` er verificeret med DKIM (`resend._domainkey`), CNAME `rsend` og `send` samt DMARC (`_dmarc`: `v=DMARC1; p=none;`) i DNS.services.
- [x] `SMTP_URL` og `MAIL_FROM=Tilbudsradar <noreply@tilbudsradaren.dk>` er sat i Render. Bekræftelsesmailen er leveret (status *Delivered* i Resend).
- [ ] **Ny Resend-nøgle:** den første API-nøgle blev indsat i en chat. Opret en ny under Resend → API Keys, slet den gamle, og opdatér `SMTP_URL` i Render.
- [ ] **Kontaktmail:** `CONTACT_EMAIL=kontakt@tilbudsradaren.dk` står på siden, men domænet kan ikke modtage mail endnu. Slå modtagelse til i Resend (*Domains → Enable Receiving* + MX-record) eller brug en videresendelsestjeneste – eller sæt `CONTACT_EMAIL` til en adresse, der findes. Fortrydelser, der ikke kan matches til en konto, sendes hertil.
- [ ] (Anbefalet) Resend foreslår en afsender, man kan svare på, i stedet for `noreply@` – fx `hej@tilbudsradaren.dk`, når modtagelse virker.
- [ ] Skærp DMARC til `p=quarantine` efter et par uger uden problemer, og tilføj `rua=mailto:<din adresse>` for at få rapporter.
- [ ] (Valgfrit) Sæt `ALERT_EMAIL_TO` i Render, så scraperne mailer dig ved strukturændringer hos kæderne.

## 3. Domæne, hosting og database

- [x] Domænet `tilbudsradaren.dk` er købt hos DNS.services (<https://dns.services/clientarea/domains/>), automatisk fornyelse er slået til (udløber 13/10/2027). DNS ligger under *DNS Hotel → Primær DNS*. Bemærk: DNS.services logger hurtigt ud.
- [x] Render Blueprint fra `render.yaml`: webservice (Docker, Starter) og Postgres i Frankfurt. Dockerfilen bygger på Render.
- [x] DNS: A-record `tilbudsradaren.dk` → `216.24.57.1`, CNAME `www` og `admin` → `tilbudsradar.onrender.com`. Alle tre domæner er verificeret i Render med certifikat.
- [x] `https://tilbudsradaren.dk/api/health`, `/robots.txt` og `/sitemap.xml` svarer. Admin-domænet har `noindex` og `Disallow: /`.
- [x] Første scraping er kørt. Kilderne følges under **Kilder** i admin-appen.
- [ ] Tjek backup: Render → `tilbudsradar-db` → *Recovery* (point-in-time recovery på betalte databaser). Ellers planlæg et dagligt `pg_dump`.
- [ ] Bruger du på et tidspunkt Neon eller Supabase i stedet for Render Postgres: vælg EU-region, tilføj `?sslmode=require` til `DATABASE_URL`, og **tilføj udbyderen i privatlivspolitikken** (`frontend/src/pages/legal/Privacy.tsx`).

## 4. Stripe (når CVR er på plads)

Stripe-kontoen hedder **Kodo**. Indtil videre er kun sandboxen sat op: produktet "Tilbudsradaren" med prisen `price_1UQtj3Awu1aDnP7KHo3vF8j2` (49 kr/md) og kundeportalen (opsig ved periodens udløb, skift kort, fakturahistorik, ingen redigering af kundeoplysninger).

- [ ] **Aktivér kontoen** (*Settings → Activate products*): CVR, bankkonto og ID-verifikation.
- [ ] **Offentlige oplysninger:** navn "Tilbudsradar", support-e-mail, `https://tilbudsradaren.dk/handelsbetingelser` og `https://tilbudsradaren.dk/privatlivspolitik`. Kontoudtog-tekst fx `TILBUDSRADAR`. (Kan først sættes efter aktivering.)
- [ ] Overvej at omdøbe produktet "Tilbudsradaren" til "Tilbudsradar" – navnet står på betalingssiden og fakturaerne.
- [ ] **Betalingsmetoder:** kort (Apple Pay og Google Pay følger med i Checkout). MobilePay understøtter ikke tilbagevendende betaling i Stripe; koden beder kun om kort.
- [ ] **Kundemails:** kvitteringer og refusioner til. **Mislykkede betalinger:** Smart Retries over ca. 1 uge, derefter *annullér abonnementet*. Appen giver adgang i `PAST_DUE_GRACE_DAYS` (5) dage efter første fejl.
- [ ] **Live-opsætning** – enten i dashboardet som i sandboxen, eller med scriptet (opretter et nyt produkt "Tilbudsradar"; brug ikke begge):
  ```bash
  STRIPE_SECRET_KEY=sk_live_… APP_URL=https://tilbudsradaren.dk npm run stripe:setup
  ```
  Webhook: `https://tilbudsradaren.dk/api/billing/webhook` med `checkout.session.completed`, `customer.subscription.created|updated|deleted`, `invoice.paid` og `invoice.payment_failed`.
- [ ] Sæt `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` og `STRIPE_PRICE_ID` (alle tre samlet) og evt. `STRIPE_PORTAL_CONFIG_ID` i Render. Brug gerne en **begrænset nøgle** (`rk_live_…`) med skriveadgang til Checkout Sessions, Customers, Customer Portal, Subscriptions og Refunds og læseadgang til Invoices.
- [ ] **Når nøglerne er sat, slutter lanceringsperioden automatisk:** første opstart med Stripe giver alle konti uden abonnement 14 dage gratis fra den dag og sender dem en mail om det (sker én gang). Kør testplanen i trin 7 med testnøgler først.

## 5. Kvitteringer, overvågning og statistik

- [ ] `ANTHROPIC_API_KEY` fra console.anthropic.com (ikke sat – kvitteringer læses indtil da med tekstgenkendelse på serveren). Standardmodellen er `claude-sonnet-5-5`, og hver bruger kan scanne `RECEIPT_SCANS_PER_MONTH` (20) kvitteringer pr. måned. Sæt et forbrugsloft i Anthropic Console.
- [x] Sentry (EU): `SENTRY_DSN` og `VITE_SENTRY_DSN` er sat. Testet 17/10. Fejl fra brugere med en gammel fane efter en deploy håndteres nu ved at genindlæse siden.
- [x] Egen cookiefri besøgsstatistik (sidevisninger, besøgende pr. dag, kilder som Instagram, enheder) – ingen cookies, IP-adresser gemmes ikke, slettes efter 13 måneder. Plausible er ikke nødvendig, men kan stadig slås til med `VITE_PLAUSIBLE_DOMAIN`.
- [ ] Indgå databehandleraftaler (DPA) med Render, Resend og Sentry nu – og med Stripe og Anthropic, når de tages i brug. De fleste accepteres i deres dashboard eller er en del af vilkårene – gem en kopi.

## 6. Jurist

Få en jurist med speciale i e-handel og persondata til at gennemgå:

- [ ] **Handelsbetingelserne** (`/handelsbetingelser`, `shared/src/legal.ts`) og den vedhæftede tekstversion i ordrebekræftelsen – herunder afsnittet om **lanceringsperioden** (gratis til betaling åbner, derefter 14 dages prøveperiode).
- [ ] **Oplysningerne før betaling** (`SubscribePanel` og teksten under knappen i Stripe Checkout). Forbrugeraftalelovens § 12 kræver, at bestillingsknappen tydeligt angiver betalingsforpligtelse. Stripe viser "Betal"/"Abonnér" (`submit_type: 'pay'`), og appens egen knap hedder "Start abonnement – 49 kr/md".
- [ ] **Fortrydelsesretten:** fuld refusion ved fortrydelse inden for 14 dage (mere end § 25 kræver). `/fortryd` er linket fra footer på alle sider (krav om digital fortrydelsesfunktion fra 19. juni 2026).
- [ ] **Privatlivspolitikken:** formål, retsgrundlag, opbevaringsperioder, databehandlere (Render, Resend, Sentry, Stripe, Anthropic) og tredjelandsoverførsler. Nyt siden første udkast: den **egne besøgsstatistik** (daglig skiftende kode af IP og browser, IP gemmes ikke) og at administratorer kan se og ændre kundekonti i admin-appen (handlingerne logges i kundens historik og indgår i dataudtrækket).
- [ ] **Cookiesiden:** at login-cookien, `localStorage` (`tilbudsradar:prefs`, `tr:recent-searches`, `tilbudsradar:promo`), `sessionStorage` (`tr:reload`) og service worker-cachen er strengt nødvendige, og at statistikken er cookiefri – så der ikke skal være samtykke/cookie-banner.
- [ ] **Markedsføring på landingssiden:** sammenligninger med kæderne, "reelt tilbud"-vurderingen, "Gratis lige nu" og eksempelpriserne (markedsføringsloven og prismarkedsføringsreglerne). Eksemplet med hakket oksekød er fra uge 41, 2026.
- [ ] **Uafhængighed:** teksten om, at Tilbudsradar ikke er tilknyttet kæderne, og brugen af kædenavne og -farver.
- [ ] **Datakilden:** tilbuds-API'et bag eTilbudsavis (Tjek) er ikke officielt dokumenteret – afklar vilkår for kommerciel brug (håndteres separat).

## 7. Testplan

Allerede testet på den live side (✅) og resten med **testnøgler**, før betaling åbner:

1. [x] Opret konto → bekræftelsesmail modtages (leveret 17/10). Klik på linket og tjek, at e-mailen står som bekræftet.
2. [ ] Opret konto igen med samme e-mail efter sletning (også med `+tag` eller punktummer i Gmail) → ingen ny prøveperiode.
3. [ ] Glemt adgangskode → mail → nyt kodeord → alle andre sessioner er logget ud, og der kommer en mail om ændringen.
4. [x] Uden konto: søgning virker. Lister, alarmer, kvitteringer, prishistorik og community viser betalingsmuren ("Gratis lige nu").
5. [ ] Tegn abonnement under prøveperioden med testkort `4242 4242 4242 4242` → ingen betaling før prøveperioden slutter, ordrebekræftelse med betingelser vedhæftet, status "Aktiv".
6. [ ] Tegn abonnement efter udløbet prøveperiode → betaling trækkes straks.
7. [ ] Kundeportal: skift kort, opsig → status "Opsagt", adgang til periodens udløb. Genoptag.
8. [ ] Fejlet betaling (`4000 0000 0000 0341`, eller *Simulér* i Stripe) → mail om fejlet betaling, adgang i 5 dage, banner i appen.
9. [ ] `/fortryd` inden for 14 dage (logget ind og logget ud) → abonnementet stopper straks, refusion i Stripe, kvittering på e-mail.
10. [ ] Slet konto med aktivt abonnement → abonnementet opsiges i Stripe først.
11. [ ] Hent dataudtræk (Konto → Hent mine data) og tjek indholdet.
12. [ ] Prøveperiode-mails: sæt `trial_ends_at` for en testbruger til om 2 dage hhv. i går (fx i admin-appen), og sæt midlertidigt `BILLING_CRON=*/5 * * * *` → påmindelse og "prøveperioden er slut" sendes hver én gang.
13. [ ] Kvitteringsscanning: scan, og tjek at forbruget tæller, og at loftet giver en venlig besked.
14. [ ] Mobil (iPhone Safari og Android Chrome): oprettelse, Checkout, "Føj til hjemmeskærm" (PWA). Landingssiden er tjekket på 375 px.
15. [ ] Del `https://tilbudsradaren.dk` og `/priser` i en besked/Instagram-DM → forhåndsvisning med billede og titel.

Gentag 5, 7 og 9 med **live-nøgler** og dit eget kort, og refundér bagefter.

## 8. Drift

- [x] Overvågning: Sentry (fejl, mail ved alvorlige fejl), admin-appen (brugere, besøg, kilder) og Render (logs og deploys).
- [ ] Når Stripe kører: hold øje med Stripe → *Udviklere → Webhooks* (fejlede leveringer).
- [ ] Følg Anthropic-forbruget de første uger, når nøglen er sat, og justér `RECEIPT_SCANS_PER_MONTH`.
- [ ] Ændres betingelserne væsentligt: hæv `TERMS_VERSION` i `shared/src/billing.ts` (nye abonnementer skal acceptere den nye version) og giv eksisterende kunder besked med rimeligt varsel.
- Hver push til `main` deployer automatisk. Brugere med en åben, gammel fane får den nye version ved næste klik (siden genindlæses én gang).

## 9. Moms

- [ ] Priserne er **inkl. 25 % moms** (49 kr). Virksomheden skal momsregistreres, når salget overstiger **50.000 kr. over 12 måneder** – svarende til ca. 85 aktive abonnenter i et år.
- [ ] Når virksomheden er momsregistreret: kør `npm run stripe:setup -- --tax` og sæt `STRIPE_TAX_RATE_ID`. Fakturaerne viser derefter momsen. Prisen for kunden er uændret (momsen er inklusiv).
- [ ] Sælger du til forbrugere i andre EU-lande for over 10.000 € om året, gælder deres moms (OSS). Appen er rettet mod Danmark.
- [ ] Aftal bogføring med en revisor (Stripe-udbetalinger, gebyrer og refusioner).

---

## Beslutninger truffet under udviklingen

| Emne | Beslutning | Hvorfor |
|---|---|---|
| Navn og domæne | Navnet er **Tilbudsradar**, domænet **tilbudsradaren.dk** | tilbudsradar.dk var ikke ledigt |
| Lanceringsperiode | Uden Stripe har alle konti alt gratis. Når betaling åbner, får alle 14 dage fra den dag og en mail | Siden kan gå live før CVR og Stripe, uden at nogen mister adgang efter 14 dage |
| Prøveperiode | 14 dage, uden kort, stopper af sig selv | Ingen overraskende træk, ingen "abonnementsfælde". Kræver aktiv tilmelding |
| Én prøveperiode pr. e-mail | SHA-256 af normaliseret e-mail i `trial_claims` (små bogstaver, uden `+tag`, Gmail-punktummer fjernet) | Forhindrer gentagne prøveperioder, også efter sletning, uden at gemme e-mailen |
| Tegning under prøveperioden | Første betaling udskydes til prøveperiodens udløb (`trial_end` i Stripe) | Man mister ikke de resterende gratis dage |
| Krav før betaling | Bekræftet e-mail og accepterede betingelser (versioneret) | Kvittering og ordrebekræftelse når frem. Dokumentation for accept |
| Betalingsmetode | Kun kort (inkl. Apple Pay/Google Pay) | MobilePay understøtter ikke tilbagevendende betaling i Stripe |
| Stripe-konto | Kontoen "Kodo" (virksomheden bag) | Én konto til virksomheden. Navnet kunderne ser, sættes til "Tilbudsradar" |
| Fortrydelse | Fuld refusion inden for 14 dage, via `/fortryd` uden login | Enklere og mere kundevenligt end forholdsmæssig betaling efter § 25 |
| Opsigelse | I Stripes kundeportal, virker fra periodens udløb | Ingen binding, ingen refusion for påbegyndt måned (står i betingelserne) |
| Fejlet betaling | 5 dages fortsat adgang, én mail pr. rykkerforløb | Kortudløb skal ikke straks låse brugeren ude |
| Udløbet adgang | Egne data kan stadig ses, hentes og slettes, men ikke ændres | GDPR (indsigt og sletning) og tillid |
| Gæster | Frontenden opretter ikke længere anonyme gæster | Betalte funktioner kræver konto. Endpointet findes stadig for ældre klienter |
| Cookies og statistik | Kun strengt nødvendig lagring. Egen cookiefri statistik i stedet for Plausible | Intet cookie-banner, ingen ekstra databehandler, gratis |
| Admin | Separat app på admin.tilbudsradaren.dk, serveret af samme service efter værtsnavn | Ingen admin-kode eller -links på hjemmesiden. Én service at drive |
| Hosting og database | Render (Docker, Starter) og Render Postgres i Frankfurt | Kører altid (cron-jobs), alt i EU, én databehandler |
| E-mail og fejl | Resend og Sentry, begge med EU-datalagring | Gratis niveauer rækker til start. Data i EU |
| Firmaoplysninger m.m. | Indsættes af serveren ved hver sidevisning | Ét sæt miljøvariabler, intet nyt build når de ændres |
| Dubletter | Samme tilbud i flere aviser fra samme kæde gemmes og vises én gang (kæde, vare, pris, pris pr. enhed og gyldighed) | Fx Lidls ugeavis og weekendavis gav det samme tilbud to gange |
| Ny version | En fane fra før en deploy genindlæses én gang, hvis den mangler kode | Undgår en tom side efter hver deploy |
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
