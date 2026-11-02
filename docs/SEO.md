# SEO og offentlige sider

Målet: når nogen søger efter dagligvaretilbud, priser eller "hvor er X billigst", skal Tilbudsradar kunne findes i Google, Bing/Copilot, ChatGPT search, Perplexity og Claude – og links skal se pæne ud, når de deles. Det sker med rigtigt indhold bygget på vores egne data (pris pr. kilo/liter på tværs af kæder og "er tilbuddet reelt?"), ikke med tricks: den HTML, serveren sender, er præcis det, brugeren ser.

## Overblik

| Del | Hvor |
|---|---|
| Server-rendering (SSR) | `frontend/src/entry-server.tsx` (bygges til `frontend/dist/server/`), `backend/src/http/ssr.ts`, `backend/src/http/site.ts` |
| Hydrering i browseren | `frontend/src/main.tsx`, `frontend/src/publicPages.ts` |
| Datasidernes indhold | `backend/src/services/seo/pages.ts` (alt tekst og alle tal), `termIndex.ts` (hvilke tilbud hører til hvilken vare) |
| Vareliste, kæder, kategorier | `shared/src/seoTerms.ts`, `shared/src/slug.ts` |
| Meta, robots, JSON-LD | `shared/src/seo.ts`, `shared/src/jsonLd.ts`, `frontend/src/lib/seo.ts` |
| Sitemaps, IndexNow, delingsbilleder, llms.txt | `backend/src/services/seo/sitemap.ts`, `indexNow.ts`, `ogImage.ts`, `llmsTxt.ts` |
| Sidernes React-komponenter | `frontend/src/pages/seo/` |
| Tests | `backend/test/ssr.test.ts`, `seoPages.test.ts`, `seoTechnical.test.ts`, `seoLinks.test.ts`, `seoInsights.test.ts` |

## Sider

| Sti | Indhold | Med i søgemaskinerne |
|---|---|---|
| `/` | Forside med populære varer på tilbud nu (laveste pris pr. enhed) og kæderne | altid |
| `/tilbud` | Alle varer med data, A–Å, med laveste pris pr. enhed | altid |
| `/tilbud/{vare}` | Ugens tilbud på varen sorteret efter pris pr. enhed, vurdering af hvert tilbud, prisniveau de sidste 90 dage, spørgsmål og svar, relaterede varer | ≥ 3 aktuelle tilbud eller ≥ 6 de sidste 90 dage. Under det: 200 med `noindex,follow` og "sidst på tilbud". Aldrig set: 404 |
| `/butikker` | De fem kæder med antal tilbud og reelle tilbud | altid |
| `/butik/{kæde}` | Kædens bedste reelle tilbud, fordeling på vurdering og kategorier, varer hvor kæden er billigst | ≥ 10 aktuelle tilbud |
| `/kategori/{kategori}` | Kategoriens bedste reelle tilbud pr. kæde og varerne i kategorien. Kun synlige kategorier – ikke de pausede og ikke "Andet" | ≥ 10 aktuelle tilbud |
| `/ugens-bedste-tilbud` | De største reelle besparelser på tværs af kæderne | ≥ 5 reelle tilbud |
| `/indsigt` | Hvor reelle er tilbuddene? Andel reelle pr. kæde (7 og 30 dage), pris mod normalpris, ugens største prisfald | ≥ 50 vurderede tilbud de sidste 7 dage |
| `/metode` | Hvor priserne kommer fra, pris pr. enhed, hvornår et tilbud er reelt, hvordan varesiderne samles | altid |
| `/priser`, `/om`, `/fortryd`, juridiske sider | Faste sider – nu server-renderede | altid |
| `/app/*` | Appen – renderes i browseren som før | aldrig (`noindex,follow`) |

Kæder: `rema-1000`, `netto`, `foetex`, `bilka`, `lidl`. Slugs laves med `slugify` (æ → ae, ø → oe, å → aa). Kædenavne bruges kun beskrivende, og alle kæde- og datasider siger, at Tilbudsradar ikke er tilknyttet kæderne.

## Sådan virker server-renderingen

