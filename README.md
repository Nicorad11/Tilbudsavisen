# TilbudsRadar

Smart søgning i danske tilbudsaviser. TilbudsRadar henter tilbud fra REMA 1000, Netto, føtex, Bilka og Lidl, sammenligner prisen **pr. kg/liter/stk** på tværs af kæderne og vurderer, om et tilbud er en reel besparelse. Oveni kommer indkøbslister med butiks-splitting, prisalarmer, community-vurderinger og en kvitteringsscanner, der viser hvad du sparede og finder varer, der blev slået forkert ind.

Webapp (mobil-first, responsiv) i TypeScript: React + Vite + Tailwind i frontenden, Express + Drizzle + Postgres i backenden og et separat scraping-modul.

---

## Kom i gang

Krav: **Node.js 20.10+** (testet med Node 24).

```bash
npm install
cp .env.example .env        # valgfrit – alle værdier har fornuftige standarder
npm run dev                 # API på :4000 og web på :5173
```

Åbn <http://localhost:5173>.

- **Ingen databaseinstallation nødvendig.** Uden `DATABASE_URL` kører en rigtig Postgres 17 (PGlite/WASM) inde i API-processen, og data gemmes i `backend/.data/pglite`.
- **Første opstart scraper automatisk.** Det tager 3–4 minutter, fordi der holdes pauser mellem hver forespørgsel. Følg med under **Kilder**. Butikslokationer (til geolokation) hentes bagefter.
- Derefter scrapes der automatisk kl. 06:15 og 18:15 (`SCRAPE_CRON`).

### Scripts

