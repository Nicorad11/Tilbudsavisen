import type { GscIndexingDTO, GscOpportunitiesDTO, GscOverviewDTO, GscRunStatus, GscSetupStatus, GscTotals } from '@tilbudsradar/shared';
import { pathOf } from './opportunities';

/**
 * docs/seo-report.md – kompakt og handlingsorienteret, så en AI-agent kan læse
 * den og ændre koden ud fra den (se "Prompt B" i claude-code-search-console-prompt.md).
 */

export interface SeoReportInput {
  generatedAt: Date;
  setup: GscSetupStatus;
  lastRun: GscRunStatus | null;
  overview: GscOverviewDTO;
  opportunities: GscOpportunitiesDTO;
  indexing: GscIndexingDTO;
}

const TOP = 20;
const n = (v: number) => Math.round(v).toLocaleString('da-DK');
const pct = (v: number) => `${(v * 100).toLocaleString('da-DK', { maximumFractionDigits: 1 })} %`;
const pos = (v: number) => (v > 0 ? v.toLocaleString('da-DK', { maximumFractionDigits: 1 }) : '–');
const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
const change = (cur: number, prev: number) => (prev ? `${cur >= prev ? '+' : ''}${Math.round(((cur - prev) / prev) * 100)} %` : '–');

/** Hvor sidens titel og beskrivelse bygges i koden. */
export function codeHint(path: string): string {
  if (/^\/tilbud\/[^/]+$/.test(path)) return 'backend/src/services/seo/pages.ts → getTermPage (termTitle og description)';
  if (path === '/tilbud') return 'backend/src/services/seo/pages.ts → getTermHub';
  if (/^\/butik\/[^/]+$/.test(path)) return 'backend/src/services/seo/pages.ts → getStorePage';
  if (path === '/butikker') return 'backend/src/services/seo/pages.ts → getStoresHub';
  if (/^\/kategori\/[^/]+$/.test(path)) return 'backend/src/services/seo/pages.ts → getCategoryPage';
  if (path === '/ugens-bedste-tilbud') return 'backend/src/services/seo/pages.ts → getWeeklyBest';
  if (path === '/indsigt') return 'backend/src/services/seo/pages.ts → getInsights';
  if (path === '/metode') return 'backend/src/services/seo/pages.ts → getMethodPage';
  return 'shared/src/seo.ts → PAGE_META';
}

function kpiTable(cur: GscTotals, prev: GscTotals): string[] {
  return [
    '| | Nu | Før | Ændring |',
    '|---|---:|---:|---:|',
    `| Klik | ${n(cur.clicks)} | ${n(prev.clicks)} | ${change(cur.clicks, prev.clicks)} |`,
    `| Visninger | ${n(cur.impressions)} | ${n(prev.impressions)} | ${change(cur.impressions, prev.impressions)} |`,
    `| CTR | ${pct(cur.ctr)} | ${pct(prev.ctr)} | ${((cur.ctr - prev.ctr) * 100).toLocaleString('da-DK', { maximumFractionDigits: 1, signDisplay: 'exceptZero' })} pp |`,
    `| Gns. placering (lavere er bedre) | ${pos(cur.position)} | ${pos(prev.position)} | ${cur.position && prev.position ? (cur.position - prev.position).toLocaleString('da-DK', { maximumFractionDigits: 1, signDisplay: 'exceptZero' }) : '–'} |`,
  ];
}

