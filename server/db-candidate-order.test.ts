import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { openDatabase, type Db } from "./db";
import { upsertCouponCodes } from "./db-coupons";
import { importProviderCandidates } from "./db-source-import";
import { recordCouponCodeSource, BUILTIN_SOURCE_IDS } from "./db-sources";
import { getSourceAwareCandidateOrder } from "./db-candidate-order";

const FIXED_NOW = () => new Date("2026-05-14T12:00:00.000Z");

function counts(db: Db): {
  coupons: number;
  results: number;
  codeSources: number;
  fetchLog: number;
} {
  return {
    coupons: (
      db.prepare("SELECT COUNT(*) AS n FROM coupon_codes").get() as {
        n: number;
      }
    ).n,
    results: (
      db.prepare("SELECT COUNT(*) AS n FROM coupon_results").get() as {
        n: number;
      }
    ).n,
    codeSources: (
      db
        .prepare("SELECT COUNT(*) AS n FROM coupon_code_sources")
        .get() as { n: number }
    ).n,
    fetchLog: (
      db
        .prepare("SELECT COUNT(*) AS n FROM source_fetch_log")
        .get() as { n: number }
    ).n,
  };
}

describe("getSourceAwareCandidateOrder — read-only and source-aware", () => {
  let db: Db;
  beforeAll(() => {
    db = openDatabase(":memory:");
    // upsertCouponCodes records 'admin' provenance for each code.
    upsertCouponCodes(db, "shop.example", ["A", "B", "C", "D"]);

    // Make B claimed by awin (via additive import).
    importProviderCandidates(db, {
      sourceId: "awin",
      sourceName: "Awin",
      sourceType: "api",
      domain: "shop.example",
      candidates: [{ domain: "shop.example", code: "B", label: "10% off" }],
    });

    // Boost C with seed claim + max confidence + very fresh discovery to
    // outrank others without history.
    const storeId = (
      db
        .prepare(`SELECT id FROM stores WHERE domain = ?`)
        .get("shop.example") as { id: number }
    ).id;
    recordCouponCodeSource(db, {
      storeId,
      code: "C",
      sourceId: BUILTIN_SOURCE_IDS.seed,
      discoveredAt: "2026-05-14T11:30:00.000Z",
      confidence: 100,
    });
  });
  afterAll(() => db.close());

  it("returns the same set of codes, reordered, and never writes anything", () => {
    const before = counts(db);
    const codes = ["A", "B", "C", "D"];
    const ordered = getSourceAwareCandidateOrder(db, "shop.example", codes, {
      now: FIXED_NOW,
    });
    expect(new Set(ordered)).toEqual(new Set(codes));
    expect(ordered).toHaveLength(codes.length);
    expect(counts(db)).toEqual(before);
  });

  it("unknown domain returns the input order unchanged and writes nothing", () => {
    const before = counts(db);
    const codes = ["X", "Y", "Z"];
    const ordered = getSourceAwareCandidateOrder(
      db,
      "never-seeded.example",
      codes,
      { now: FIXED_NOW },
    );
    expect(ordered).toEqual(codes);
    expect(counts(db)).toEqual(before);
  });

  it("empty input returns empty output", () => {
    expect(
      getSourceAwareCandidateOrder(db, "shop.example", [], { now: FIXED_NOW }),
    ).toEqual([]);
  });

  it("multi-source + high-confidence claims pull a code earlier than admin-only codes", () => {
    // C has admin + seed(confidence:100, fresh) → highest score.
    // B has admin + awin → multi-source bonus.
    // A and D have admin only.
    const ordered = getSourceAwareCandidateOrder(
      db,
      "shop.example",
      ["A", "B", "C", "D"],
      { now: FIXED_NOW },
    );
    expect(ordered[0]).toBe("C");
    expect(ordered.indexOf("B")).toBeLessThan(ordered.indexOf("A"));
    expect(ordered.indexOf("B")).toBeLessThan(ordered.indexOf("D"));
  });
});
