import { describe, it, expect } from "vitest";
import { openDatabase, type Db } from "./db";
import {
  ensureCouponSource,
  getCouponSourceSummary,
  isValidSourceId,
  listCouponSources,
  listSourcesForCoupon,
  recordCouponCodeSource,
  validateSourceId,
} from "./db-sources";

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

describe("isValidSourceId / validateSourceId", () => {
  it("accepts lowercase letters, digits, and dashes", () => {
    expect(isValidSourceId("seed")).toBe(true);
    expect(isValidSourceId("partner-feed-1")).toBe(true);
    expect(isValidSourceId("a")).toBe(true);
    expect(isValidSourceId("0abc")).toBe(true);
  });

  it("rejects empty, whitespace, and non-string values", () => {
    expect(isValidSourceId("")).toBe(false);
    expect(isValidSourceId(" ")).toBe(false);
    expect(isValidSourceId(undefined)).toBe(false);
    expect(isValidSourceId(null)).toBe(false);
    expect(isValidSourceId(123)).toBe(false);
  });

  it("rejects URL-, path-, or secret-shaped values", () => {
    expect(isValidSourceId("https://example.com")).toBe(false);
    expect(isValidSourceId("example.com/feed")).toBe(false);
    expect(isValidSourceId("/etc/passwd")).toBe(false);
    expect(isValidSourceId("partner:feed")).toBe(false);
    expect(isValidSourceId("Bearer abc")).toBe(false);
    expect(isValidSourceId("Token=xyz")).toBe(false);
    expect(isValidSourceId("UPPER")).toBe(false);
    expect(isValidSourceId("with space")).toBe(false);
    expect(isValidSourceId("dash-end-")).toBe(true);
    expect(isValidSourceId("-leading-dash")).toBe(false);
  });

  it("enforces max length of 64", () => {
    const sixtyFour = "a".repeat(64);
    expect(isValidSourceId(sixtyFour)).toBe(true);
    expect(isValidSourceId(sixtyFour + "a")).toBe(false);
  });

  it("validateSourceId throws on invalid input and returns the value otherwise", () => {
    expect(validateSourceId("seed")).toBe("seed");
    expect(() => validateSourceId("")).toThrow();
    expect(() => validateSourceId("UPPER")).toThrow();
    expect(() => validateSourceId(undefined)).toThrow();
  });
});

describe("ensureCouponSource", () => {
  it("creates a new coupon source row with normalized fields", () => {
    const db = makeDb();
    const created = ensureCouponSource(db, {
      id: "partner-feed",
      name: "  Partner Feed  ",
      type: "feed",
    });
    expect(created.id).toBe("partner-feed");
    expect(created.name).toBe("Partner Feed");
    expect(created.type).toBe("feed");
    expect(created.enabled).toBe(true);
  });

  it("updates name/type/enabled on conflict (upsert)", () => {
    const db = makeDb();
    ensureCouponSource(db, {
      id: "partner-feed",
      name: "Old name",
      type: "feed",
    });
    const updated = ensureCouponSource(db, {
      id: "partner-feed",
      name: "New name",
      type: "api",
      enabled: false,
    });
    expect(updated.name).toBe("New name");
    expect(updated.type).toBe("api");
    expect(updated.enabled).toBe(false);
  });

  it("rejects invalid id, name, or type", () => {
    const db = makeDb();
    expect(() =>
      ensureCouponSource(db, {
        id: "Bad ID",
        name: "x",
        type: "manual",
      }),
    ).toThrow();
    expect(() =>
      ensureCouponSource(db, { id: "ok", name: "", type: "manual" }),
    ).toThrow();
    expect(() =>
      ensureCouponSource(db, {
        id: "ok",
        name: "x",
        type: "scrape" as never,
      }),
    ).toThrow();
  });
});

describe("listCouponSources", () => {
  it("returns the default seed/admin/import rows on a fresh DB", () => {
    const db = makeDb();
    const sources = listCouponSources(db);
    const ids = sources.map((s) => s.id);
    expect(ids).toEqual(["admin", "import", "seed"]);
  });

  it("includes newly added sources sorted by id", () => {
    const db = makeDb();
    ensureCouponSource(db, {
      id: "partner-feed",
      name: "Partner Feed",
      type: "feed",
    });
    const ids = listCouponSources(db).map((s) => s.id);
    expect(ids).toEqual(["admin", "import", "partner-feed", "seed"]);
  });
});

