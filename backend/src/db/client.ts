import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { sql, type SQL } from 'drizzle-orm';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import { migrate as migratePg } from 'drizzle-orm/node-postgres/migrator';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import pg from 'pg';
import * as schema from './schema';

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export interface Database {
  db: Db;
  kind: 'pglite' | 'postgres';
  migrate(): Promise<void>;
  close(): Promise<void>;
}

const MIGRATIONS_DIR = process.env.MIGRATIONS_DIR ?? path.resolve(import.meta.dirname, 'migrations');

// node-postgres: DATE som streng (ikke lokal midnat) og BIGINT som tal.
pg.types.setTypeParser(1082, (v) => v);
pg.types.setTypeParser(20, (v) => Number(v));

/**
 * Uden DATABASE_URL bruges PGlite – en rigtig Postgres (WASM) der kører i
 * processen og gemmer data på disk. Samme SQL, samme migrationer, så
 * produktionen kan køre på Supabase/Neon/Render uden kodeændringer.
 */
export async function createDatabase(opts: { url: string | null; dataDir: string }): Promise<Database> {
  if (opts.url) {
    const pool = new pg.Pool({ connectionString: opts.url, max: 10 });
    const db = drizzlePg(pool, { schema }) as unknown as Db;
    return {
      db,
      kind: 'postgres',
      migrate: () => migratePg(db as never, { migrationsFolder: MIGRATIONS_DIR }),
      close: () => pool.end(),
    };
  }

  const inMemory = opts.dataDir === 'memory://';
  if (!inMemory) mkdirSync(opts.dataDir, { recursive: true });
  const client = new PGlite({ dataDir: inMemory ? undefined : opts.dataDir, extensions: { pg_trgm } });
  await client.waitReady;
  const db = drizzlePglite(client, { schema }) as unknown as Db;
  return {
    db,
    kind: 'pglite',
    migrate: () => migratePglite(db as never, { migrationsFolder: MIGRATIONS_DIR }),
    close: () => client.close(),
  };
}

/** Rækker fra `db.execute()` – begge drivere returnerer `{ rows }`. */
export async function query<T>(db: Db, statement: SQL): Promise<T[]> {
  const result = (await db.execute(statement)) as unknown as { rows?: T[] };
  return result.rows ?? [];
}

export async function queryOne<T>(db: Db, statement: SQL): Promise<T | undefined> {
  return (await query<T>(db, statement))[0];
}

let searchConfigCache: 'danish' | 'simple' | null = null;

/** Hvilken tekstsøgningskonfiguration migrationen valgte. */
export async function searchConfig(db: Db): Promise<'danish' | 'simple'> {
  if (searchConfigCache) return searchConfigCache;
  const row = await queryOne<{ value: string }>(db, sql`SELECT value FROM app_settings WHERE key = 'search_config'`);
  searchConfigCache = row?.value === 'danish' ? 'danish' : 'simple';
  return searchConfigCache;
}
