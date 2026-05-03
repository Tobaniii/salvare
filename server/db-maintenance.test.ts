import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "./db";
import { upsertCouponCodes } from "./db-coupons";
import { appendResultRecord } from "./db-results";
import {
  backupDatabase,
  buildExportPayloads,
  exportDatabase,
  resetDatabase,
  timestampStamp,
} from "./db-maintenance";

let workDir: string;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "salvare-maint-"));
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

function makeDbAt(path: string): void {
  const db = openDatabase(path);
  upsertCouponCodes(db, "a.com", ["A1", "A2"]);
  appendResultRecord(db, {
    domain: "a.com",
    code: "A1",
    success: true,
    savingsCents: 100,
    finalTotalCents: 900,
  });
  db.close();
}

describe("timestampStamp", () => {
  it("produces a filename-safe UTC stamp", () => {
    expect(timestampStamp(new Date("2026-05-03T07:08:09.123Z"))).toBe(
      "20260503T070809Z",
    );
  });
});

describe("backupDatabase", () => {
  it("copies the configured DB to a timestamped file", () => {
    const dbPath = join(workDir, "salvare.db");
    makeDbAt(dbPath);
    const backupsDir = join(workDir, "backups");

    const result = backupDatabase(
      dbPath,
      backupsDir,
      new Date("2026-05-03T01:02:03Z"),
    );

    expect(result.backupPath.endsWith("salvare-20260503T010203Z.db")).toBe(
      true,
    );
    expect(existsSync(result.backupPath)).toBe(true);
    expect(statSync(result.backupPath).size).toBe(statSync(dbPath).size);
    expect(readFileSync(result.backupPath)).toEqual(readFileSync(dbPath));
  });

  it("refuses to overwrite an existing backup", () => {
    const dbPath = join(workDir, "salvare.db");
    makeDbAt(dbPath);
    const backupsDir = join(workDir, "backups");
    const fixedNow = new Date("2026-05-03T01:02:03Z");

    backupDatabase(dbPath, backupsDir, fixedNow);
    expect(() => backupDatabase(dbPath, backupsDir, fixedNow)).toThrow(
      /refusing to overwrite/,
    );
  });

  it("fails clearly when the DB file does not exist", () => {
    const dbPath = join(workDir, "missing.db");
    const backupsDir = join(workDir, "backups");

    expect(() => backupDatabase(dbPath, backupsDir)).toThrow(
      /does not exist/,
    );
    expect(existsSync(backupsDir)).toBe(false);
  });
});

describe("exportDatabase", () => {
  it("writes coupons grouped by domain and a results envelope", () => {
    const dbPath = join(workDir, "salvare.db");
    makeDbAt(dbPath);
    const db = openDatabase(dbPath);
    const exportsDir = join(workDir, "exports");

    const result = exportDatabase(
      db,
      exportsDir,
      new Date("2026-05-03T04:05:06Z"),
    );
    db.close();

    expect(result.couponsPath.endsWith("coupons-20260503T040506Z.json")).toBe(
      true,
    );
    expect(
      result.resultsPath.endsWith("coupon-results-20260503T040506Z.json"),
    ).toBe(true);

    const coupons = JSON.parse(readFileSync(result.couponsPath, "utf8"));
    expect(coupons).toEqual({ "a.com": ["A1", "A2"] });

    const results = JSON.parse(readFileSync(result.resultsPath, "utf8"));
    expect(results.results).toHaveLength(1);
    expect(results.results[0]).toMatchObject({
      domain: "a.com",
      code: "A1",
      success: true,
      savingsCents: 100,
      finalTotalCents: 900,
    });
    expect(typeof results.results[0].testedAt).toBe("string");

    expect(result.storeCount).toBe(1);
    expect(result.resultCount).toBe(1);
  });

  it("does not include secrets, env, dbPath, or headers in the payload", () => {
    const dbPath = join(workDir, "salvare.db");
    makeDbAt(dbPath);
    const db = openDatabase(dbPath);

    const { coupons, results } = buildExportPayloads(db);
    db.close();

    const couponsBlob = JSON.stringify(coupons);
    const resultsBlob = JSON.stringify(results);
    for (const blob of [couponsBlob, resultsBlob]) {
      expect(blob).not.toMatch(/SALVARE_ADMIN_TOKEN/i);
      expect(blob).not.toMatch(/SALVARE_DB_PATH/i);
      expect(blob).not.toMatch(/Authorization/i);
      expect(blob).not.toMatch(/Bearer/i);
      expect(blob).not.toMatch(/dbPath/i);
    }

    const resultEntry = results.results[0] as Record<string, unknown>;
    expect(Object.keys(resultEntry).sort()).toEqual(
      [
        "code",
        "domain",
        "finalTotalCents",
        "savingsCents",
        "success",
        "testedAt",
      ].sort(),
    );
  });

  it("refuses to overwrite existing export files", () => {
    const dbPath = join(workDir, "salvare.db");
    makeDbAt(dbPath);
    const db = openDatabase(dbPath);
    const exportsDir = join(workDir, "exports");
    const fixedNow = new Date("2026-05-03T04:05:06Z");

    exportDatabase(db, exportsDir, fixedNow);
    expect(() => exportDatabase(db, exportsDir, fixedNow)).toThrow(
      /refusing to overwrite/,
    );
    db.close();
  });
});

describe("resetDatabase", () => {
  it("recreates the schema and bootstraps from injected sources", () => {
    const dbPath = join(workDir, "salvare.db");
    makeDbAt(dbPath);

    const stats = resetDatabase(dbPath, {
      seed: { "fresh.com": ["NEW1", "NEW2"] },
      results: {
        results: [
          {
            domain: "fresh.com",
            code: "NEW1",
            success: true,
            savingsCents: 50,
            finalTotalCents: 950,
            testedAt: "2026-05-03T00:00:00.000Z",
          },
        ],
      },
    });

    expect(stats.storesImported).toBe(1);
    expect(stats.codesImported).toBe(2);
    expect(stats.resultsImported).toBe(1);

    const db = openDatabase(dbPath);
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
      )
      .all()
      .map((r) => (r as { name: string }).name);
    expect(tables).toContain("stores");
    expect(tables).toContain("coupon_codes");
    expect(tables).toContain("coupon_results");

    const oldDomain = db
      .prepare("SELECT id FROM stores WHERE domain = 'a.com'")
      .get();
    expect(oldDomain).toBeUndefined();

    const freshCodes = db
      .prepare(
        `SELECT code FROM coupon_codes c JOIN stores s ON s.id = c.store_id
         WHERE s.domain = 'fresh.com' ORDER BY c.id ASC`,
      )
      .all()
      .map((r) => (r as { code: string }).code);
    expect(freshCodes).toEqual(["NEW1", "NEW2"]);
    db.close();
  });

  it("removes sqlite sidecar files alongside the main DB", () => {
    const dbPath = join(workDir, "salvare.db");
    makeDbAt(dbPath);
    const journal = `${dbPath}-journal`;
    writeFileSync(journal, "stale", "utf8");

    resetDatabase(dbPath, {
      seed: { "fresh.com": ["X"] },
    });

    expect(existsSync(journal)).toBe(false);
    expect(existsSync(dbPath)).toBe(true);
  });

  it("refuses to operate on smoke/salvare.db", () => {
    const smokeDir = join(workDir, "smoke");
    const smokeDb = join(smokeDir, "salvare.db");

    expect(() => resetDatabase(smokeDb)).toThrow(/refusing to reset smoke/);
    expect(existsSync(smokeDir)).toBe(false);
  });
});
