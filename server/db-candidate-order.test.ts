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

describe("getSourceAwareCandidateOrder — expiry deprioritize tier (v0.51.0)", () => {
  let db: Db;
  beforeAll(() => {
    db = openDatabase(":memory:");
    // P, Q: admin-only (manual, null expiry) → NOT expired. upsert is a
    // destructive per-store replace, so it must run FIRST.
    upsertCouponCodes(db, "exp.example", ["P", "Q"]);
    // X, F: additive provider import (preserves P, Q). X has a PAST expiry,
    // F a FUTURE one.
    importProviderCandidates(db, {
      sourceId: "awin",
      sourceName: "Awin",
      sourceType: "api",
      domain: "exp.example",
      now: "2026-05-10T00:00:00.000Z",
      candidates: [
        { domain: "exp.example", code: "X", expiresAt: "2026-05-01T00:00:00.000Z" },
        { domain: "exp.example", code: "F", expiresAt: "2026-06-01T00:00:00.000Z" },
      ],
    });
    // Give X the STRONGEST non-expiry signal (extra seed claim, conf 100,
    // fresh) AND a PAST expiry — so every X claim is past (still expired
    // under Math.max). Absent the tier X would sort FIRST; the tier must
    // still force it LAST. Decisive: proves the tier dominates the score.
    const storeId = (
      db
        .prepare(`SELECT id FROM stores WHERE domain = ?`)
        .get("exp.example") as { id: number }
    ).id;
    recordCouponCodeSource(db, {
      storeId,
      code: "X",
      sourceId: BUILTIN_SOURCE_IDS.seed,
      discoveredAt: "2026-05-14T11:30:00.000Z",
      confidence: 100,
      expiresAt: "2026-05-01T00:00:00.000Z",
    });
  });
  afterAll(() => db.close());

  it("expired code stays in the set, never dropped, and the call writes nothing", () => {
    const before = counts(db);
    const codes = ["P", "Q", "F", "X"];
    const ordered = getSourceAwareCandidateOrder(db, "exp.example", codes, {
      now: FIXED_NOW,
    });
    expect(new Set(ordered)).toEqual(new Set(codes));
    expect(ordered).toHaveLength(codes.length);
    expect(counts(db)).toEqual(before);
  });

  it("expired X sorts last despite the strongest score; others not penalized", () => {
    const ordered = getSourceAwareCandidateOrder(
      db,
      "exp.example",
      ["P", "Q", "F", "X"],
      { now: FIXED_NOW },
    );
    // X has the highest raw score (seed + conf 100 + multi-source + fresh)
    // yet is LAST because every X claim is past → the expiry tier dominates.
    expect(ordered[ordered.length - 1]).toBe("X");
    expect(ordered[0]).not.toBe("X");
    // P/Q (null expiry) and F (future expiry) all precede expired X.
    expect(ordered.indexOf("P")).toBeLessThan(ordered.indexOf("X"));
    expect(ordered.indexOf("Q")).toBeLessThan(ordered.indexOf("X"));
    expect(ordered.indexOf("F")).toBeLessThan(ordered.indexOf("X"));
  });

  it("is deterministic across repeated calls with a fixed clock", () => {
    const codes = ["P", "Q", "F", "X"];
    const a = getSourceAwareCandidateOrder(db, "exp.example", codes, {
      now: FIXED_NOW,
    });
    const b = getSourceAwareCandidateOrder(db, "exp.example", codes, {
      now: FIXED_NOW,
    });
    expect(a).toEqual(b);
  });
});
