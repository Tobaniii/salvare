import { describe, it, expect } from "vitest";
import { EXPECTED_SCHEMA_VERSION, openDatabase, type Db } from "./db";
import { formatVerifyReport, verifyDatabase } from "./db-verify";

function makeDb(): Db {
  return openDatabase(":memory:");
}

function insertStore(db: Db, domain: string): number {
  db.prepare(
    "INSERT INTO stores (domain, created_at, updated_at) VALUES (?, '', '')",
  ).run(domain);
  return (
    db.prepare("SELECT id FROM stores WHERE domain = ?").get(domain) as {
      id: number;
    }
  ).id;
}

function insertResult(
  db: Db,
  storeId: number,
  code: string,
  testedAt: string,
): void {
  db.prepare(
    "INSERT INTO coupon_results (store_id, code, success, savings_cents, final_total_cents, tested_at) VALUES (?, ?, 1, 100, 900, ?)",
  ).run(storeId, code, testedAt);
}

describe("verifyDatabase", () => {
  it("passes on a fresh initialized DB", () => {
    const db = makeDb();
    const result = verifyDatabase(db);
    expect(result.ok).toBe(true);
    expect(result.schemaVersion).toBe(EXPECTED_SCHEMA_VERSION);
    expect(result.warnings).toHaveLength(0);
    for (const c of result.checks) {
      expect(c.ok).toBe(true);
    }
  });

  it("reports a missing required table as a failed check", () => {
    const db = makeDb();
    db.exec("DROP TABLE coupon_codes");
    const result = verifyDatabase(db);
    expect(result.ok).toBe(false);
    const tablesCheck = result.checks.find((c) => c.name === "tables_present");
    expect(tablesCheck?.ok).toBe(false);
  });

  it("reports a wrong schema version as a failed check", () => {
    const db = makeDb();
    db.prepare(
      "UPDATE schema_meta SET value = '999' WHERE key = 'version'",
    ).run();
    const result = verifyDatabase(db);
    expect(result.ok).toBe(false);
    const versionCheck = result.checks.find((c) => c.name === "schema_version");
    expect(versionCheck?.ok).toBe(false);
    expect(result.schemaVersion).toBe("999");
  });

  it("reports a missing schema version as a failed check", () => {
    const db = makeDb();
    db.prepare("DELETE FROM schema_meta WHERE key = 'version'").run();
    const result = verifyDatabase(db);
    expect(result.ok).toBe(false);
    expect(result.schemaVersion).toBeNull();
  });

  it("reports a missing index as a failed check", () => {
    const db = makeDb();
    db.exec("DROP INDEX idx_coupon_results_tested_at");
    const result = verifyDatabase(db);
    expect(result.ok).toBe(false);
    const idxCheck = result.checks.find((c) => c.name === "indexes_present");
    expect(idxCheck?.ok).toBe(false);
  });

  it("reports duplicate result rows as warnings, not failures", () => {
    const db = makeDb();
    const storeId = insertStore(db, "shop.test");
    const ts = "2026-05-04T00:00:00.000Z";
    insertResult(db, storeId, "SAVE10", ts);
    insertResult(db, storeId, "SAVE10", ts);
    const result = verifyDatabase(db);
    expect(result.ok).toBe(true);
    const dup = result.warnings.find(
      (w) => w.name === "duplicate_coupon_results",
    );
    expect(dup?.count).toBe(1);
  });

  it("does not include codes, records, paths, env, or header values in result", () => {
    const db = makeDb();
    const storeId = insertStore(db, "leaktest.example");
    insertResult(db, storeId, "SECRETCODE", "2026-05-04T00:00:00.000Z");
    const result = verifyDatabase(db);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("SECRETCODE");
    expect(serialized).not.toContain("leaktest.example");
    expect(serialized).not.toContain("SALVARE_");
    expect(serialized).not.toContain("Authorization");
    expect(serialized).not.toContain("/");
  });

  it("reports a missing coupon_sources table as a failed check", () => {
    const db = makeDb();
    db.exec("DROP TABLE coupon_code_sources");
    db.exec("DROP TABLE coupon_sources");
    const result = verifyDatabase(db);
    expect(result.ok).toBe(false);
    const tablesCheck = result.checks.find((c) => c.name === "tables_present");
    expect(tablesCheck?.ok).toBe(false);
  });

  it("reports a missing coupon_code_sources index as a failed check", () => {
    const db = makeDb();
    db.exec("DROP INDEX idx_coupon_code_sources_source");
    const result = verifyDatabase(db);
    expect(result.ok).toBe(false);
    const idxCheck = result.checks.find((c) => c.name === "indexes_present");
    expect(idxCheck?.ok).toBe(false);
  });

  it("fails when a coupon_code_sources row references a missing store", () => {
    const db = makeDb();
    const storeId = insertStore(db, "shop.test");
    db.prepare(
      `INSERT INTO coupon_code_sources
         (store_id, code, source_id, discovered_at)
         VALUES (?, ?, 'seed', ?)`,
    ).run(storeId, "WELCOME10", "2026-05-04T00:00:00.000Z");
    db.pragma("foreign_keys = OFF");
    db.prepare("DELETE FROM stores WHERE id = ?").run(storeId);
    db.pragma("foreign_keys = ON");
    const result = verifyDatabase(db);
    const orphanCheck = result.checks.find(
      (c) => c.name === "coupon_code_sources_store_orphans",
    );
    expect(orphanCheck?.ok).toBe(false);
    expect(result.ok).toBe(false);
  });

  it("fails when a coupon_code_sources row references a missing source", () => {
    const db = makeDb();
    const storeId = insertStore(db, "shop.test");
    db.pragma("foreign_keys = OFF");
    db.prepare(
      `INSERT INTO coupon_code_sources
         (store_id, code, source_id, discovered_at)
         VALUES (?, ?, 'no-such-source', ?)`,
    ).run(storeId, "WELCOME10", "2026-05-04T00:00:00.000Z");
    db.pragma("foreign_keys = ON");
    const result = verifyDatabase(db);
    const orphanCheck = result.checks.find(
      (c) => c.name === "coupon_code_sources_source_orphans",
    );
    expect(orphanCheck?.ok).toBe(false);
    expect(result.ok).toBe(false);
  });

  it("passes when some coupon_codes have no matching coupon_code_sources rows (backward compat with v0.27 DBs)", () => {
    const db = makeDb();
    const storeId = insertStore(db, "shop.test");
    db.prepare(
      "INSERT INTO coupon_codes (store_id, code, created_at, updated_at) VALUES (?, ?, '', '')",
    ).run(storeId, "NO-PROVENANCE");
    const result = verifyDatabase(db);
    expect(result.ok).toBe(true);
  });

  it("reports a missing source_cache table as a failed check", () => {
    const db = makeDb();
    db.exec("DROP TABLE source_cache");
    const result = verifyDatabase(db);
    expect(result.ok).toBe(false);
    const tablesCheck = result.checks.find((c) => c.name === "tables_present");
    expect(tablesCheck?.ok).toBe(false);
  });

  it("reports a missing source_fetch_log table as a failed check", () => {
    const db = makeDb();
    db.exec("DROP TABLE source_fetch_log");
    const result = verifyDatabase(db);
    expect(result.ok).toBe(false);
    const tablesCheck = result.checks.find((c) => c.name === "tables_present");
    expect(tablesCheck?.ok).toBe(false);
  });

  it("reports a missing source cache/log index as a failed check", () => {
    const db = makeDb();
    db.exec("DROP INDEX idx_source_cache_expires_at");
    const result = verifyDatabase(db);
    expect(result.ok).toBe(false);
    const idxCheck = result.checks.find((c) => c.name === "indexes_present");
    expect(idxCheck?.ok).toBe(false);
  });

  it("fails when a source_cache row references a missing source", () => {
    const db = makeDb();
    db.pragma("foreign_keys = OFF");
    db.prepare(
      `INSERT INTO source_cache
         (source_id, cache_key, fetched_at, expires_at, status)
         VALUES (?, ?, ?, ?, ?)`,
    ).run(
      "no-such-source",
      "k",
      "2026-05-09T00:00:00.000Z",
      "2026-05-09T01:00:00.000Z",
      "ok",
    );
    db.pragma("foreign_keys = ON");
    const result = verifyDatabase(db);
    const orphanCheck = result.checks.find(
      (c) => c.name === "source_cache_source_orphans",
    );
    expect(orphanCheck?.ok).toBe(false);
    expect(result.ok).toBe(false);
  });

  it("fails when a source_fetch_log row references a missing source", () => {
    const db = makeDb();
    db.pragma("foreign_keys = OFF");
    db.prepare(
      `INSERT INTO source_fetch_log
         (source_id, cache_key, attempted_at, outcome)
         VALUES (?, ?, ?, ?)`,
    ).run("no-such-source", "k", "2026-05-09T00:00:00.000Z", "ok");
    db.pragma("foreign_keys = ON");
    const result = verifyDatabase(db);
    const orphanCheck = result.checks.find(
      (c) => c.name === "source_fetch_log_source_orphans",
    );
    expect(orphanCheck?.ok).toBe(false);
    expect(result.ok).toBe(false);
  });

  it("passes when source_cache contains expired-but-valid rows", () => {
    const db = makeDb();
    db.prepare(
      `INSERT INTO source_cache
         (source_id, cache_key, fetched_at, expires_at, status)
         VALUES (?, ?, ?, ?, ?)`,
    ).run(
      "seed",
      "k",
      "2026-05-09T00:00:00.000Z",
      "2026-05-09T00:00:00.001Z",
      "ok",
    );
    const result = verifyDatabase(db);
    expect(result.ok).toBe(true);
  });

  it("formatVerifyReport output does not leak codes, paths, env, or headers", () => {
    const db = makeDb();
    const storeId = insertStore(db, "leakrender.example");
    insertResult(db, storeId, "TOPSECRETCODE", "2026-05-04T00:00:00.000Z");
    const report = formatVerifyReport(verifyDatabase(db));
    expect(report).not.toContain("TOPSECRETCODE");
    expect(report).not.toContain("leakrender.example");
    expect(report).not.toContain("SALVARE_");
    expect(report).not.toContain("Authorization");
    expect(report).toContain("schema version:");
  });

  // ----- v0.46.0 import_history -----

  it("expects schema version 5 on a fresh DB", () => {
    const db = makeDb();
    const result = verifyDatabase(db);
    expect(result.schemaVersion).toBe("5");
    expect(EXPECTED_SCHEMA_VERSION).toBe("5");
    expect(result.ok).toBe(true);
  });

  it("includes import_history in tables_present and its indexes in indexes_present", () => {
    const db = makeDb();
    const result = verifyDatabase(db);
    expect(result.ok).toBe(true);
    db.exec("DROP TABLE import_history");
    const dropped = verifyDatabase(db);
    expect(dropped.ok).toBe(false);
    expect(
      dropped.checks.find((c) => c.name === "tables_present")?.ok,
    ).toBe(false);
  });

  it("reports a missing import_history index as a failed check", () => {
    const db = makeDb();
    db.exec("DROP INDEX idx_import_history_provider_attempt");
    const result = verifyDatabase(db);
    expect(result.ok).toBe(false);
    expect(
      result.checks.find((c) => c.name === "indexes_present")?.ok,
    ).toBe(false);

    const db2 = makeDb();
    db2.exec("DROP INDEX idx_import_history_source");
    const result2 = verifyDatabase(db2);
    expect(result2.ok).toBe(false);
    expect(
      result2.checks.find((c) => c.name === "indexes_present")?.ok,
    ).toBe(false);
  });

  it("orphan check: a NULL source_id row is allowed (not flagged)", () => {
    const db = makeDb();
    db.prepare(
      `INSERT INTO import_history
         (provider_id, source_id, domain, attempted_at, outcome,
          candidates_accepted, codes_imported, provenance_recorded,
          rejected_count, error_code, duration_ms)
         VALUES ('awin', NULL, 'shop.example', '2026-05-16T00:00:00.000Z',
                 'error', 0, 0, 0, 0, 'disabled', 5)`,
    ).run();
    const result = verifyDatabase(db);
    const orphan = result.checks.find(
      (c) => c.name === "import_history_source_orphans",
    );
    expect(orphan?.ok).toBe(true);
    expect(result.ok).toBe(true);
  });

  it("orphan check: a NON-NULL source_id with no matching coupon_sources row fails", () => {
    const db = makeDb();
    db.pragma("foreign_keys = OFF");
    db.prepare(
      `INSERT INTO import_history
         (provider_id, source_id, domain, attempted_at, outcome,
          candidates_accepted, codes_imported, provenance_recorded,
          rejected_count, error_code, duration_ms)
         VALUES ('awin', 'no-such-source', 'shop.example',
                 '2026-05-16T00:00:00.000Z', 'ok', 1, 1, 1, 0, NULL, 7)`,
    ).run();
    db.pragma("foreign_keys = ON");
    const result = verifyDatabase(db);
    const orphan = result.checks.find(
      (c) => c.name === "import_history_source_orphans",
    );
    expect(orphan?.ok).toBe(false);
    expect(result.ok).toBe(false);
  });

  it("a synthesized v4-shaped DB (no import_history, schema_meta='4') fails verify", () => {
    const db = makeDb();
    db.exec("DROP TABLE import_history");
    db.prepare(
      "UPDATE schema_meta SET value = '4' WHERE key = 'version'",
    ).run();
    const result = verifyDatabase(db);
    expect(result.ok).toBe(false);
    expect(result.schemaVersion).toBe("4");
    expect(
      result.checks.find((c) => c.name === "schema_version")?.ok,
    ).toBe(false);
    expect(
      result.checks.find((c) => c.name === "tables_present")?.ok,
    ).toBe(false);
  });
});
