import { cpSync } from 'node:fs';
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/server.ts', 'src/scripts/migrate.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node20',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  // Workspace-pakkerne er TypeScript-kilde og bundtes ind; alle andre pakker
  // (også scrapernes cheerio/nodemailer) hentes fra node_modules ved runtime.
  noExternal: [/^@tilbudsradar\//],
  external: [/^(?!@tilbudsradar\/)[^./]/],
  // Migrationerne læses fra disk ved opstart (dist/migrations).
  onSuccess: async () => {
    cpSync('src/db/migrations', 'dist/migrations', { recursive: true });
  },
});
