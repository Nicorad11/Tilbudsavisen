/**
 * Minimal robots.txt-parser efter RFC 9309:
 *  - den mest specifikke user-agent-gruppe vælges (ellers "*")
 *  - længste matchende regel vinder, ved lighed vinder Allow
 *  - understøtter "*" og "$" i stier samt Crawl-delay
 */
export interface RobotsRule {
  allow: boolean;
  path: string;
}

export interface RobotsGroup {
  agents: string[];
  rules: RobotsRule[];
  crawlDelay: number | null;
}

export interface RobotsTxt {
  groups: RobotsGroup[];
  sitemaps: string[];
}

export function parseRobotsTxt(text: string): RobotsTxt {
  const groups: RobotsGroup[] = [];
  const sitemaps: string[] = [];
  let current: RobotsGroup | null = null;
  let lastWasAgent = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();

    if (key === 'user-agent') {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [], crawlDelay: null };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (key === 'sitemap') {
      sitemaps.push(value);
      continue;
    }
    if (!current) continue;
    if (key === 'allow' || key === 'disallow') {
      // "Disallow:" uden sti betyder "alt er tilladt" og ignoreres.
      if (value === '') continue;
      current.rules.push({ allow: key === 'allow', path: value });
    } else if (key === 'crawl-delay') {
      const n = Number(value);
      if (Number.isFinite(n)) current.crawlDelay = n;
    }
  }
  return { groups, sitemaps };
}

function productToken(userAgent: string): string {
  return (userAgent.split('/')[0] ?? userAgent).trim().toLowerCase();
}

function selectGroups(robots: RobotsTxt, userAgent: string): RobotsGroup[] {
  const token = productToken(userAgent);
  const specific = robots.groups.filter((g) => g.agents.some((a) => a !== '*' && token.includes(a)));
  if (specific.length) return specific;
  return robots.groups.filter((g) => g.agents.includes('*'));
}

function patternToRegex(pattern: string): RegExp {
  const anchored = pattern.endsWith('$');
  const body = (anchored ? pattern.slice(0, -1) : pattern)
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${body}${anchored ? '$' : ''}`);
}

export function isAllowedByRobots(robots: RobotsTxt, userAgent: string, pathWithQuery: string): boolean {
  const groups = selectGroups(robots, userAgent);
  let best: RobotsRule | null = null;
  for (const group of groups) {
    for (const rule of group.rules) {
      if (!patternToRegex(rule.path).test(pathWithQuery)) continue;
      if (
        !best ||
        rule.path.length > best.path.length ||
        (rule.path.length === best.path.length && rule.allow && !best.allow)
      ) {
        best = rule;
      }
    }
  }
  return best ? best.allow : true;
}

export function crawlDelayFor(robots: RobotsTxt, userAgent: string): number | null {
  for (const g of selectGroups(robots, userAgent)) {
    if (g.crawlDelay !== null) return g.crawlDelay;
  }
  return null;
}

/** robots.txt der tillader alt (bruges ved 4xx). */
export const ALLOW_ALL: RobotsTxt = { groups: [], sitemaps: [] };
/** robots.txt der forbyder alt (bruges når filen ikke kan hentes pga. 5xx/netværk). */
export const DISALLOW_ALL: RobotsTxt = {
  groups: [{ agents: ['*'], rules: [{ allow: false, path: '/' }], crawlDelay: null }],
  sitemaps: [],
};
