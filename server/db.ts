import Database from "better-sqlite3";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type Db = Database.Database;

export const EXPECTED_SCHEMA_VERSION = "4";

export const COUPON_SOURCE_TYPES = [
  "manual",
  "seed",
  "import",
  "api",
  "feed",
  "html_adapter",
] as const;

export type CouponSourceType = (typeof COUPON_SOURCE_TYPES)[number];

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS stores (
    id INTEGER PRIMARY KEY,
    domain TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS coupon_codes (
    id INTEGER PRIMARY KEY,
    store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    code TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(store_id, code)
  );

  CREATE TABLE IF NOT EXISTS coupon_results (
    id INTEGER PRIMARY KEY,
    store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    code TEXT NOT NULL,
    success INTEGER NOT NULL,
    savings_cents INTEGER NOT NULL,
    final_total_cents INTEGER NOT NULL,
    tested_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_coupon_results_store_code
    ON coupon_results(store_id, code);

  CREATE INDEX IF NOT EXISTS idx_coupon_results_tested_at
    ON coupon_results(tested_at);

  CREATE TABLE IF NOT EXISTS coupon_sources (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('manual','seed','import','api','feed','html_adapter')),
    enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS coupon_code_sources (
    id INTEGER PRIMARY KEY,
    store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    code TEXT NOT NULL,
    source_id TEXT NOT NULL REFERENCES coupon_sources(id) ON DELETE RESTRICT,
    discovered_at TEXT NOT NULL,
    label TEXT,
    expires_at TEXT,
    source_url TEXT,
    confidence INTEGER CHECK (confidence IS NULL OR (confidence BETWEEN 0 AND 100)),
    UNIQUE(store_id, code, source_id)
  );

  CREATE INDEX IF NOT EXISTS idx_coupon_code_sources_store_code
    ON coupon_code_sources(store_id, code);

  CREATE INDEX IF NOT EXISTS idx_coupon_code_sources_source
    ON coupon_code_sources(source_id);

  CREATE TABLE IF NOT EXISTS source_cache (
    source_id TEXT NOT NULL REFERENCES coupon_sources(id) ON DELETE RESTRICT,
    cache_key TEXT NOT NULL,
    fetched_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('ok','empty','error')),
    body_sha256 TEXT,
    metadata_json TEXT,
    candidates_json TEXT,
    PRIMARY KEY (source_id, cache_key)
  );

  CREATE INDEX IF NOT EXISTS idx_source_cache_expires_at
    ON source_cache(expires_at);

  CREATE TABLE IF NOT EXISTS source_fetch_log (
    id INTEGER PRIMARY KEY,
    source_id TEXT NOT NULL REFERENCES coupon_sources(id) ON DELETE RESTRICT,
    cache_key TEXT NOT NULL,
    attempted_at TEXT NOT NULL,
    outcome TEXT NOT NULL CHECK (outcome IN ('ok','empty','error','rate_limited','cache_hit')),
    status_code INTEGER,
    error_code TEXT,
    duration_ms INTEGER
  );

  CREATE INDEX IF NOT EXISTS idx_source_fetch_log_source_attempt
    ON source_fetch_log(source_id, attempted_at);

  CREATE INDEX IF NOT EXISTS idx_source_fetch_log_source_key_attempt
    ON source_fetch_log(source_id, cache_key, attempted_at);

  CREATE TABLE IF NOT EXISTS schema_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`;

interface DefaultSource {
  id: string;
  name: string;
  type: CouponSourceType;
}

const DEFAULT_SOURCES: readonly DefaultSource[] = [
  { id: "seed", name: "Bootstrap seed", type: "seed" },
  { id: "admin", name: "Admin UI", type: "manual" },
  { id: "import", name: "JSON import", type: "import" },
];

function ensureSourceCacheCandidatesColumn(db: Db): void {
  // v0.33.0 in-place upgrade for v0.29-vintage source_cache rows that lack
  // the `candidates_json` column. SQLite has no `ADD COLUMN IF NOT EXISTS`,
  // so introspect via PRAGMA and only ALTER when missing. Idempotent.
  const cols = db.prepare(`PRAGMA table_info(source_cache)`).all() as Array<{
    name: string;
  }>;
  const hasCol = cols.some((c) => c.name === "candidates_json");
  if (!hasCol) {
    db.exec(`ALTER TABLE source_cache ADD COLUMN candidates_json TEXT`);
  }
}

export function initSchema(db: Db): void {
  db.exec(SCHEMA_SQL);
  ensureSourceCacheCandidatesColumn(db);
  db.prepare(
    `INSERT INTO schema_meta (key, value) VALUES ('version', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(EXPECTED_SCHEMA_VERSION);

  const now = new Date().toISOString();
  const insertDefaultSource = db.prepare(
    `INSERT OR IGNORE INTO coupon_sources
       (id, name, type, enabled, created_at, updated_at)
       VALUES (?, ?, ?, 1, ?, ?)`,
  );
  for (const src of DEFAULT_SOURCES) {
    insertDefaultSource.run(src.id, src.name, src.type, now, now);
  }
}

export function openDatabase(path: string): Db {
  const db = new Database(path);
  db.pragma("foreign_keys = ON");
  initSchema(db);
  return db;
}

export function defaultDatabasePath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "salvare.db");
}
