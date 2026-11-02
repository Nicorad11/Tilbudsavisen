# Google Search Console

Tilbudsradar henter data fra Google Search Console ind i sin egen database hver morgen. Det er:
- **Søgeresultater:** klik, visninger, CTR og placering pr. dag, søgeord, side og enhed – for alle lande og for Danmark for sig.
- **Indekseringsstatus** for hver side i vores sitemap.
- **Sitemap-status.**

Data vises i admin → **SEO**, og `npm run seo:report` skriver en rapport (`docs/seo-report.md`), som Claude Code kan optimere sitet ud fra.

Integrationen bruger kun læseadgang (`webmasters.readonly`) via en *service account*. Den bruger **ikke** Googles Indexing API (kun til jobopslag og livestreams) og heller ikke det udfasede sitemap-ping.

## Opsætning (én gang, ca. 15 minutter)

### 1. Google Cloud-projekt
1. Gå til <https://console.cloud.google.com/> og log ind med den Google-konto, der ejer Search Console-ejendommen.
2. Vælg projekt-menuen øverst → **Nyt projekt**. Navn fx `tilbudsradar-seo` → **Opret**.

### 2. Slå Search Console API til
1. I projektet: **API'er og tjenester → Bibliotek**.
2. Søg efter **Google Search Console API** → **Aktivér**.

### 3. Service account og JSON-nøgle
1. **IAM og administrator → Tjenestekonti → Opret tjenestekonto**.
2. Navn fx `tilbudsradar-search-console`. Den skal **ikke** have nogen roller i projektet → **Udført**.
3. Åbn kontoen → fanen **Nøgler** → **Tilføj nøgle → Opret ny nøgle → JSON**. Filen hentes ned.
4. Notér kontoens e-mail, fx `tilbudsradar-search-console@tilbudsradar-seo.iam.gserviceaccount.com`.

> Får du at vide, at oprettelse af nøgler er blokeret (`iam.disableServiceAccountKeyCreation`), er kontoen en del af en Google Cloud-organisation med den regel. En administrator kan slå reglen fra for netop dette projekt under **IAM og administrator → Organisationspolitikker**. Private Google-konti uden organisation har ikke reglen.

### 4. Giv service accounten adgang i Search Console
1. Åbn <https://search.google.com/search-console> → ejendommen **tilbudsradaren.dk**.
2. **Indstillinger → Brugere og tilladelser → Tilføj bruger**.
3. E-mail: service-accountens e-mail fra trin 3. Tilladelse: **Begrænset** → **Tilføj**.

### 5. Sæt miljøvariablerne i Render
1. Base64-kod JSON-nøglen:
   - **Windows (PowerShell):**
     ```powershell
     [Convert]::ToBase64String([IO.File]::ReadAllBytes("C:\Users\dig\Downloads\noegle.json")) | Set-Clipboard
     ```
   - **macOS:** `base64 -i noegle.json | pbcopy`
   - **Linux:** `base64 -w0 noegle.json`
2. I Render → servicen **tilbudsradar** → **Environment** → **Add Environment Variable**:

   | Variabel | Værdi |
   |---|---|
   | `GSC_SERVICE_ACCOUNT_JSON` | den base64-kodede nøgle |
   | `GSC_SITE_URL` | `sc-domain:tilbudsradaren.dk` (vores ejendom er en domæne-ejendom) |
   | `GSC_CRON` | valgfri – standard `40 7 * * *` (kl. 7.40 dansk tid) |

3. **Save Changes**. Render genstarter servicen.
4. Slet den hentede JSON-fil (eller gem den i din password manager). Den må aldrig i Git.

### 6. Tjek at det virker
1. Åbn admin → **SEO**. Statuslinjen skal vise "Ikke hentet endnu" i stedet for "Ikke sat op".
2. Tryk **Hent data nu**. Første gang hentes alt, hvad Google har (op til 16 måneder; for en ny ejendom kun få dage). Efter et minut eller to skal statuslinjen vise **OK** og antal rækker.
3. Tryk **Inspicér URL** og skriv `/tilbud/smoer`. Du skal se Googles status for siden.
4. Kør `npm run seo:report` lokalt for at få rapporten. Det kræver de samme to variabler i din lokale `.env` – eller `DATABASE_URL` til en database med data, sammen med `--no-sync`.

## Hvad der hentes