1. En forespørgsel på en offentlig sti (alt uden for `/app` og `/api`) går til `createSsr` i `backend/src/http/ssr.ts`.
2. Serveren henter sidens data direkte fra services (ikke via HTTP) med **de samme query-nøgler** som frontendens hooks: `['stats']` og `['seo', 'forside']` på forsiden, `['seo', ...stiens dele]` på datasiderne.
3. SSR-bundlet (`frontend/dist/server/entry-server.js`) renderer `<App>` med `StaticRouter` og de offentlige sider importeret direkte. `useSeo(meta)` skriver sidens meta til en `HeadContext`, som serveren bygger `<head>` og statuskoden (200/404) ud fra.
4. Data sendes med som `<script id="tr-state" type="application/json">` (ingen kode, der udføres – CSP'en er uændret). Browseren hydrerer den samme HTML. Ved navigation i browseren hentes datasiderne fra `GET /api/seo/...`.
5. HTML'en caches pr. sti i 10 minutter og nulstilles, når nye tilbud hentes (`bumpDataVersion`). Datasiderne caches i 30 minutter, vareindekset i 6 timer, sitemaps i 30 minutter og delingsbilleder i 6 timer – alt pr. data-version.

Regler, der holder server og browser enige (ellers hydreringsfejl):

- Alle datoer formateres i `Europe/Copenhagen` (`frontend/src/lib/format.ts`). "Nu" på datasiderne er sidens `generatedAt` fra serveren.
- Login-tilstanden er altid "logget ud" ved første render – på serveren og i browseren.
- `localStorage` læses først efter mount.

`npm run dev` er stadig ren klient-rendering via Vite. SSR afprøves med `npm run build && npm start`.

## Teknisk SEO

- **Sitemaps:** `/sitemap.xml` er et indeks over `sitemap-pages.xml`, `sitemap-tilbud.xml`, `sitemap-butikker.xml` og `sitemap-kategorier.xml`. Kun sider, der må indekseres. `lastmod` er den nyeste dag, et af sidens aktuelle tilbud blev set første gang. Faste sider har en fast dato (`STATIC_LASTMOD` i `shared/src/seo.ts` – opdater den, når teksten ændres).
- **robots.txt:** én gruppe for alle crawlere (ingen særregler for bots). `/api/` og private dele af `/app` er udelukket.
- **robots-meta:** indekserbare sider får `max-image-preview:large, max-snippet:-1`, resten `noindex,follow`. Alle `/api`-svar har `X-Robots-Tag: noindex`.
- **Kanoniske adresser:** absolutte og uden query. Afsluttende skråstreg og store bogstaver omdirigeres med 301 (`/Tilbud/Smoer/` → `/tilbud/smoer`, query bevares).
- **Strukturerede data (JSON-LD):** `Organization` og `WebSite` på forsiden, `BreadcrumbList` på undersiderne, `WebPage` med `dateModified` og en `ItemList` af `Product`/`Offer` (pris i DKK, `priceValidUntil`, kæden som sælger) på vare-, kæde- og kategorisider. Ingen `AggregateRating`, `Review` eller `SearchAction`.
- **Delingsbilleder (1200 × 630):** `/og/tilbud/{vare}.png`, `/og/butik/{kæde}.png`, `/og/kategori/{kategori}.png` og `/og/indsigt.png`, tegnet med satori og resvg i Inter Tight. Fejler tegningen, eller findes siden ikke, sendes `/og-image.png`. Service workeren cacher ikke `/og/`.
- **IndexNow:** med `INDEXNOW_KEY` sat serveres nøglen på `/{nøgle}.txt`, og efter hver hentning af aviserne meldes de sider, hvis `lastmod` er ændret, i én samlet besked til `api.indexnow.org` (Bing, Yandex, Seznam m.fl. – ikke Google). Kun i produktion. Fejl logges og vælter aldrig hentningen.
- **Bekræftelse:** `GOOGLE_SITE_VERIFICATION` og `BING_SITE_VERIFICATION` giver meta-tags på alle sider. Bekræftelse via DNS virker også og kræver ingen af dem.
- **Ydelse:** skrifttypen forudindlæses, grafbiblioteket (recharts) er kun i appens chunks, og Cloudflare komprimerer HTML med Brotli.

## Intern linking og AI-synlighed

- Headeren linker til `/tilbud`. Footeren (på alle sider) linker til de populære varer, de fem kæder, alle kategorier, ugens bedste tilbud, `/indsigt` og `/metode` – faste lister, ingen hentning.
- Forsiden har "Populære varer på tilbud lige nu" og "Tilbudsaviserne i uge N", begge server-renderede.
- I appen har tilbudspanelet "Se alle tilbud på {vare} i denne uge", når tilbuddet hører til en vareside (den mest præcise vare vinder).
- `/metode` og `/om` forklarer, hvem der står bag, hvor data kommer fra, hvordan de vurderes, og at rækkefølgen kun afgøres af pris og målt besparelse.
- `/llms.txt` er en kort oversigt i Markdown med absolutte links til hubs, kæder, populære varer, indsigt og metode.

## Sådan tilføjes en vare

1. Kør `npm run seo:candidates -w backend` (stop API-serveren først, hvis du bruger den indlejrede database). Den viser varetyper med mange tilbud, som ingen vare på listen dækker.
2. Tilføj en linje i `shared/src/seoTerms.ts`:
   ```ts
   ['Bacon', ['bacon'], ['kod-fisk'], { exclude: ['postej'], popular: true }],
   ```
   Label (som danskere søger), søgeord (hvert ord skal stå som et helt ord i titel, mærke eller navn), tilladte kategorier og eventuelt `exclude` (ord i titlen, der betyder en anden vare), `popular` (footer og forside), `slug` og `phrase`.
3. Byg og start prod lokalt, og tjek `/tilbud/{slug}`: står de rigtige tilbud der, og mangler der nogen? Justér søgeord og `exclude`.
4. Kør `npm test`.

Matchningen bruger bevidst ikke søgningens varetype-indeks, fordi det også matcher forstavelser ("ost" → "tørkost"). Hele ord giver færre, men rigtige tilbud.

## Miljøvariabler

| Variabel | Formål |
|---|---|
| `INDEXNOW_KEY` | 8–128 tegn (a–z, A–Z, 0–9, -), fx et UUID. Slår IndexNow og nøglefilen til. Tom = fra |
| `GOOGLE_SITE_VERIFICATION` | Valgfri. Værdien fra Search Consoles HTML-tag (kun `content="…"`) |
| `BING_SITE_VERIFICATION` | Valgfri. Værdien fra Bing Webmaster Tools' `msvalidate.01`-tag |

`APP_URL` bruges til alle absolutte adresser (canonical, sitemaps, JSON-LD, llms.txt).

## Efter deploy

1. Sæt `INDEXNOW_KEY` i Render (fx et nyt UUID), og tjek at `https://tilbudsradaren.dk/{nøgle}.txt` svarer med nøglen.
2. **Google Search Console:** opret en domæne-ejendom for `tilbudsradaren.dk` og bekræft med TXT-posten hos DNS.services (eller brug `GOOGLE_SITE_VERIFICATION`). Indsend `https://tilbudsradaren.dk/sitemap.xml`. Brug URL-inspektion på `/`, `/tilbud`, `/tilbud/smoer` og `/indsigt`, og bed om indeksering.
3. **Bing Webmaster Tools:** importér sitet fra Search Console (eller bekræft med `BING_SITE_VERIFICATION`), og indsend sitemapet. Bing bruges også af ChatGPT search og Copilot.
4. **Rich Results Test** (<https://search.google.com/test/rich-results>) på `/` og `/tilbud/smoer`: brødkrummer og produktliste skal læses uden fejl.
5. **Cloudflare:** tjek under *Security → Bots* og *AI Crawl Control*, at AI-crawlere (GPTBot, ClaudeBot, PerplexityBot m.fl.) ikke blokeres, og at Cloudflare ikke selv skriver i `robots.txt`, hvis du vil være synlig i AI-søgning.
6. Åbn `/og/tilbud/smoer.png` i produktion (resvg bruger en færdigbygget Linux-binær, som ikke er afprøvet i Docker lokalt), og følg Render-loggen ved første hentning for `[indexnow]`.
7. Kør PageSpeed Insights på `/`, `/priser` og `/tilbud/smoer`, og sammenlign med baseline herunder.

## Baseline (2. november 2026, før arbejdet)

Målt på `launch-prep` (commit `46559a6`) – lokalt prod-build og live-sitet.

### Hvad ser en crawler uden JavaScript?

Målt med en simpel HTML-læser, der fjerner `<script>`/`<style>` og tæller den synlige tekst i `<body>`:

| Side | Status | HTML | Tekst i body | H1 | Interne links | JSON-LD |
|---|---|---|---|---|---|---|
| `/` | 200 | 3,3 kB | **0 tegn** | 0 | 0 | 0 |
| `/priser` | 200 | 3,0 kB | **0 tegn** | 0 | 0 | 0 |
| `/app/sog` | 200 | 3,2 kB | **0 tegn** | 0 | 0 | 0 |
| `/om` (lokalt) | 200 | 2,7 kB | **0 tegn** | 0 | 0 | 0 |

`<body>` er kun `<div id="root"></div>`. Titel, beskrivelse, canonical og Open Graph sættes af serveren pr. side, men alt indhold renderes i browseren. Crawlere, der ikke kører JavaScript (de fleste AI-crawlere og delvist Bing), ser derfor ingen tekst og ingen links. Sitet har kun 3 sider med reelt indhold.

### Lighthouse (mobil, live-sitet)

Lighthouse 12, mobilprofil, kørt lokalt mod `https://tilbudsradaren.dk`.

| Side | Performance | Tilgængelighed | Best practices | SEO | FCP | LCP | TBT | CLS |
|---|---|---|---|---|---|---|---|---|
| `/` | 93 | 96 | 100 | 100 | 2,1 s | 2,8 s | 100 ms | 0,001 |
| `/priser` | 84 | 95 | 100 | 100 | 2,2 s | 3,1 s | 90 ms | **0,158** |

Lighthouse' SEO-score tjekker kun det grundlæggende (titel, beskrivelse, statuskode, crawlbarhed) og siger intet om indhold. LCP ligger over målet på 2,5 s på begge sider, og CLS på `/priser` er over 0,1.

Andet:

- HTML komprimeres allerede med Brotli af Cloudflare (`Content-Encoding: br`) – der er ikke brug for komprimering i Express.
- `sitemap.xml` har 8 adresser med dagens dato som `lastmod` på alle.

## Efter (2. november 2026, branch `seo`)

Lokalt prod-build med lokale data (tilbud siden 3. oktober), samme HTML-læser:

| Side | Status | HTML | Tekst i body | H1 | Interne links | JSON-LD | robots |
|---|---|---|---|---|---|---|---|
| `/` | 200 | 76 kB | 7.122 tegn | 1 | 54 | 2 | indekseres |
| `/priser` | 200 | 25 kB | 3.474 tegn | 1 | 53 | 1 | indekseres |
| `/om` | 200 | 17 kB | 2.438 tegn | 1 | 54 | 1 | indekseres |
| `/tilbud` | 200 | 84 kB | 4.920 tegn | 1 | 171 | 2 | indekseres |
| `/tilbud/smoer` | 200 | 63 kB | 4.745 tegn | 1 | 61 | 3 | indekseres |
| `/tilbud/citroner` | 200 | 25 kB | 1.984 tegn | 1 | 62 | 2 | `noindex,follow` (for få tilbud) |
| `/butik/netto` | 200 | 80 kB | 4.969 tegn | 1 | 68 | 3 | indekseres |
| `/kategori/mejeri-aeg` | 200 | 61 kB | 3.938 tegn | 1 | 63 | 3 | indekseres |
| `/ugens-bedste-tilbud` | 200 | 161 kB | 9.840 tegn | 1 | 53 | 3 | indekseres |
| `/indsigt` | 200 | 40 kB | 5.480 tegn | 1 | 55 | 2 | indekseres |
| `/metode` | 200 | 21 kB | 3.814 tegn | 1 | 53 | 2 | indekseres |
| `/app/sog` | 200 | 3 kB | 0 tegn | 0 | 0 | 0 | `noindex,follow` |
| `/tilbud/findes-ikke` | 404 | 14 kB | 1.083 tegn | 0 | 53 | 0 | `noindex,follow` |

Sitemaps: 113 adresser (12 faste sider og hubs, 83 varer, 5 kæder, 13 kategorier) mod 8 før. 138 af de 158 varer har data; 83 af dem har nok til at blive indekseret.

Lighthouse 12 (mobil, lokalt): SEO 100, best practices 100 og tilgængelighed 95–96 på `/`, `/tilbud/smoer`, `/butik/netto` og `/indsigt`. Tilgængelighed trækkes ned af kontrasten på den dæmpede tekstfarve – som før. Performance er ikke målt efter: det lokale build bruger Reacts udviklingsudgave, så tallene kan ikke sammenlignes med baseline. Mål med PageSpeed Insights efter deploy (trin 7 ovenfor).

## Begrænsninger

- **Kort historik:** data går kun tilbage til midten af oktober, og de fleste varer har endnu for lidt prishistorik til en vurdering (fx 2.487 af 2.680 tilbud på en uge). Siderne siger det åbent, og antallet af indekserbare sider stiger af sig selv, efterhånden som historikken vokser.
- **Normalpriser kun fra REMA 1000:** de andre kæder offentliggør ikke hyldepriser, så deres tilbud måles mod REMA 1000's normalpris for samme vare eller mod tidligere tilbud. `/indsigt` skriver det ved tallene.
- **Vurderingen er altid "nu":** tal for de sidste 30 dage bruger den prishistorik, vi har i dag – ikke den, der var, da tilbuddet gjaldt.
- **Footerens faste lister** linker til de populære varer og alle kategorier, uanset data. En vare, der aldrig har været på tilbud, svarer 404 – det sker ikke for de populære varer med de nuværende data.
- **Docker er ikke afprøvet lokalt.** SSR-bundlet er afprøvet fra en mappe uden `node_modules`, og lockfilen har resvg's Linux-binær, men første deploy skal følges (trin 6).
- **IndexNow** bruges ikke af Google – der virker sitemapet og Search Console.
- **`/llms.txt`** er en frivillig konvention, som ikke alle AI-tjenester læser. Det vigtigste for AI-søgning er, at siderne er server-renderede og ikke blokeres (trin 5).
