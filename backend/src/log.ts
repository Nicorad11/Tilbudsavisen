import { createLogger, type Logger, type LogLevel } from '@tilbudsradar/scrapers';

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/**
 * Logger til API'et. I produktion skrives én JSON-linje pr. hændelse, så
 * Render/Sentry kan filtrere på felterne. Der logges aldrig e-mails, tokens
 * eller kvitteringsindhold – kun id'er og tællere.
 */
export function createAppLogger(scope: string, opts: { json: boolean; level: LogLevel }): Logger {
  if (!opts.json) return createLogger(scope, opts.level);
  const write = (level: LogLevel, msg: string, meta?: Record<string, unknown>) => {
    if (ORDER[level] < ORDER[opts.level]) return;
    const line = JSON.stringify({
      time: new Date().toISOString(),
      level,
      scope,
      msg,
      ...Object.fromEntries(Object.entries(meta ?? {}).map(([k, v]) => [k, v instanceof Error ? v.message : v])),
    });
    if (level === 'error') console.error(line);
    else if (level === 'warn') console.warn(line);
    else console.log(line);
  };
  return {
    debug: (m, meta) => write('debug', m, meta),
    info: (m, meta) => write('info', m, meta),
    warn: (m, meta) => write('warn', m, meta),
    error: (m, meta) => write('error', m, meta),
    child: (child) => createAppLogger(`${scope}:${child}`, opts),
  };
}