| Kommando | Beskrivelse |
|---|---|
| `npm run dev` | API + frontend med hot reload |
| `npm test` | Unit-tests af scrapere + integrationstests af API'et |
| `npm run typecheck` | TypeScript-tjek af alle pakker |
| `npm run scrape -- --source rema1000 --max-pages 1` | Kør scrapere **uden database** og se resultatet (JSON i `scrapers/out/`) |
| `npm run ingest -- --source netto --stores` | Scrape og gem i databasen uden at starte API'et |
| `npm run reprocess` | Kør alle gemte rå data igennem den nuværende normalisering igen |
| `npm run db:seed-demo` | **Demo-data:** 180 dages syntetisk prishistorik (markeret i UI'et). Fjern med `npm run db:seed-demo -- --clear` |
| `npm run db:generate` | Generér en ny migration efter ændringer i `backend/src/db/schema.ts` |
| `npm run build` / `npm start` | Produktionsbuild; backend serverer også den byggede frontend |

> Med den indlejrede database kan kun én proces åbne den ad gangen. Stop `npm run dev`, før du kører `ingest`, `reprocess` eller `db:seed-demo`. Med en rigtig Postgres (`DATABASE_URL`) gælder det ikke.

---

## Arkitektur

```
┌──────────────────────────── frontend (React + Vite) ────────────────────────────┐
│  Oversigt · Søg · Lister · Kvitteringer · Alarmer · Kilder · Konto               │
│  React Query (data) · Zustand (session/præferencer) · Recharts (prishistorik)    │
└───────────────────────────────┬──────────────────────────────────────────────────┘
                                │ /api  (JWT access token + httpOnly refresh-cookie)
┌───────────────────────────────▼────────────── backend (Express) ─────────────────┐
│ routes/  auth · offers/search · lists · watchlist · admin · receipts             │
│ services/                                                                        │
│   offers   – søgning (fuldtekst + pg_trgm), pris pr. enhed, facetter            │
│   trust    – "Er dette et reelt tilbud?" (90-dages gennemsnit)                  │
│   lists    – billigste butikskombination (butiks-splitting)                     │
│   receipts – kvitteringer: Claude eller tekstgenkendelse + tjek mod avisen      │
│   matcher  – kanoniske varer: alias → eksakt → fuzzy → ny vare                  │
│   ingest   – rå data → tilbud → prishistorik                                    │
│   scrapeJobs – cron, feature-flags, kørselslog, fejlnotifikationer              │
└───────┬───────────────────────────────────────────────────────────┬──────────────┘
        │ Drizzle ORM                                               │ runScraper()
┌───────▼──────────────── Postgres ───────────┐   ┌─────────────────▼── scrapers ───────────────────┐
│ stores · store_locations · scrape_sources   │   │ chains/   rema1000 · netto · foetex · bilka ·    │
│ scrape_runs · raw_offers (uændrede rå data) │   │           lidl  (pause: jemogfix · power)        │
│ products · product_aliases · offers         │   │ sources/  tjek (tilbuds-API) · remaWebshop      │
│ price_history · users · refresh_tokens      │   │ html/     JSON-LD / CSS-selektorer (+Playwright)│
│ shopping_lists(+items) · watchlist          │   │ http/     robots.txt · rate-limit pr. vært ·    │
│ notifications · community_reports/votes     │   │           Cache-Control/ETag · retry/backoff    │
│ receipts · meal_plans (ubrugt)              │   │ normalize/ mængder · kr/enhed · navne ·         │
│ (PGlite lokalt, Postgres i produktion)      │   │           kategorier · fuzzy matching           │
└─────────────────────────────────────────────┘   └──────────────────────────────────────────────────┘
                                                            │ HTTPS (tydelig User-Agent)
                                          squid-api.tjek.com · cphapp.rema1000.dk
shared/  fælles typer (ScrapedOffer, API-DTO'er, kategorier)
```

### Mappestruktur

```
shared/     Fælles typer og kategorier
scrapers/   Scraping-modul (kan køres alene via CLI) + tests med fixtures
backend/    Express-API, Drizzle-skema, migrationer, services, scripts, tests
frontend/   React-app (designsystem i src/index.css, komponenter i src/components)
```

---

## Scraping

### Kilder

| Kilde | Type | Hvad |
|---|---|---|
| `rema1000`, `netto`, `foetex`, `bilka`, `lidl` | Tilbuds-API | Aktive og kommende aviser via det offentlige JSON-API bag eTilbudsavis (Tjek) |
| `rema1000-webshop` | Webshop-API | REMA 1000's normale hyldepriser, der bruges som baseline i prishistorikken |
| `createHtmlScraper()` | HTML | Generisk strategi (schema.org JSON-LD eller CSS-selektorer) til kæder uden API. Testet med fixtures |

Strukturerede API'er er valgt som primær kilde frem for HTML, fordi de er mere robuste, giver præcise mængder (SI-faktor) og belaster kædernes egne sider mindre.

### Ansvarlig scraping

- **robots.txt** hentes og respekteres før hver request (RFC 9309: længste regel vinder, `Crawl-delay` understøttes). Hvis den ikke kan hentes, behandles værten som lukket.
- **Central rate-limiter pr. vært**, delt af alle scrapere: tilfældig pause på 1–3 s og loft på 30 requests/min (`SCRAPER_*` i `.env`).
- **Tydelig User-Agent** med kontaktinfo (`SCRAPER_USER_AGENT`).
- **Cache-Control, ETag og Retry-After** respekteres, og 429/5xx giver retry med eksponentiel backoff.
- **Feature-flags:** en hel kæde eller en enkelt kilde kan slås fra under *Kilder* eller via `DISABLED_CHAINS`.

### Robusthed

- Hver kæde er et isoleret modul. `runScraper()` kaster aldrig, så én kildes fejl stopper ikke de andre.
- Svar valideres med zod. Afvises mere end halvdelen af records, eller kommer der ingen data, markeres kørslen som **mulig strukturændring**, og der sendes notifikation (log + `SLACK_WEBHOOK_URL` og/eller e-mail via `SMTP_URL`), højst én pr. kilde pr. 6 timer.
- Rå data gemmes uændret i `raw_offers` (dedupliceret på indholds-hash), så `npm run reprocess` altid kan genopbygge tilbud med forbedret logik.

### Standardformat

Alle scrapere returnerer `ScrapedOffer` (`shared/src/scraping.ts`): `storeId, productName, normalizedProductName, category, originalPrice, offerPrice, unit, validFrom, validTo, imageUrl, sourceUrl`, plus `quantity`, `unitPrice`, `unitPriceMax` (kædernes "max pr. kg"), `brand` og `externalId`.

### Tilføj en kæde

```ts
// scrapers/src/chains/minkaede.ts
export const minKaede = createTjekScraper({
  chain: { id: 'minkaede', name: 'Min Kæde', color: '#123456', category: 'supermarked', website: 'https://…' },
  dealerId: 'XXXXX',          // find id'et via https://squid-api.tjek.com/v2/dealers
  dealerSlug: 'Min-Kaede',
});
```

Tilføj scraperen til `SCRAPERS` i `scrapers/src/chains/index.ts` og en farve i `frontend/src/lib/storeColors.ts`. Kæder uden API kan bruge `createHtmlScraper({ urls, strategy: 'jsonld' | { selectors } })`.

### Sat på pause: byggemarked og elektronik

Appen fokuserer for nu på dagligvarer. Kategorierne **Bolig, have & byg** og **Elektronik** samt kæderne **jem & fix** og **POWER** er slået fra, men koden er bevaret:

- `PAUSED_CATEGORIES` i `shared/src/categories.ts` – tilbud i disse kategorier gemmes ikke og vises ikke i filtre.
- `PAUSED_SCRAPERS` i `scrapers/src/chains/index.ts` – scrapere (og deres kæder) der ikke køres.
- Ved opstart fjerner `purgeOutOfScope()` (`backend/src/services/scope.ts`) tilbud, der falder uden for. Rå data i `raw_offers` bevares.

Sådan slås de til igen:

1. Fjern id'et fra `PAUSED_CATEGORIES`, og/eller flyt scraperen fra `PAUSED_SCRAPERS` til `SCRAPERS` og dens `…Chain` til `CHAINS`.
2. Genstart API'et, og kør `npm run reprocess` (genskaber tilbud fra de gemte rå data) eller `npm run ingest -- --source jemogfix,power --stores` (henter friske data).

---

## Normalisering og prissammenligning

- **Mængder:** `"300-400 g"`, `"6 x 33 cl"` og `"PR. ½ KG"` omsættes til basisenhed (kg, l, stk). Pris pr. enhed beregnes af gennemsnitlig pakning, og `unitPriceMax` af den mindste.
- **Navne:** mærker (kendt liste plus versal-mærker som `MADVÆRKET`), mængder og fyldord fjernes, og forkortelser udvides, så "Arla Mælk 1L" og "Mælk, 1 liter, Arla" begge bliver til `mælk 1l`.
- **Kanoniske varer:** manuel/lært alias → eksakt kernenavn → pg_trgm-kandidater scoret med trigram/Levenshtein i JS (konservativ grænse 0,72, tal skal stemme) → ny vare. Manuelle mappings: `POST /api/admin/aliases`.
- **Kategorier:** danske nøgleord med ordgrænser, overrides og "hovedordet før *med*".
- **Søgning:** Postgres fuldtekst (dansk stemming) + delstrenge (sammensatte ord) + pg_trgm (stavefejl), rangeret i tre niveauer. Resultater sorteres efter pris pr. enhed inden for den dominerende enhed.

### "Er dette et reelt tilbud?"

Tilbuddets kr/enhed sammenlignes med gennemsnittet de sidste 90 dage. Grundlaget er i prioriteret rækkefølge: normalpris i samme kæde, normalpriser på tværs af kæder, og til sidst tidligere kampagner (svagt grundlag, kan aldrig give "reelt").

- Mindst 10 % under gennemsnittet giver **Reelt tilbud**, 3–10 % giver **Lille besparelse**.
- Reklamerer kæden med mindst 15 % rabat, men er prisen under 3 % lavere end normalt, markeres tilbuddet som **Opskrevet førpris?**.

---

## API (udvalg)

| Metode | Endpoint | |
|---|---|---|
| GET | `/api/search?q=&stores=&categories=&sort=unit\|price\|discount\|relevance&zip=&lat=&lng=&radius=` | Søgning på tværs af kæder |
| GET | `/api/offers/top`, `/api/offers/:id` | Bedste tilbud; detalje med alternativer og community |
| GET | `/api/products/:id/history?days=180` | Prishistorik |
| GET | `/api/stats`, `/api/stores`, `/api/stores/nearby`, `/api/categories` | Oversigt |
| POST | `/api/auth/guest\|register\|login\|refresh\|logout` | JWT + roterende refresh-cookie |
| GET/PATCH/DELETE | `/api/auth/me`, `GET /api/auth/me/export` | Præferencer, GDPR-indsigt og -sletning |
| CRUD | `/api/lists`, `/api/lists/:id/items`, `GET /api/lists/:id/optimize?maxStores=2` | Indkøbslister og butiks-splitting |
| CRUD | `/api/watchlist`, `GET /api/notifications` | Prisalarmer |
| POST | `/api/offers/:id/reports`, `/api/reports/:id/vote` | Community-verificering |
| POST | `/api/receipts/scan` (billede som `image/jpeg`/`png`), `/api/receipts/parse-text` | Aflæs en kvittering (gemmes ikke) |
| POST/GET/DELETE | `/api/receipts`, `/api/receipts/:id` | Gem og tjek en kvittering mod aviserne; oversigt og sletning |
| GET/PATCH/POST | `/api/admin/status`, `/api/admin/stores/:id`, `/api/admin/sources/:id`, `/api/admin/scrape` | Kilder og feature-flags |

## Kvitteringer

Under **Kvitteringer** kan man tage et billede af kvitteringen (eller indsætte teksten fra en e-kvittering). Flowet har tre trin:

1. **Aflæsning.** Med `ANTHROPIC_API_KEY` læser Claude billedet via structured output (klarer krøllet papir og fingre over teksten). Uden nøgle bruges tekstgenkendelse (tesseract, dansk) på serveren; sprogdata (~3 MB) hentes første gang til `OCR_CACHE_DIR`. Parseren (`backend/src/services/receipts/parseText.ts`) kender Lidl-, Salling- og REMA-formater og retter typiske læsefejl ("B" læst som "8", `10,00 x 3  230,00`, vægtlinjer, rabatter uden fortegn).
2. **Gennemsyn.** Linjerne vises redigerbart. Usikre linjer er markeret, og summen af linjerne sammenlignes med kvitteringens total.
3. **Tjek** (`services/receipts/check.ts`). Hver vare matches mod kædens avis på købstidspunktet – forkortede navne ("Henriettelund Skrab" → "HENRIETTELUND Skrabeæg"), pakningsstørrelse, øko og "Maks. 3 pr. kunde" tages med. Resultatet er *stemmer*, *under avisprisen*, *mulig fejl*, *kræver app* (fx Lidl Plus-priser uden app-rabat) eller *tjek selv*. Samme vare billigere i en anden kæde samme dag vises også.

Matchingen er bevidst forsigtig: kun sikre match kan give "mulig fejl". Tilbud fra dagen før eller efter (butikkerne starter tit næste uges priser en dag tidligt) må kun bekræfte en pris. Billedet gemmes aldrig – kun linjerne, så tjekket kan genberegnes.

## Deploy

- **Én service (fx Render):** build `npm install && npm run build`, start `npm start`. Sæt `DATABASE_URL` (Supabase/Neon/Render Postgres), `JWT_SECRET` (mindst 32 tegn), `ADMIN_EMAILS` og `NODE_ENV=production`. Migrationer kører automatisk ved opstart.
- **Delt frontend (fx Vercel):** byg `frontend` med `VITE_API_URL=https://din-api…` og sæt `CORS_ORIGINS` på API'et. Refresh-cookien sendes med `SameSite=None; Secure` i produktion.
- Kører der flere API-instanser, bør kun én køre cron-scraping (sæt `SCRAPE_CRON=` på de andre).

## Privatliv (GDPR)

- Søgning kræver ingen konto. En anonym gæstesession oprettes først, når man bruger lister, kvitteringer eller alarmer, og slettes efter 30 dages inaktivitet.
- Der gemmes kun e-mail, en scrypt-hash af adgangskoden og de præferencer, brugeren selv angiver.
- Brugeren kan hente alle sine data (JSON) og slette sin konto med alt tilknyttet (cascade) under **Konto**.
- Kvitteringsbilleder behandles kun i hukommelsen og gemmes ikke. Med `ANTHROPIC_API_KEY` sendes billedet til Anthropic for at blive læst. Gemte kvitteringer (linjerne) kan slettes enkeltvis og indgår i dataudtrækket.

---

## Kendte begrænsninger

- **Prishistorik tager tid.** Den opbygges fra første scraping. "Reelt tilbud" kræver mindst to målinger af normalprisen, og kun REMA 1000 har en webshop-baseline, så de andre kæder vurderes i starten på tværs af kæder. `db:seed-demo` kan bruges til at afprøve graferne (tydeligt markeret som demo-data).
- **Tilbuds-API'et er ikke officielt dokumenteret.** Formatet kan ændre sig (håndteres som strukturændring med notifikation). Læs Tjeks vilkår (<https://tjek.com/terms>) før kommerciel brug.
- **"X eller Y"-tilbud** (fx "hakket okse- eller grisekød") kobles til én kanonisk vare, og matching og kategorisering er heuristiske. Manuelle aliasser retter vigtige tilfælde.
- **Fritekst på indkøbslister** er grov ved korte, tvetydige ord. Vælg en vare fra forslagslisten for præcis matching.
- **Geolokation** bruger kædernes kendte butikker. Postnummer omsættes til midtpunktet af butikkerne i postnummeret. Kæder uden kendte butikker vises altid.
- **HTML-strategien** er implementeret og testet, men ingen kæde bruger den i dag. JS-renderede sider kræver `npm i -w scrapers playwright`.
- **Notifikationer** vises i appen og sendes som e-mail (med SMTP). Push-notifikationer er ikke implementeret endnu.
- **Den indlejrede database** understøtter kun én proces ad gangen (se ovenfor).
- **Kvitteringer uden Claude-nøgle** læses med tekstgenkendelse, som klarer et lige, skarpt billede godt, men laver fejl ved krøllet papir eller skygger. Gennemsynet med sum-tjek fanger det meste, men enkelte linjer skal rettes i hånden. Kun tilbud i de aviser, vi har hentet, kan tjekkes – varer til normalpris kan ikke kontrolleres.
- npm 11 kan advare om esbuilds install-scripts (`allowScripts`). Det påvirker ikke udvikling eller build.