| Data | Hvornår | Hvor |
|---|---|---|
| Søgeresultater (`searchanalytics.query`) | Dagligt. De seneste 5 dage hentes igen, fordi Google justerer tallene. Første gang: backfill 16 måneder. | `gsc_metrics` |
| Foreløbige tal (`dataState: all`) | Dagligt, de seneste 5 dage | `gsc_metrics` (`total_fresh`) |
| Indekseringsstatus (URL Inspection API) | Dagligt i rotation – aldrig tjekkede først, derefter de ældst tjekkede | `gsc_url_inspections` |
| Sitemaps (`sitemaps.list`) | Dagligt | `gsc_sitemaps` |
| Kørsler (status, fejl) | Hver hentning | `gsc_sync_runs` |

Datasæt i `gsc_metrics`, alle både for alle lande (`all`) og Danmark (`dnk`):

| Datasæt | Indhold |
|---|---|
| Søgeord + side | web og billeder |
| Totaler pr. dag | Rækker pr. søgeord summerer ikke til totalen, fordi Google anonymiserer sjældne søgninger – derfor hentes totaler for sig |
| Totaler pr. enhed | |
| Side pr. enhed | |
| Discover pr. side | Discover har hverken søgeord eller placering |

**Kvote for URL-inspektion:** Google tillader 600 kald pr. minut og 2.000 pr. døgn pr. ejendom. Vi bruger højst 300 pr. minut og 1.500 pr. døgn, og manuelle tjek fra admin tæller med. Med de nuværende ca. 123 sider tjekkes alle hver dag.

**Fejl:**
- Kørslen gemmes som fejlet, fejlen logges, og næste kørsel prøver igen.
- Efter 2 fejlede kørsler i træk sendes en alarm via Slack eller e-mail (`SLACK_WEBHOOK_URL`, `ALERT_EMAIL_TO`) – samme mekanisme som for scraperne.
- Cron-jobbet vælter aldrig serveren.

## Sikkerhed
- Nøglen ligger kun i Render som miljøvariabel.
- Den logges aldrig, sendes aldrig til frontenden, og fejlbeskeder renses for nøgler og tokens.
- Admin viser kun service-accountens e-mail.
- Service accounten har kun læseadgang ("Begrænset") til Search Console og ingen roller i Google Cloud.

## Fejlfinding

| Besked | Årsag |
|---|---|
| "Ikke sat op: GSC_SERVICE_ACCOUNT_JSON kan ikke læses" | Værdien er ikke base64 af JSON-filen. Kopiér igen med kommandoen i trin 5. |
| "Search Console svarede 403: User does not have sufficient permission" | Service accounten er ikke tilføjet i trin 4, eller `GSC_SITE_URL` peger på en anden ejendom. |
| "Search Console svarede 403: … API has not been used in project …" | Search Console API er ikke slået til (trin 2). |
| "Kunne ikke logge ind hos Google med service accounten" | Nøglen er slettet eller ugyldig – opret en ny (trin 3). |
| Ingen data efter første hentning | Normalt for en ny ejendom: Google viser tal med 2–3 dages forsinkelse. |

## Analysen og rapporten
Analysen ligger i `backend/src/services/seo/opportunities.ts`. Alle tærskler er navngivne konstanter øverst i filen.

| Analyse | Hvad den finder |
|---|---|
| Lav klikrate | Placering ≤ 10 og CTR under 60 % af vores egen median for samme placering. Viser nuværende titel og beskrivelse. |
| Tæt på side 1 | Placering 8–20. Viser hvilke sider der allerede linker til siden. |
| Manglende sider | Søgeord om varer, vi har tilbud på, men ingen side for – som linjer klar til `shared/src/seoTerms.ts`. |
| Kannibalisering | Samme søgeord på flere af vores sider. |
| Døde sider | Ingen visninger efter 28 dage i sitemapet, eller ikke indekseret. |
| Trend | 28 dage mod de 28 før – totalt og pr. sidetype. |

`npm run seo:report` skriver `docs/seo-report.md` (står i `.gitignore`):

```bash
npm run seo:report                 # henter først fra API'et, hvis GSC_* er sat
npm run seo:report -- --no-sync    # kun data i databasen
npm run seo:report -- --dk         # kun Danmark
```

Med den indlejrede database (PGlite) må API-serveren ikke køre samtidig. Titler og interne links kræver et frontend-build (`npm run build`).
