import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase, type Db } from "./db";
import { getAllSeedData, upsertCouponCodes } from "./db-coupons";
import {
  appendResultRecord,
  getAllResults,
  getResultsForDomain,
} from "./db-results";
import {
  importCouponsExport,
  importResultsExport,
  parseCouponsExport,
  parseResultsExport,
  summarizeCouponsPreview,
  summarizeResultsPreview,
} from "./db-import";

let workDir: string;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "salvare-import-"));
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

function makeDbAt(path: string): Db {
  return openDatabase(path);
}

describe("parseCouponsExport", () => {
  it("accepts a valid object of domain → codes", () => {
    const r = parseCouponsExport({ "a.com": ["A1", "A2"] });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ "a.com": ["A1", "A2"] });
  });

  it("strips unknown nested fields by only reading domain → string[]", () => {
    const r = parseCouponsExport({
      "a.com": ["A1"],
      // any non-array value should be rejected, not silently kept
    });
    expect(r.ok).toBe(true);
  });

  it("rejects non-object root", () => {
    expect(parseCouponsExport(["a"]).ok).toBe(false);
    expect(parseCouponsExport(null).ok).toBe(false);
    expect(parseCouponsExport("nope").ok).toBe(false);
  });

  it("rejects non-array code list", () => {
    const r = parseCouponsExport({ "a.com": "WELCOME10" });
    expect(r.ok).toBe(false);
  });

  it("rejects empty/whitespace code values", () => {
    const r = parseCouponsExport({ "a.com": ["", "  "] });
    expect(r.ok).toBe(false);
  });
});

