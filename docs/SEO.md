# SEO og offentlige sider

Målet: når nogen søger efter dagligvaretilbud, priser eller "hvor er X billigst", skal Tilbudsradar kunne findes i Google, Bing/Copilot, ChatGPT search, Perplexity og Claude – og links skal se pæne ud, når de deles. Det sker med rigtigt indhold bygget på vores egne data (pris pr. kilo/liter på tværs af kæder og "er tilbuddet reelt?"), ikke med tricks.

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
