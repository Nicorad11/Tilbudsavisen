-- Søgning: Postgres fuldtekst (dansk stemming) + pg_trgm til stavefejl og
-- sammensatte ord. Holdt i en separat migration, så søgelaget senere kan
-- erstattes af Meilisearch/Elasticsearch uden at røre kerne-tabellerne.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS app_settings (
  key text PRIMARY KEY,
  value text NOT NULL
);
--> statement-breakpoint
DO $$
DECLARE
  cfg text := CASE WHEN EXISTS (SELECT 1 FROM pg_ts_config WHERE cfgname = 'danish') THEN 'danish' ELSE 'simple' END;
BEGIN
  EXECUTE format(
    $f$ALTER TABLE offers ADD COLUMN IF NOT EXISTS search_vector tsvector GENERATED ALWAYS AS (
      setweight(to_tsvector(%1$L::regconfig, coalesce(title, '')), 'A') ||
      setweight(to_tsvector(%1$L::regconfig, coalesce(brand, '')), 'B') ||
      setweight(to_tsvector(%1$L::regconfig, coalesce(description, '')), 'C')
    ) STORED$f$,
    cfg
  );
  INSERT INTO app_settings (key, value) VALUES ('search_config', cfg)
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS offers_search_idx ON offers USING gin (search_vector);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS offers_title_trgm_idx ON offers USING gin (title gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS offers_norm_trgm_idx ON offers USING gin (normalized_name gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS products_norm_trgm_idx ON products USING gin (normalized_name gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS products_name_trgm_idx ON products USING gin (name gin_trgm_ops);