export function renderSeoReport(i: SeoReportInput): string {
  const o = i.overview;
  const op = i.opportunities;
  const out: string[] = [];
  const day = i.generatedAt.toISOString().slice(0, 10);
  out.push(`# SEO-rapport – ${i.setup.siteUrl ?? 'tilbudsradaren.dk'}`, '');
  out.push(
    `Genereret ${day} · land: ${o.country === 'dnk' ? 'Danmark' : 'alle'} · data hentet: ${i.lastRun ? `${i.lastRun.finishedAt ?? i.lastRun.startedAt} (${i.lastRun.status})` : 'aldrig'}`,
  );
  if (i.lastRun?.error) out.push(`Seneste fejl ved hentning: ${i.lastRun.error}`);
  if (!i.setup.configured) out.push(`Search Console er ikke sat op: ${i.setup.reason}`);
  out.push('');

  if (!o.period || !o.current || !o.previous) {
    out.push('Ingen Search Console-data endnu. Sæt integrationen op (docs/SEARCH_CONSOLE.md), og kør rapporten igen, når der er data.', '');
    return out.join('\n');
  }

  out.push(`Periode: ${o.period.start} – ${o.period.end} (${o.days} dage, endelige tal) mod ${o.period.previousStart} – ${o.period.previousEnd}.`, '');
  out.push('## KPI\'er', '', ...kpiTable(o.current, o.previous), '');

  if (op.trend) {
    out.push('## Trend pr. sidetype', '', '| Sider | Klik (før) | Visninger (før) | CTR (før) | Placering (før) |', '|---|---:|---:|---:|---:|');
    for (const r of [op.trend.total, ...op.trend.byType]) {
      out.push(`| ${r.label} | ${n(r.current.clicks)} (${n(r.previous.clicks)}) | ${n(r.current.impressions)} (${n(r.previous.impressions)}) | ${pct(r.current.ctr)} (${pct(r.previous.ctr)}) | ${pos(r.current.position)} (${pos(r.previous.position)}) |`);
    }
    out.push('');
  }

  out.push(`## Top ${TOP} søgeord`, '', '| Søgeord | Side | Klik | Visninger | CTR | Placering |', '|---|---|---:|---:|---:|---:|');
  for (const q of o.topQueries.slice(0, TOP)) out.push(`| ${cell(q.query)} | ${q.page ? pathOf(q.page) : '–'} | ${n(q.clicks)} | ${n(q.impressions)} | ${pct(q.ctr)} | ${pos(q.position)} |`);
  if (!o.topQueries.length) out.push('| – | | | | | |');
  out.push('');

  out.push(`## Top ${TOP} sider`, '', '| Side | Klik | Visninger | CTR | Placering |', '|---|---:|---:|---:|---:|');
  for (const p of o.topPages.slice(0, TOP)) out.push(`| ${pathOf(p.page)} | ${n(p.clicks)} | ${n(p.impressions)} | ${pct(p.ctr)} | ${pos(p.position)} |`);
  if (!o.topPages.length) out.push('| – | | | | |');
  out.push('');

  const t = op.thresholds;
  out.push('## Muligheder', '');
  if (!op.snapshotAvailable) out.push('> Titler og interne links mangler: byg frontenden (`npm run build`), så rapporten kan læse de server-renderede sider.', '');

  out.push(`### 1. Lav klikrate (${op.lowCtr.length})`, '');
  out.push(`Placering ≤ 10, mindst ${t.MIN_IMPRESSIONS_CTR} visninger og CTR under ${Math.round(t.LOW_CTR_FACTOR * 100)} % af vores median for samme placering. Skriv titel og beskrivelse skarpere – data-drevet og ærligt (pris, kæde, ugenummer), titel under ca. 60 tegn, beskrivelse 140–160.`, '');
  for (const r of op.lowCtr) {
    const path = pathOf(r.page);
    out.push(`- ${r.kind === 'page' ? `\`${path}\`` : `"${r.key}" → \`${path || '–'}\``}: CTR ${pct(r.ctr)} (median ${pct(r.medianCtr)} for placering ${r.bucket}), placering ${pos(r.position)}, ${n(r.impressions)} visninger`);
    if (r.title) out.push(`  - Titel (${r.title.length} tegn): "${r.title}"`);
    if (r.description) out.push(`  - Beskrivelse (${r.description.length} tegn): "${r.description}"`);
    if (path) out.push(`  - Kode: ${codeHint(path)}`);
  }
  if (!op.lowCtr.length) out.push('Ingen – eller for lidt data til at sammenligne.');
  out.push('');

  out.push(`### 2. Tæt på side 1 (${op.nearPageOne.length})`, '');
  out.push(`Placering ${t.NEAR_MIN_POSITION}–${t.NEAR_MAX_POSITION} med mindst ${t.MIN_IMPRESSIONS_NEAR} visninger. Styrk siden med mere nyttigt, data-baseret indhold og flere interne links fra relevante sider.`, '');
  for (const r of op.nearPageOne) {
    const path = pathOf(r.page);
    out.push(`- \`${path}\`: placering ${pos(r.position)}, ${n(r.impressions)} visninger, ${n(r.clicks)} klik · søgeord: ${r.topQueries.map((q) => `"${q}"`).join(', ') || '–'}`);
    out.push(`  - Linkes fra (${r.linkedFrom.length}): ${r.linkedFrom.slice(0, 10).join(', ') || 'ingen sider i indholdet'}${r.linkedFrom.length > 10 ? ' …' : ''}${r.inFooter ? ' · og fra footeren' : ''}`);
    out.push(`  - Kode: ${codeHint(path)}`);
  }
  if (!op.nearPageOne.length) out.push('Ingen.');
  out.push('');

  out.push(`### 3. Manglende sider (${op.missingPages.length})`, '');
  if (op.missingPages.length) {
    out.push('Søgeord om varer, vi har tilbud på, men ingen side for. Tilføj til `RAW` i `shared/src/seoTerms.ts` – tjek kategori, søgeord og `exclude`, og at varen opfylder indekseringsgrænserne:', '', '```ts');
    for (const r of op.missingPages) out.push(`  ${r.line} // "${r.query}": ${n(r.impressions)} visninger · ${r.offers} tilbud i ${r.stores} kæder`);
    out.push('```');
  } else out.push('Ingen.');
  out.push('');

  out.push(`### 4. Kannibalisering (${op.cannibalization.length})`, '');
  for (const r of op.cannibalization) {
    out.push(`- "${r.query}" (${n(r.impressions)} visninger): ${r.pages.map((p) => `\`${pathOf(p.page)}\` ${n(p.impressions)} vis., placering ${pos(p.position)}`).join(' · ')} → vælg én primær side, og justér titler og interne links.`);
  }
  if (!op.cannibalization.length) out.push('Ingen.');
  out.push('');

  out.push(`### 5. Døde sider (${op.deadPages.length})`, '');
  for (const r of op.deadPages) out.push(`- \`${r.path}\`: ${r.detail}`);
  if (!op.deadPages.length) out.push('Ingen.');
  out.push('');

  const ix = i.indexing;
  const problems = ix.rows.filter((r) => r.problems.length);
  out.push('## Indekseringsproblemer', '');
  out.push(`${ix.counts.indexed} af ${ix.counts.inSitemap} sider i sitemapet er indekseret · ${ix.counts.inspected} inspiceret · ${problems.length} med problemer.`, '');
  for (const r of problems) out.push(`- \`${r.path}\`: ${r.problems.map((p) => p.label).join(' · ')}`);
  if (!problems.length) out.push('Ingen fundet.');
  out.push('', `Tærskler: backend/src/services/seo/opportunities.ts. Data: admin → SEO.`, '');
  return out.join('\n');
}
