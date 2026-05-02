import Database from "better-sqlite3";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type Db = Database.Database;

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
`;

export function initSchema(db: Db): void {
  db.exec(SCHEMA_SQL);
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
