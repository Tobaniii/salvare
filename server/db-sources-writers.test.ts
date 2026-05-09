// Cross-writer provenance tests covering the seam where seed/admin/import
// writers feed coupon_code_sources via the v0.27 helpers. Behaviors that
// belong to a single helper file live with that helper's tests; this file
// covers interactions between writers and the new prune helper.

import { describe, it, expect } from "vitest";
import { openDatabase, type Db } from "./db";
import { importSeed } from "./db-bootstrap";
import { upsertCouponCodes } from "./db-coupons";
import { importCouponsExport } from "./db-import";
import {
  getCouponSourceSummary,
  listSourcesForCoupon,
  pruneCouponCodeSourcesForStore,
  recordCouponCodeSource,
} from "./db-sources";

function memoryDb(): Db {
  return openDatabase(":memory:");
}

function storeIdFor(db: Db, domain: string): number {
  return (
    db.prepare("SELECT id FROM stores WHERE domain = ?").get(domain) as {
      id: number;
    }
  ).id;
}

describe("multiple sources claiming the same (store, code)", () => {
  it("records one row per source for the same (store, code) and one coupon_codes row", () => {
    const db = memoryDb();
    importSeed(db, { "a.com": ["SHARED"] });
    upsertCouponCodes(db, "a.com", ["SHARED"]);
    importCouponsExport(db, { "a.com": ["SHARED"] });

    const storeId = storeIdFor(db, "a.com");
    const sources = listSourcesForCoupon(db, storeId, "SHARED").map(
      (r) => r.sourceId,
    );
    expect(sources.sort()).toEqual(["admin", "import", "seed"]);

    const codeRows = (
      db
        .prepare(
          "SELECT COUNT(*) AS c FROM coupon_codes WHERE store_id = ? AND code = ?",
        )
        .get(storeId, "SHARED") as { c: number }
    ).c;
    expect(codeRows).toBe(1);
  });
});

describe("getCouponSourceSummary across writers", () => {
  it("counts per-source codes and stores after a seed → admin → import sequence", () => {
    const db = memoryDb();
    importSeed(db, { "a.com": ["A1", "A2"], "b.com": ["B1"] });
    upsertCouponCodes(db, "c.com", ["C1"]);
    importCouponsExport(db, { "d.com": ["D1", "D2"] });

    const summary = getCouponSourceSummary(db);
    const bySource = new Map(summary.map((s) => [s.sourceId, s]));

    expect(bySource.get("seed")?.codeCount).toBe(3);
    expect(bySource.get("seed")?.storeCount).toBe(2);
    expect(bySource.get("admin")?.codeCount).toBe(1);
    expect(bySource.get("admin")?.storeCount).toBe(1);
    expect(bySource.get("import")?.codeCount).toBe(2);
    expect(bySource.get("import")?.storeCount).toBe(1);
  });
});

describe("pruneCouponCodeSourcesForStore", () => {
  it("deletes all provenance for a store when keepCodes is empty", () => {
    const db = memoryDb();
    importSeed(db, { "a.com": ["A1", "A2"] });
    const storeId = storeIdFor(db, "a.com");
    const result = pruneCouponCodeSourcesForStore(db, storeId, []);
    expect(result.deleted).toBe(2);
    expect(listSourcesForCoupon(db, storeId, "A1")).toEqual([]);
    expect(listSourcesForCoupon(db, storeId, "A2")).toEqual([]);
  });

  it("deletes only codes not in keepCodes for the touched store", () => {
    const db = memoryDb();
    importSeed(db, { "a.com": ["KEEP", "DROP"] });
    const storeId = storeIdFor(db, "a.com");
    const result = pruneCouponCodeSourcesForStore(db, storeId, ["KEEP"]);
    expect(result.deleted).toBe(1);
    expect(
      listSourcesForCoupon(db, storeId, "KEEP").map((r) => r.sourceId),
    ).toEqual(["seed"]);
    expect(listSourcesForCoupon(db, storeId, "DROP")).toEqual([]);
  });

  it("never touches provenance for other stores", () => {
    const db = memoryDb();
    importSeed(db, { "a.com": ["A1"], "b.com": ["B1"] });
    const aId = storeIdFor(db, "a.com");
    const bId = storeIdFor(db, "b.com");
    pruneCouponCodeSourcesForStore(db, aId, []);
    expect(listSourcesForCoupon(db, aId, "A1")).toEqual([]);
    expect(
      listSourcesForCoupon(db, bId, "B1").map((r) => r.sourceId),
    ).toEqual(["seed"]);
  });

  it("rejects an invalid storeId", () => {
    const db = memoryDb();
    expect(() => pruneCouponCodeSourcesForStore(db, 0, [])).toThrow();
    expect(() =>
      pruneCouponCodeSourcesForStore(db, -1, ["A"]),
    ).toThrow();
  });
});

describe("destructive replace + multi-source claim", () => {
  it("admin upsert prunes its own provenance for dropped codes but does not delete other sources' provenance for surviving codes", () => {
    const db = memoryDb();
    importSeed(db, { "a.com": ["KEEP", "DROP"] });
    const storeId = storeIdFor(db, "a.com");
    upsertCouponCodes(db, "a.com", ["KEEP"]);

    // KEEP now has both seed and admin provenance.
    const keepSources = listSourcesForCoupon(db, storeId, "KEEP")
      .map((r) => r.sourceId)
      .sort();
    expect(keepSources).toEqual(["admin", "seed"]);

    // DROP's seed provenance is gone because admin's destructive replace
    // pruned every source row for the (store, code) pair the new code list
    // does not include.
    expect(listSourcesForCoupon(db, storeId, "DROP")).toEqual([]);
  });
});

describe("recordCouponCodeSource is reachable from writers", () => {
  it("does not stop direct callers from also using the helper for additional source claims", () => {
    const db = memoryDb();
    importSeed(db, { "a.com": ["A1"] });
    const storeId = storeIdFor(db, "a.com");
    recordCouponCodeSource(db, {
      storeId,
      code: "A1",
      sourceId: "admin",
    });
    const sources = listSourcesForCoupon(db, storeId, "A1")
      .map((r) => r.sourceId)
      .sort();
    expect(sources).toEqual(["admin", "seed"]);
  });
});