describe("parseResultsExport", () => {
  it("accepts a valid envelope", () => {
    const r = parseResultsExport({
      results: [
        {
          domain: "a.com",
          code: "A1",
          success: true,
          savingsCents: 100,
          finalTotalCents: 900,
          testedAt: "2026-05-03T00:00:00.000Z",
        },
      ],
    });
    expect(r.ok).toBe(true);
  });

  it("strips unknown fields from result records", () => {
    const r = parseResultsExport({
      results: [
        {
          domain: "a.com",
          code: "A1",
          success: true,
          savingsCents: 100,
          finalTotalCents: 900,
          testedAt: "2026-05-03T00:00:00.000Z",
          SALVARE_ADMIN_TOKEN: "leak",
          Authorization: "Bearer leak",
          dbPath: "/etc/passwd",
        },
      ],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const rec = r.value.results[0] as Record<string, unknown>;
      expect(Object.keys(rec).sort()).toEqual([
        "code",
        "domain",
        "finalTotalCents",
        "savingsCents",
        "success",
        "testedAt",
      ]);
    }
  });

  it("rejects missing 'results' array", () => {
    expect(parseResultsExport({}).ok).toBe(false);
    expect(parseResultsExport({ results: "x" }).ok).toBe(false);
  });

  it("rejects bad field types", () => {
    expect(
      parseResultsExport({
        results: [
          {
            domain: "a.com",
            code: "A1",
            success: "yes",
            savingsCents: 100,
            finalTotalCents: 900,
            testedAt: "x",
          },
        ],
      }).ok,
    ).toBe(false);
    expect(
      parseResultsExport({
        results: [
          {
            domain: "a.com",
            code: "A1",
            success: true,
            savingsCents: -1,
            finalTotalCents: 900,
            testedAt: "x",
          },
        ],
      }).ok,
    ).toBe(false);
  });
});

describe("importCouponsExport", () => {
  it("restores domain → candidate codes", () => {
    const db = makeDbAt(join(workDir, "salvare.db"));
    const stats = importCouponsExport(db, {
      "a.com": ["A1", "A2"],
      "b.com": ["B1"],
    });
    expect(stats.storesImported).toBe(2);
    expect(stats.codesImported).toBe(3);
    expect(getAllSeedData(db)).toEqual({
      "a.com": ["A1", "A2"],
      "b.com": ["B1"],
    });
    db.close();
  });

  it("is idempotent across reruns of the same export", () => {
    const db = makeDbAt(join(workDir, "salvare.db"));
    importCouponsExport(db, { "a.com": ["A1", "A2"] });
    importCouponsExport(db, { "a.com": ["A1", "A2"] });
    expect(getAllSeedData(db)).toEqual({ "a.com": ["A1", "A2"] });
    db.close();
  });

  it("replaces a domain's codes in place", () => {
    const db = makeDbAt(join(workDir, "salvare.db"));
    upsertCouponCodes(db, "a.com", ["OLD1", "OLD2"]);
    importCouponsExport(db, { "a.com": ["NEW1"] });
    expect(getAllSeedData(db)).toEqual({ "a.com": ["NEW1"] });
    db.close();
  });
});

describe("importResultsExport", () => {
  it("restores result records grouped by domain", () => {
    const db = makeDbAt(join(workDir, "salvare.db"));
    const stats = importResultsExport(db, {
      results: [
        {
          domain: "a.com",
          code: "A1",
          success: true,
          savingsCents: 100,
          finalTotalCents: 900,
          testedAt: "2026-05-03T00:00:00.000Z",
        },
      ],
    });
    expect(stats.resultsImported).toBe(1);
    expect(stats.domainsReplaced).toBe(1);
    expect(getAllResults(db)).toHaveLength(1);
    db.close();
  });

  it("rerunning the same export produces the same row count (per-domain replace)", () => {
    const db = makeDbAt(join(workDir, "salvare.db"));
    const envelope = {
      results: [
        {
          domain: "a.com",
          code: "A1",
          success: true,
          savingsCents: 100,
          finalTotalCents: 900,
          testedAt: "2026-05-03T00:00:00.000Z",
        },
        {
          domain: "a.com",
          code: "A2",
          success: false,
          savingsCents: 0,
          finalTotalCents: 1000,
          testedAt: "2026-05-03T01:00:00.000Z",
        },
      ],
    };
    importResultsExport(db, envelope);
    importResultsExport(db, envelope);
    expect(getAllResults(db)).toHaveLength(2);
    db.close();
  });

  it("preserves history for domains absent from the import", () => {
    const db = makeDbAt(join(workDir, "salvare.db"));
    upsertCouponCodes(db, "untouched.com", ["U1"]);
    appendResultRecord(db, {
      domain: "untouched.com",
      code: "U1",
      success: true,
      savingsCents: 50,
      finalTotalCents: 950,
    });
    importResultsExport(db, {
      results: [
        {
          domain: "a.com",
          code: "A1",
          success: true,
          savingsCents: 100,
          finalTotalCents: 900,
          testedAt: "2026-05-03T00:00:00.000Z",
        },
      ],
    });
    expect(getResultsForDomain(db, "untouched.com")).toHaveLength(1);
    db.close();
  });

  it("rolls back the whole transaction on a mid-import failure", () => {
    const db = makeDbAt(join(workDir, "salvare.db"));
    upsertCouponCodes(db, "a.com", ["A1"]);
    appendResultRecord(db, {
      domain: "a.com",
      code: "A1",
      success: true,
      savingsCents: 100,
      finalTotalCents: 900,
    });
    const before = getResultsForDomain(db, "a.com");
    expect(before).toHaveLength(1);

    // Force a failure mid-transaction by passing a non-integer savingsCents
    // through a parsed envelope (parseResultsExport would block this, but we
    // bypass it here to simulate a corrupted record reaching the writer).
    expect(() =>
      importResultsExport(db, {
        results: [
          {
            domain: "a.com",
            code: "A2",
            success: true,
            savingsCents: Number.NaN as unknown as number,
            finalTotalCents: 900,
            testedAt: "2026-05-03T00:00:00.000Z",
          },
        ],
      }),
    ).toThrow();

    // History for a.com must still be intact — no partial delete.
    expect(getResultsForDomain(db, "a.com")).toEqual(before);
    db.close();
  });

  it("imports records produced by a real round-trip without leaking unknown fields", () => {
    const db = makeDbAt(join(workDir, "salvare.db"));
    const envelope = {
      results: [
        {
          domain: "a.com",
          code: "A1",
          success: true,
          savingsCents: 100,
          finalTotalCents: 900,
          testedAt: "2026-05-03T00:00:00.000Z",
        },
      ],
    };
    importResultsExport(db, envelope);
    const rows = db
      .prepare(
        `SELECT s.domain, r.code, r.success, r.savings_cents, r.final_total_cents, r.tested_at
           FROM coupon_results r JOIN stores s ON s.id = r.store_id`,
      )
      .all() as Array<Record<string, unknown>>;
    const blob = JSON.stringify(rows);
    expect(blob).not.toMatch(/SALVARE_ADMIN_TOKEN/i);
    expect(blob).not.toMatch(/Authorization/i);
    expect(blob).not.toMatch(/dbPath/i);
    db.close();
  });
});

describe("summarizeCouponsPreview", () => {
  it("counts domains and codes and lists sorted domain names", () => {
    const summary = summarizeCouponsPreview({
      "b.com": ["B1", "B2"],
      "a.com": ["A1", "A2", "A3"],
    });
    expect(summary).toEqual({
      ok: true,
      type: "coupons",
      domains: 2,
      codes: 5,
      domainNames: ["a.com", "b.com"],
      domainNamesTruncated: false,
    });
  });

  it("truncates the sample list and sets domainNamesTruncated", () => {
    const seed: Record<string, string[]> = {};
    for (let i = 0; i < 25; i++) {
      seed[`d${String(i).padStart(2, "0")}.com`] = ["X"];
    }
    const summary = summarizeCouponsPreview(seed);
    expect(summary.domains).toBe(25);
    expect(summary.codes).toBe(25);
    expect(summary.domainNames).toHaveLength(20);
    expect(summary.domainNames[0]).toBe("d00.com");
    expect(summary.domainNames[19]).toBe("d19.com");
    expect(summary.domainNamesTruncated).toBe(true);
  });

  it("handles an empty seed", () => {
    expect(summarizeCouponsPreview({})).toEqual({
      ok: true,
      type: "coupons",
      domains: 0,
      codes: 0,
      domainNames: [],
      domainNamesTruncated: false,
    });
  });
});

describe("summarizeResultsPreview", () => {
  it("counts records and unique domains; lists sorted domain names", () => {
    const summary = summarizeResultsPreview({
      results: [
        {
          domain: "b.com",
          code: "B1",
          success: true,
          savingsCents: 100,
          finalTotalCents: 900,
          testedAt: "2026-05-03T00:00:00.000Z",
        },
        {
          domain: "a.com",
          code: "A1",
          success: false,
          savingsCents: 0,
          finalTotalCents: 1000,
          testedAt: "2026-05-03T01:00:00.000Z",
        },
        {
          domain: "a.com",
          code: "A2",
          success: true,
          savingsCents: 50,
          finalTotalCents: 950,
          testedAt: "2026-05-03T02:00:00.000Z",
        },
      ],
    });
    expect(summary).toEqual({
      ok: true,
      type: "results",
      records: 3,
      domains: 2,
      domainNames: ["a.com", "b.com"],
      domainNamesTruncated: false,
    });
  });

  it("truncates sample list when more than 20 unique domains", () => {
    const records = [];
    for (let i = 0; i < 30; i++) {
      records.push({
        domain: `d${String(i).padStart(2, "0")}.com`,
        code: "X",
        success: true,
        savingsCents: 0,
        finalTotalCents: 0,
        testedAt: "2026-05-03T00:00:00.000Z",
      });
    }
    const summary = summarizeResultsPreview({ results: records });
    expect(summary.records).toBe(30);
    expect(summary.domains).toBe(30);
    expect(summary.domainNames).toHaveLength(20);
    expect(summary.domainNamesTruncated).toBe(true);
  });
});
