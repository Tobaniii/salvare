// Read-only database integrity verification.
//
// Returns a structured result with check pass/fail flags and warning counts.
// Never includes coupon codes, result records, DB paths, headers, or env vars
// in the returned shape.

import type { Db } from "./db";
import { EXPECTED_SCHEMA_VERSION } from "./db";

export interface VerifyCheck {
  name: string;
  ok: boolean;
}

export interface VerifyWarning {
  name: string;
  count: number;
}

export interface VerifyResult {
  ok: boolean;
  schemaVersion: string | null;
  expectedSchemaVersion: string;
  checks: VerifyCheck[];
  warnings: VerifyWarning[];
}

const REQUIRED_TABLES = [
  "stores",
  "coupon_codes",
  "coupon_results",
  "coupon_sources",
  "coupon_code_sources",
  "source_cache",
  "source_fetch_log",
  "schema_meta",
] as const;

const REQUIRED_INDEXES = [
  "idx_coupon_results_store_code",
  "idx_coupon_results_tested_at",
  "idx_coupon_code_sources_store_code",
  "idx_coupon_code_sources_source",
  "idx_source_cache_expires_at",
  "idx_source_fetch_log_source_attempt",
  "idx_source_fetch_log_source_key_attempt",
] as const;

function listTables(db: Db): Set<string> {
  const rows = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table'")
    .all() as Array<{ name: string }>;
  return new Set(rows.map((r) => r.name));
}

function listIndexes(db: Db): Set<string> {
  const rows = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%'",
    )
    .all() as Array<{ name: string }>;
  return new Set(rows.map((r) => r.name));
}

function readSchemaVersion(db: Db, tables: Set<string>): string | null {
  if (!tables.has("schema_meta")) return null;
  const row = db
    .prepare("SELECT value FROM schema_meta WHERE key = 'version'")
    .get() as { value: string } | undefined;
  return row ? row.value : null;
}

function countOrCatch(db: Db, sql: string): number | null {
  try {
    const row = db.prepare(sql).get() as { c: number } | undefined;
    return row ? row.c : 0;
  } catch {
    return null;
  }
}

export function verifyDatabase(db: Db): VerifyResult {
  const checks: VerifyCheck[] = [];
  const warnings: VerifyWarning[] = [];

  const tables = listTables(db);
  const indexes = listIndexes(db);

  const tablesPresent = REQUIRED_TABLES.every((t) => tables.has(t));
  checks.push({ name: "tables_present", ok: tablesPresent });

  const schemaVersion = readSchemaVersion(db, tables);
  checks.push({
    name: "schema_version",
    ok: schemaVersion === EXPECTED_SCHEMA_VERSION,
  });

  let foreignKeysOk = false;
  try {
    const fkRows = db.prepare("PRAGMA foreign_key_check").all();
    foreignKeysOk = fkRows.length === 0;
  } catch {
    foreignKeysOk = false;
  }
  checks.push({ name: "foreign_keys", ok: foreignKeysOk });

  const indexesPresent = REQUIRED_INDEXES.every((i) => indexes.has(i));
  checks.push({ name: "indexes_present", ok: indexesPresent });

  const codeOrphans =
    tables.has("coupon_codes") && tables.has("stores")
      ? countOrCatch(
          db,
          `SELECT COUNT(*) AS c FROM coupon_codes c
             LEFT JOIN stores s ON s.id = c.store_id
             WHERE s.id IS NULL`,
        )
      : null;
  checks.push({
    name: "coupon_codes_orphans",
    ok: codeOrphans === 0,
  });

  const resultOrphans =
    tables.has("coupon_results") && tables.has("stores")
      ? countOrCatch(
          db,
          `SELECT COUNT(*) AS c FROM coupon_results r
             LEFT JOIN stores s ON s.id = r.store_id
             WHERE s.id IS NULL`,
        )
      : null;
  checks.push({
    name: "coupon_results_orphans",
    ok: resultOrphans === 0,
  });

  const codeSourceStoreOrphans =
    tables.has("coupon_code_sources") && tables.has("stores")
      ? countOrCatch(
          db,
          `SELECT COUNT(*) AS c FROM coupon_code_sources cs
             LEFT JOIN stores s ON s.id = cs.store_id
             WHERE s.id IS NULL`,
        )
      : null;
  checks.push({
    name: "coupon_code_sources_store_orphans",
    ok: codeSourceStoreOrphans === 0,
  });

  const codeSourceSourceOrphans =
    tables.has("coupon_code_sources") && tables.has("coupon_sources")
      ? countOrCatch(
          db,
          `SELECT COUNT(*) AS c FROM coupon_code_sources cs
             LEFT JOIN coupon_sources src ON src.id = cs.source_id
             WHERE src.id IS NULL`,
        )
      : null;
  checks.push({
    name: "coupon_code_sources_source_orphans",
    ok: codeSourceSourceOrphans === 0,
  });

  const sourceCacheOrphans =
    tables.has("source_cache") && tables.has("coupon_sources")
      ? countOrCatch(
          db,
          `SELECT COUNT(*) AS c FROM source_cache sc
             LEFT JOIN coupon_sources src ON src.id = sc.source_id
             WHERE src.id IS NULL`,
        )
      : null;
  checks.push({
    name: "source_cache_source_orphans",
    ok: sourceCacheOrphans === 0,
  });

  const sourceFetchLogOrphans =
    tables.has("source_fetch_log") && tables.has("coupon_sources")
      ? countOrCatch(
          db,
          `SELECT COUNT(*) AS c FROM source_fetch_log fl
             LEFT JOIN coupon_sources src ON src.id = fl.source_id
             WHERE src.id IS NULL`,
        )
      : null;
  checks.push({
    name: "source_fetch_log_source_orphans",
    ok: sourceFetchLogOrphans === 0,
  });

  if (tables.has("coupon_results")) {
    const dupRow = db
      .prepare(
        `SELECT COUNT(*) AS c FROM (
           SELECT store_id, code, tested_at, success, savings_cents, final_total_cents,
                  COUNT(*) AS n
             FROM coupon_results
             GROUP BY store_id, code, tested_at, success, savings_cents, final_total_cents
             HAVING n > 1
         )`,
      )
      .get() as { c: number } | undefined;
    const dupGroups = dupRow ? dupRow.c : 0;
    if (dupGroups > 0) {
      warnings.push({ name: "duplicate_coupon_results", count: dupGroups });
    }
  }

  const ok = checks.every((c) => c.ok);
  return {
    ok,
    schemaVersion,
    expectedSchemaVersion: EXPECTED_SCHEMA_VERSION,
    checks,
    warnings,
  };
}

export function formatVerifyReport(result: VerifyResult): string {
  const lines: string[] = [];
  lines.push(
    `schema version: ${result.schemaVersion ?? "(missing)"} (expected ${result.expectedSchemaVersion})`,
  );
  for (const c of result.checks) {
    lines.push(`  ${c.ok ? "PASS" : "FAIL"}  ${c.name}`);
  }
  lines.push(`warnings: ${result.warnings.length}`);
  for (const w of result.warnings) {
    lines.push(`  WARN  ${w.name} (${w.count})`);
  }
  lines.push(result.ok ? "result: OK" : "result: FAIL");
  return lines.join("\n");
}