describe("recordCouponCodeSource", () => {
  it("creates a provenance row and returns it with normalized fields", () => {
    const db = makeDb();
    const storeId = insertStore(db, "example.com");
    const row = recordCouponCodeSource(db, {
      storeId,
      code: "WELCOME10",
      sourceId: "seed",
      discoveredAt: "2026-05-04T00:00:00.000Z",
      label: "front-page banner",
      sourceUrl: "https://partner.example/feeds/coupons",
      confidence: 75,
    });
    expect(row.id).toBeGreaterThan(0);
    expect(row.storeId).toBe(storeId);
    expect(row.code).toBe("WELCOME10");
    expect(row.sourceId).toBe("seed");
    expect(row.label).toBe("front-page banner");
    expect(row.expiresAt).toBeNull();
    expect(row.confidence).toBe(75);
  });

  it("is idempotent on (store, code, source) and returns the existing row", () => {
    const db = makeDb();
    const storeId = insertStore(db, "example.com");
    const first = recordCouponCodeSource(db, {
      storeId,
      code: "WELCOME10",
      sourceId: "seed",
    });
    const second = recordCouponCodeSource(db, {
      storeId,
      code: "WELCOME10",
      sourceId: "seed",
      label: "duplicate-attempt",
    });
    expect(second.id).toBe(first.id);
    const count = (
      db
        .prepare(
          `SELECT COUNT(*) AS c FROM coupon_code_sources
             WHERE store_id = ? AND code = ? AND source_id = ?`,
        )
        .get(storeId, "WELCOME10", "seed") as { c: number }
    ).c;
    expect(count).toBe(1);
  });

  it("rejects unknown source_id (foreign key violation)", () => {
    const db = makeDb();
    const storeId = insertStore(db, "example.com");
    expect(() =>
      recordCouponCodeSource(db, {
        storeId,
        code: "WELCOME10",
        sourceId: "no-such-source",
      }),
    ).toThrow();
  });

  it("rejects invalid input fields", () => {
    const db = makeDb();
    const storeId = insertStore(db, "example.com");
    expect(() =>
      recordCouponCodeSource(db, {
        storeId: 0,
        code: "WELCOME10",
        sourceId: "seed",
      }),
    ).toThrow();
    expect(() =>
      recordCouponCodeSource(db, { storeId, code: "", sourceId: "seed" }),
    ).toThrow();
    expect(() =>
      recordCouponCodeSource(db, {
        storeId,
        code: "WELCOME10",
        sourceId: "Bad ID",
      }),
    ).toThrow();
    expect(() =>
      recordCouponCodeSource(db, {
        storeId,
        code: "WELCOME10",
        sourceId: "seed",
        confidence: 150,
      }),
    ).toThrow();
  });
});

describe("listSourcesForCoupon", () => {
  it("returns provenance rows for a given store/code, ordered by id", () => {
    const db = makeDb();
    const storeId = insertStore(db, "example.com");
    ensureCouponSource(db, {
      id: "partner-feed",
      name: "Partner Feed",
      type: "feed",
    });
    recordCouponCodeSource(db, {
      storeId,
      code: "WELCOME10",
      sourceId: "seed",
    });
    recordCouponCodeSource(db, {
      storeId,
      code: "WELCOME10",
      sourceId: "partner-feed",
    });
    recordCouponCodeSource(db, {
      storeId,
      code: "OTHER",
      sourceId: "seed",
    });
    const rows = listSourcesForCoupon(db, storeId, "WELCOME10");
    expect(rows.map((r) => r.sourceId)).toEqual(["seed", "partner-feed"]);
  });

  it("returns an empty array when no provenance exists", () => {
    const db = makeDb();
    const storeId = insertStore(db, "example.com");
    expect(listSourcesForCoupon(db, storeId, "WELCOME10")).toEqual([]);
  });
});

describe("getCouponSourceSummary", () => {
  it("rolls up code and store counts per source, including zero-use sources", () => {
    const db = makeDb();
    const a = insertStore(db, "a.example");
    const b = insertStore(db, "b.example");
    recordCouponCodeSource(db, { storeId: a, code: "X", sourceId: "seed" });
    recordCouponCodeSource(db, { storeId: a, code: "Y", sourceId: "seed" });
    recordCouponCodeSource(db, { storeId: b, code: "X", sourceId: "seed" });
    recordCouponCodeSource(db, {
      storeId: a,
      code: "X",
      sourceId: "admin",
    });
    const summary = getCouponSourceSummary(db);
    const bySource = new Map(summary.map((s) => [s.sourceId, s]));
    expect(bySource.get("seed")?.codeCount).toBe(3);
    expect(bySource.get("seed")?.storeCount).toBe(2);
    expect(bySource.get("admin")?.codeCount).toBe(1);
    expect(bySource.get("admin")?.storeCount).toBe(1);
    expect(bySource.get("import")?.codeCount).toBe(0);
    expect(bySource.get("import")?.storeCount).toBe(0);
  });
});

describe("redaction contract", () => {
  it("listCouponSources output never includes paths, env, or auth-shaped fields", () => {
    const db = makeDb();
    ensureCouponSource(db, {
      id: "partner-feed",
      name: "Partner Feed",
      type: "feed",
    });
    const serialized = JSON.stringify(listCouponSources(db));
    expect(serialized).not.toContain("/etc/");
    expect(serialized).not.toContain("Authorization");
    expect(serialized).not.toContain("Bearer ");
    expect(serialized).not.toContain("SALVARE_");
    expect(serialized).not.toContain("Cookie");
  });

  it("listSourcesForCoupon output never includes raw HTML, payloads, or env values", () => {
    const db = makeDb();
    const storeId = insertStore(db, "example.com");
    recordCouponCodeSource(db, {
      storeId,
      code: "WELCOME10",
      sourceId: "seed",
    });
    const serialized = JSON.stringify(listSourcesForCoupon(db, storeId, "WELCOME10"));
    expect(serialized).not.toContain("<html");
    expect(serialized).not.toContain("<!DOCTYPE");
    expect(serialized).not.toContain("Authorization");
    expect(serialized).not.toContain("Bearer ");
    expect(serialized).not.toContain("SALVARE_");
    expect(serialized).not.toContain("Cookie");
  });
});
