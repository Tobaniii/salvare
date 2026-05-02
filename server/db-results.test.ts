import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase, type Db } from "./db";
import {
  appendResultRecord,
  bootstrapResultsIfEmpty,
  deleteResultsForDomain,
  getAllResults,
  getResultsForDomain,
} from "./db-results";
import {
  deleteCouponDomain,
  getAllSeedData,
  getCandidateCodesForDomain,
  upsertCouponCodes,
} from "./db-coupons";

function memoryDb(): Db {
  return openDatabase(":memory:");
}

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function tempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "salvare-test-"));
  tempDirs.push(dir);
  return join(dir, "salvare.db");
}

describe("appendResultRecord", () => {
  it("stores a record and stamps testedAt", () => {
    const db = memoryDb();
    const stored = appendResultRecord(db, {
      domain: "a.com",
      code: "A1",
      success: true,
      savingsCents: 100,
      finalTotalCents: 900,
    });
    expect(stored.domain).toBe("a.com");
    expect(stored.code).toBe("A1");
    expect(stored.success).toBe(true);
    expect(stored.savingsCents).toBe(100);
    expect(stored.finalTotalCents).toBe(900);
    expect(typeof stored.testedAt).toBe("string");
    expect(stored.testedAt.length).toBeGreaterThan(0);
  });

  it("auto-creates a stores row for an unseeded domain", () => {
    const db = memoryDb();
    appendResultRecord(db, {
      domain: "fresh.com",
      code: "X1",
      success: false,
      savingsCents: 0,
      finalTotalCents: 1000,
    });
    expect(getAllSeedData(db)).toEqual({ "fresh.com": [] });
  });

  it("uses the injected clock for testedAt", () => {
    const db = memoryDb();
    const fixed = new Date("2026-05-02T00:00:00.000Z");
    const stored = appendResultRecord(
      db,
      {
        domain: "a.com",
        code: "A1",
        success: true,
        savingsCents: 100,
        finalTotalCents: 900,
      },
      () => fixed,
    );
    expect(stored.testedAt).toBe("2026-05-02T00:00:00.000Z");
  });
});

describe("getResultsForDomain", () => {
  it("returns records in insertion order, filtered by domain", () => {
    const db = memoryDb();
    appendResultRecord(db, {
      domain: "a.com",
      code: "A1",
      success: true,
      savingsCents: 100,
      finalTotalCents: 900,
    });
    appendResultRecord(db, {
      domain: "b.com",
      code: "B1",
      success: false,
      savingsCents: 0,
      finalTotalCents: 1000,
    });
    appendResultRecord(db, {
      domain: "a.com",
      code: "A2",
      success: true,
      savingsCents: 200,
      finalTotalCents: 800,
    });

    const aRecords = getResultsForDomain(db, "a.com");
    expect(aRecords).toHaveLength(2);
    expect(aRecords.map((r) => r.code)).toEqual(["A1", "A2"]);

    const bRecords = getResultsForDomain(db, "b.com");
    expect(bRecords).toHaveLength(1);
    expect(bRecords[0].code).toBe("B1");
  });

  it("returns [] for a domain with no results", () => {
    const db = memoryDb();
    appendResultRecord(db, {
      domain: "a.com",
      code: "A1",
      success: true,
      savingsCents: 100,
      finalTotalCents: 900,
    });
    expect(getResultsForDomain(db, "missing.com")).toEqual([]);
  });

  it("trims whitespace before lookup", () => {
    const db = memoryDb();
    appendResultRecord(db, {
      domain: "a.com",
      code: "A1",
      success: true,
      savingsCents: 100,
      finalTotalCents: 900,
    });
    expect(getResultsForDomain(db, "  a.com  ")).toHaveLength(1);
  });
});

describe("deleteResultsForDomain", () => {
  it("deletes records for a domain and reports the count", () => {
    const db = memoryDb();
    appendResultRecord(db, {
      domain: "a.com",
      code: "A1",
      success: true,
      savingsCents: 100,
      finalTotalCents: 900,
    });
    appendResultRecord(db, {
      domain: "a.com",
      code: "A2",
      success: false,
      savingsCents: 0,
      finalTotalCents: 1000,
    });
    appendResultRecord(db, {
      domain: "b.com",
      code: "B1",
      success: true,
      savingsCents: 50,
      finalTotalCents: 950,
    });

    const result = deleteResultsForDomain(db, "a.com");
    expect(result).toEqual({ domain: "a.com", deletedCount: 2 });
    expect(getResultsForDomain(db, "a.com")).toEqual([]);
  });

  it("returns deletedCount: 0 for a domain with no records", () => {
    const db = memoryDb();
    appendResultRecord(db, {
      domain: "a.com",
      code: "A1",
      success: true,
      savingsCents: 100,
      finalTotalCents: 900,
    });
    const result = deleteResultsForDomain(db, "b.com");
    expect(result).toEqual({ domain: "b.com", deletedCount: 0 });
    expect(getResultsForDomain(db, "a.com")).toHaveLength(1);
  });

  it("preserves records for other domains", () => {
    const db = memoryDb();
    appendResultRecord(db, {
      domain: "a.com",
      code: "A1",
      success: true,
      savingsCents: 100,
      finalTotalCents: 900,
    });
    appendResultRecord(db, {
      domain: "b.com",
      code: "B1",
      success: true,
      savingsCents: 50,
      finalTotalCents: 950,
    });

    deleteResultsForDomain(db, "a.com");
    const others = getResultsForDomain(db, "b.com");
    expect(others).toHaveLength(1);
    expect(others[0]).toMatchObject({
      domain: "b.com",
      code: "B1",
      success: true,
      savingsCents: 50,
      finalTotalCents: 950,
    });
  });

  it("trims whitespace before deleting", () => {
    const db = memoryDb();
    appendResultRecord(db, {
      domain: "a.com",
      code: "A1",
      success: true,
      savingsCents: 100,
      finalTotalCents: 900,
    });
    const result = deleteResultsForDomain(db, "  a.com  ");
    expect(result).toEqual({ domain: "a.com", deletedCount: 1 });
    expect(getResultsForDomain(db, "a.com")).toEqual([]);
  });

  it("leaves stores and coupon_codes intact", () => {
    const db = memoryDb();
    upsertCouponCodes(db, "a.com", ["A1", "A2"]);
    appendResultRecord(db, {
      domain: "a.com",
      code: "A1",
      success: true,
      savingsCents: 100,
      finalTotalCents: 900,
    });

    deleteResultsForDomain(db, "a.com");
    expect(getCandidateCodesForDomain(db, "a.com")).toEqual(["A1", "A2"]);
  });
});

