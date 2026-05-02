import { describe, it, expect } from "vitest";
import { openDatabase, type Db } from "./db";
import { importResults, importSeed } from "./db-bootstrap";

function memoryDb(): Db {
  return openDatabase(":memory:");
}

describe("importSeed", () => {
  it("imports seeded domains as store rows", () => {
    const db = memoryDb();
    const stats = importSeed(db, { "a.com": ["A1"] });
    expect(stats.storesImported).toBe(1);
    const count = (
      db.prepare("SELECT COUNT(*) AS c FROM stores").get() as { c: number }
    ).c;
    expect(count).toBe(1);
  });

  it("imports coupon codes for a domain", () => {
    const db = memoryDb();
    const stats = importSeed(db, { "a.com": ["A1", "A2", "A3"] });
    expect(stats.codesImported).toBe(3);
    const count = (
      db.prepare("SELECT COUNT(*) AS c FROM coupon_codes").get() as {
        c: number;
      }
    ).c;
    expect(count).toBe(3);
  });

  it("is idempotent across reruns", () => {
    const db = memoryDb();
    importSeed(db, { "a.com": ["A1", "A2"] });
    const second = importSeed(db, { "a.com": ["A1", "A2"] });
    expect(second.storesImported).toBe(0);
    expect(second.codesImported).toBe(0);
    const stores = (
      db.prepare("SELECT COUNT(*) AS c FROM stores").get() as { c: number }
    ).c;
    const codes = (
      db.prepare("SELECT COUNT(*) AS c FROM coupon_codes").get() as {
        c: number;
      }
    ).c;
    expect(stores).toBe(1);
    expect(codes).toBe(2);
  });

  it("preserves seed code order via insertion order", () => {
    const db = memoryDb();
    importSeed(db, { "a.com": ["FIRST", "SECOND", "THIRD"] });
    const rows = db
      .prepare(
        "SELECT code FROM coupon_codes ORDER BY id ASC",
      )
      .all() as Array<{ code: string }>;
    expect(rows.map((r) => r.code)).toEqual(["FIRST", "SECOND", "THIRD"]);
  });
});

describe("importResults", () => {
  it("imports result history records", () => {
    const db = memoryDb();
    const stats = importResults(db, {
      results: [
        {
          domain: "a.com",
          code: "A1",
          success: true,
          savingsCents: 100,
          finalTotalCents: 900,
          testedAt: "2026-05-02T00:00:00.000Z",
        },
        {
          domain: "a.com",
          code: "A2",
          success: false,
          savingsCents: 0,
          finalTotalCents: 1000,
          testedAt: "2026-05-02T01:00:00.000Z",
        },
      ],
    });
    expect(stats.resultsImported).toBe(2);
    const count = (
      db.prepare("SELECT COUNT(*) AS c FROM coupon_results").get() as {
        c: number;
      }
    ).c;
    expect(count).toBe(2);
  });

  it("handles an empty results envelope", () => {
    const db = memoryDb();
    const stats = importResults(db, { results: [] });
    expect(stats.resultsImported).toBe(0);
    const count = (
      db.prepare("SELECT COUNT(*) AS c FROM coupon_results").get() as {
        c: number;
      }
    ).c;
    expect(count).toBe(0);
  });

  it("clears and reimports on subsequent runs", () => {
    const db = memoryDb();
    importResults(db, {
      results: [
        {
          domain: "a.com",
          code: "A1",
          success: true,
          savingsCents: 100,
          finalTotalCents: 900,
          testedAt: "2026-05-02T00:00:00.000Z",
        },
        {
          domain: "a.com",
          code: "A2",
          success: false,
          savingsCents: 0,
          finalTotalCents: 1000,
          testedAt: "2026-05-02T01:00:00.000Z",
        },
      ],
    });
    importResults(db, {
      results: [
        {
          domain: "a.com",
          code: "A3",
          success: true,
          savingsCents: 200,
          finalTotalCents: 800,
          testedAt: "2026-05-02T02:00:00.000Z",
        },
      ],
    });
    const rows = db
      .prepare("SELECT code FROM coupon_results")
      .all() as Array<{ code: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].code).toBe("A3");
  });

  it("upserts stores for domains referenced only by results", () => {
    const db = memoryDb();
    importResults(db, {
      results: [
        {
          domain: "new.com",
          code: "X",
          success: true,
          savingsCents: 50,
          finalTotalCents: 950,
          testedAt: "2026-05-02T00:00:00.000Z",
        },
      ],
    });
    const stores = db
      .prepare("SELECT domain FROM stores")
      .all() as Array<{ domain: string }>;
    expect(stores.map((s) => s.domain)).toContain("new.com");
  });

  it("preserves API-relevant data across the import", () => {
    const db = memoryDb();
    importResults(db, {
      results: [
        {
          domain: "a.com",
          code: "WELCOME10",
          success: true,
          savingsCents: 1500,
          finalTotalCents: 8500,
          testedAt: "2026-05-02T00:00:00.000Z",
        },
      ],
    });
    const row = db
      .prepare(
        `SELECT s.domain, r.code, r.success, r.savings_cents, r.final_total_cents, r.tested_at
         FROM coupon_results r
         JOIN stores s ON s.id = r.store_id`,
      )
      .get() as {
      domain: string;
      code: string;
      success: number;
      savings_cents: number;
      final_total_cents: number;
      tested_at: string;
    };
    expect(row).toEqual({
      domain: "a.com",
      code: "WELCOME10",
      success: 1,
      savings_cents: 1500,
      final_total_cents: 8500,
      tested_at: "2026-05-02T00:00:00.000Z",
    });
  });
});
