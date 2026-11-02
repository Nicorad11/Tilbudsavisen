/**
 * Google Search Console i admin-appen: søgedata, muligheder, indeksering og
 * sitemaps (backend/src/services/searchConsole og services/seo/opportunities.ts).
 */

export type GscCountry = 'all' | 'dnk';
export type GscDevice = 'all' | 'DESKTOP' | 'MOBILE' | 'TABLET';
export type GscPageType = 'forside' | 'vare' | 'kæde' | 'kategori' | 'øvrige';

export interface GscTotals {
  clicks: number;
  impressions: number;
  /** 0–1 */
  ctr: number;
  /** Gennemsnitlig placering vægtet med visninger (0 = ingen visninger). */
  position: number;
}

export interface GscSetupStatus {
  configured: boolean;
  /** Hvorfor integrationen er slået fra – aldrig nøglen. */
  reason: string | null;
  /** Service-accountens e-mail: den skal have adgang i Search Console. */
  clientEmail: string | null;
  siteUrl: string | null;
}

export interface GscRunStatus {
  startedAt: string;
  finishedAt: string | null;
  trigger: string;
  status: 'running' | 'success' | 'partial' | 'failed';
  rows: number;
  inspected: number;
  error: string | null;
}

/* ---------------- Muligheder (4.1–4.6) ---------------- */

export interface GscLowCtrItem {
  kind: 'page' | 'query';
  /** Siden eller søgeordet. */
  key: string;
  /** Siden (for et søgeord: den side, der fik flest visninger). */
  page: string;
  impressions: number;
  clicks: number;
  ctr: number;
  position: number;
  /** Vores egen median-CTR for samme placeringsinterval. */
  medianCtr: number;
  bucket: string;
  title: string | null;
  description: string | null;
}

export interface GscNearPageOneItem {
  page: string;
  impressions: number;
  clicks: number;
  position: number;
  topQueries: string[];
  /** Sider, der linker hertil fra indholdet (ikke header og footer). */
  linkedFrom: string[];
  /** Linket fra footeren på alle sider. */
  inFooter: boolean;
}

export interface GscMissingPageItem {
  query: string;
  impressions: number;
  clicks: number;
  /** Varebegrebet fra vores tilbud, fx "rødkål". */
  label: string;
  category: string;
  offers: number;
  stores: number;
  /** Klar til at kopiere ind i shared/src/seoTerms.ts. */
  line: string;
}

export interface GscCannibalItem {
  query: string;
  impressions: number;
  pages: { page: string; impressions: number; clicks: number; position: number }[];
}

export interface GscDeadPageItem {
  path: string;
  reason: 'no_impressions' | 'not_indexed';
  detail: string;
}

export interface GscTrendRow {
  label: string;
  current: GscTotals;
  previous: GscTotals;
}

export interface GscOpportunitiesDTO {
  generatedAt: string;
  country: GscCountry;
  /** null = ingen data endnu. */
  period: { start: string; end: string; previousStart: string; previousEnd: string } | null;
  lowCtr: GscLowCtrItem[];
  nearPageOne: GscNearPageOneItem[];
  missingPages: GscMissingPageItem[];
  cannibalization: GscCannibalItem[];
  deadPages: GscDeadPageItem[];
  trend: { total: GscTrendRow; byType: GscTrendRow[] } | null;
  /** Titler, beskrivelser og interne links kræver server-renderingen. */
  snapshotAvailable: boolean;
  thresholds: Record<string, number>;
}
