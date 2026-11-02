import { POPULAR_TERMS, SEO_CATEGORIES, SEO_STORES } from '@tilbudsradar/shared';
import { TRUST_THRESHOLDS } from '../trust';

/**
 * /llms.txt (llmstxt.org): en kort oversigt i Markdown til AI-assistenter – hvad
 * Tilbudsradar er, hvordan tallene beregnes, og hvor de offentlige sider ligger.
 * Bygges af de samme lister som footeren, så links aldrig peger på sider, der ikke findes.
 */
export function llmsTxt(appUrl: string, contactEmail: string): string {
  const url = (path: string) => `${appUrl}${path}`;
  const t = TRUST_THRESHOLDS;
  return [
    '# Tilbudsradar',
    '',
    '> Tilbudsradar samler ugens tilbudsaviser fra REMA 1000, Netto, føtex, Bilka og Lidl i Danmark, regner priserne om pr. kg, liter eller stk. og vurderer, om hvert tilbud er reelt ud fra varens egen pris de sidste 90 dage.',
    '',
    '- Priserne hentes automatisk to gange om dagen fra kædernes offentlige tilbudsaviser. Kædens egen pris i butikken gælder altid.',
    `- Et tilbud er reelt, når prisen pr. enhed er mindst ${t.realPct} % under varens gennemsnitspris de sidste ${t.windowDays} dage. Kædens egen førpris bruges ikke som målestok.`,
    '- Tilbudsradar er uafhængigt og ikke tilknyttet kæderne. Siderne er på dansk og opdateres, når nye aviser kommer.',
    `- Kontakt: ${contactEmail}`,
    '',
    '## Ugens tilbud',
    '',
    `- [Alle varer på tilbud A–Å](${url('/tilbud')}): laveste pris pr. kg, liter eller stk. for hver vare i denne uge`,
    `- [Ugens bedste tilbud](${url('/ugens-bedste-tilbud')}): de største reelle besparelser på tværs af kæderne`,
    `- [Tilbudsaviser pr. kæde](${url('/butikker')}): antal tilbud og reelle tilbud pr. kæde`,
    ...SEO_STORES.map((s) => `- [${s.name} tilbud](${url(`/butik/${s.slug}`)})`),
    '',
    '## Populære varer',
    '',
    ...POPULAR_TERMS.map((term) => `- [${term.label} på tilbud](${url(`/tilbud/${term.slug}`)})`),
    '',
    '## Metode og afsender',
    '',
    `- [Indsigt: hvor reelle er tilbuddene?](${url('/indsigt')}): andel reelle tilbud pr. kæde de sidste 7 og 30 dage, rabatten i avisen mod den målte og ugens største prisfald`,
    `- [Metode](${url('/metode')}): sådan beregnes pris pr. enhed, og hvornår et tilbud er reelt`,
    `- [Om Tilbudsradar](${url('/om')}): virksomheden bag og kontakt`,
    '',
    '## Optional',
    '',
    ...SEO_CATEGORIES.map((c) => `- [${c.label} på tilbud](${url(`/kategori/${c.slug}`)})`),
    `- [Priser](${url('/priser')}): abonnementet på appen`,
    '',
  ].join('\n');
}
