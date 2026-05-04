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
});
