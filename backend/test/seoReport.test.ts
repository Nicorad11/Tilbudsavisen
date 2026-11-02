import type { GscIndexingDTO, GscOpportunitiesDTO, GscOverviewDTO, GscSetupStatus } from '@tilbudsradar/shared';
import { describe, expect, it } from 'vitest';
import { THRESHOLDS } from '../src/services/seo/opportunities';
import { codeHint, renderSeoReport } from '../src/services/seo/report';

/** docs/seo-report.md – kompakt og med konkrete forslag. */

const SITE = 'https://tilbudsradaren.dk';
const setup: GscSetupStatus = { configured: true, reason: null, clientEmail: 'gsc@x.iam.gserviceaccount.com', siteUrl: 'sc-domain:tilbudsradaren.dk' };
const totals = (clicks: number, impressions: number, position: number) => ({ clicks, impressions, ctr: clicks / impressions, position });
const period = { start: '2026-11-13', end: '2026-12-10', previousStart: '2026-10-16', previousEnd: '2026-11-12' };

const overview: GscOverviewDTO = {
  setup,
  lastRun: null,
  running: false,
  generatedAt: '2026-12-12T08:00:00Z',
  days: 28,
  country: 'all',
  device: 'all',
  period,
  current: totals(120, 4000, 8.2),
  previous: totals(80, 3000, 9.6),
  byDay: [],
  fresh: [],
  topQueries: Array.from({ length: 30 }, (_, i) => ({ query: `søgeord ${i}`, page: `${SITE}/tilbud/smoer`, ...totals(30 - i, 100, 5) })),
  topPages: [{ page: `${SITE}/tilbud/smoer`, ...totals(60, 1200, 3.1) }],
  discover: [],
  images: [],
};

const opportunities: GscOpportunitiesDTO = {
  generatedAt: '2026-12-12T08:00:00Z',
  country: 'all',
  period,
  snapshotAvailable: true,
  thresholds: THRESHOLDS,
  lowCtr: [
    {
      kind: 'page',
      key: `${SITE}/tilbud/smoer`,
      page: `${SITE}/tilbud/smoer`,
      impressions: 1200,
      clicks: 6,
      ctr: 0.005,
      position: 2.4,
      medianCtr: 0.08,
      bucket: '1–3',
      title: 'Smør på tilbud – billigste pr. kg i uge 50 | Tilbudsradar',
      description: '9 tilbud på smør fra Lidl, Bilka og føtex.',
    },
  ],
  nearPageOne: [{ page: `${SITE}/butik/netto`, impressions: 400, clicks: 4, position: 11, topQueries: ['netto tilbud'], linkedFrom: ['/', '/butikker'], inFooter: true }],
  missingPages: [{ query: 'rødkål tilbud', impressions: 80, clicks: 1, label: 'rødkål', category: 'frugt-gront', offers: 5, stores: 3, line: "['Rødkål', ['rødkål'], ['frugt-gront']]," }],
  cannibalization: [{ query: 'smør', impressions: 300, pages: [{ page: `${SITE}/tilbud/smoer`, impressions: 200, clicks: 5, position: 4 }, { page: `${SITE}/kategori/mejeri-aeg`, impressions: 100, clicks: 0, position: 12 }] }],
  deadPages: [{ path: '/tilbud/citroner', reason: 'not_indexed', detail: 'Ikke indekseret: Crawled - currently not indexed' }],
  trend: { total: { label: 'I alt', current: totals(120, 4000, 8.2), previous: totals(80, 3000, 9.6) }, byType: [] },
};

const indexing: GscIndexingDTO = {
  setup,
  counts: { inSitemap: 123, inspected: 120, indexed: 100, withProblems: 1 },
  quota: { usedToday: 120, limit: 1500 },
  rows: [
    {
      url: `${SITE}/tilbud/citroner`,
      path: '/tilbud/citroner',
      inSitemap: true,
      inspectedAt: '2026-12-12T07:41:00Z',
      verdict: 'NEUTRAL',
      coverageState: 'Crawled - currently not indexed',
      robotsTxtState: 'ALLOWED',
      indexingState: 'INDEXING_ALLOWED',
      pageFetchState: 'SUCCESSFUL',
      lastCrawlTime: '2026-12-01T00:00:00Z',
      googleCanonical: null,
      userCanonical: null,
      crawledAs: 'MOBILE',
      error: null,
      problems: [{ code: 'not_indexed', label: 'Ikke indekseret: Crawled - currently not indexed' }],
    },
  ],
};

describe('SEO-rapporten', () => {
  const md = renderSeoReport({ generatedAt: new Date('2026-12-12T08:00:00Z'), setup, lastRun: null, overview, opportunities, indexing });

  it('har periode, KPI\'er med ændring og top 20', () => {
    expect(md).toContain('Periode: 2026-11-13 – 2026-12-10 (28 dage, endelige tal) mod 2026-10-16 – 2026-11-12.');
    expect(md).toContain('| Klik | 120 | 80 | +50 % |');
    expect(md).toContain('| søgeord 19 |');
    expect(md).not.toContain('| søgeord 20 |');
  });

  it('giver konkrete forslag med nuværende titel, links, kode og whitelist-linjer', () => {
    expect(md).toContain('- `/tilbud/smoer`: CTR 0,5 % (median 8 % for placering 1–3)');
    expect(md).toContain('  - Titel (57 tegn): "Smør på tilbud – billigste pr. kg i uge 50 | Tilbudsradar"');
    expect(md).toContain('  - Kode: backend/src/services/seo/pages.ts → getTermPage');
    expect(md).toContain('  - Linkes fra (2): /, /butikker · og fra footeren');
    expect(md).toContain(`  ['Rødkål', ['rødkål'], ['frugt-gront']], // "rødkål tilbud": 80 visninger · 5 tilbud i 3 kæder`);
    expect(md).toContain('- "smør" (300 visninger): `/tilbud/smoer` 200 vis.');
    expect(md).toContain('- `/tilbud/citroner`: Ikke indekseret: Crawled - currently not indexed');
    expect(md).toContain('100 af 123 sider i sitemapet er indekseret');
  });

  it('uden data: en kort besked i stedet for tomme tabeller', () => {
    const empty = renderSeoReport({
      generatedAt: new Date(),
      setup: { configured: false, reason: 'GSC_SITE_URL er ikke sat.', clientEmail: null, siteUrl: null },
      lastRun: null,
      overview: { ...overview, period: null, current: null, previous: null },
      opportunities: { ...opportunities, period: null },
      indexing,
    });
    expect(empty).toContain('Ingen Search Console-data endnu');
    expect(empty).toContain('Search Console er ikke sat op: GSC_SITE_URL er ikke sat.');
    expect(empty).not.toContain('## Muligheder');
  });

  it('peger på koden bag hver sidetype', () => {
    expect(codeHint('/butik/netto')).toMatch(/getStorePage/);
    expect(codeHint('/kategori/mejeri-aeg')).toMatch(/getCategoryPage/);
    expect(codeHint('/priser')).toBe('shared/src/seo.ts → PAGE_META');
  });
});