describe("getAllResults", () => {
  it("returns all results across domains in insertion order", () => {
    const db = memoryDb();
    appendResultRecord(db, {
      domain: "a.com",
      code: "A1",
      success: true,
      savingsCents: 100,
      finalTotalCents: 900,
    });
    appendResultRecord(db, {
      domain: "b.com",
      code: "B1",
      success: false,
      savingsCents: 0,
      finalTotalCents: 1000,
    });
    expect(getAllResults(db).map((r) => r.code)).toEqual(["A1", "B1"]);
  });

  it("returns [] for an empty database", () => {
    const db = memoryDb();
    expect(getAllResults(db)).toEqual([]);
  });
});

describe("bootstrapResultsIfEmpty", () => {
  it("imports envelope when coupon_results is empty", () => {
    const db = memoryDb();
    const stats = bootstrapResultsIfEmpty(db, {
      results: [
        {
          domain: "a.com",
          code: "A1",
          success: true,
          savingsCents: 100,
          finalTotalCents: 900,
          testedAt: "2026-01-01T00:00:00.000Z",
        },
        {
          domain: "b.com",
          code: "B1",
          success: false,
          savingsCents: 0,
          finalTotalCents: 1000,
          testedAt: "2026-01-02T00:00:00.000Z",
        },
      ],
    });
    expect(stats).toEqual({ bootstrapped: true, resultsImported: 2 });
    expect(getResultsForDomain(db, "a.com")).toHaveLength(1);
    expect(getResultsForDomain(db, "b.com")).toHaveLength(1);
  });

  it("no-ops when results already exist", () => {
    const db = memoryDb();
    appendResultRecord(db, {
      domain: "existing.com",
      code: "X",
      success: true,
      savingsCents: 100,
      finalTotalCents: 900,
    });
    const stats = bootstrapResultsIfEmpty(db, {
      results: [
        {
          domain: "a.com",
          code: "A1",
          success: true,
          savingsCents: 100,
          finalTotalCents: 900,
          testedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    });
    expect(stats).toEqual({ bootstrapped: false, resultsImported: 0 });
    expect(getResultsForDomain(db, "a.com")).toEqual([]);
  });

  it("no-ops on an empty envelope", () => {
    const db = memoryDb();
    const stats = bootstrapResultsIfEmpty(db, { results: [] });
    expect(stats).toEqual({ bootstrapped: false, resultsImported: 0 });
  });
});

describe("persistence across reopen", () => {
  it("persists append/delete changes to the database file", () => {
    const path = tempDbPath();

    let db = openDatabase(path);
    appendResultRecord(db, {
      domain: "a.com",
      code: "A1",
      success: true,
      savingsCents: 100,
      finalTotalCents: 900,
    });
    appendResultRecord(db, {
      domain: "b.com",
      code: "B1",
      success: false,
      savingsCents: 0,
      finalTotalCents: 1000,
    });
    db.close();

    db = openDatabase(path);
    expect(getResultsForDomain(db, "a.com")).toHaveLength(1);
    expect(getResultsForDomain(db, "b.com")).toHaveLength(1);
    deleteResultsForDomain(db, "a.com");
    db.close();

    db = openDatabase(path);
    expect(getResultsForDomain(db, "a.com")).toEqual([]);
    expect(getResultsForDomain(db, "b.com")).toHaveLength(1);
    db.close();
  });

  it("does not delete the stores row when results are deleted", () => {
    const path = tempDbPath();

    let db = openDatabase(path);
    upsertCouponCodes(db, "a.com", ["A1"]);
    appendResultRecord(db, {
      domain: "a.com",
      code: "A1",
      success: true,
      savingsCents: 100,
      finalTotalCents: 900,
    });
    deleteResultsForDomain(db, "a.com");
    db.close();

    db = openDatabase(path);
    expect(getCandidateCodesForDomain(db, "a.com")).toEqual(["A1"]);
    deleteCouponDomain(db, "a.com");
    db.close();
  });
});
