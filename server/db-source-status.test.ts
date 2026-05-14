import { describe, it, expect } from "vitest";
import { openDatabase, type Db } from "./db";
import {
  recordSourceFetchAttempt,
  upsertSourceCacheEntry,
} from "./db-source-cache";
import {
  getSourceStatusSummary,
  type ProviderStatusFn,
} from "./db-source-status";

function makeDb(): Db {
  return openDatabase(":memory:");
}

function countTables(db: Db): Record<string, number> {
  const t = (sql: string) =>
    (db.prepare(sql).get() as { n: number }).n;
  return {
    coupons: t("SELECT COUNT(*) AS n FROM coupon_codes"),
    results: t("SELECT COUNT(*) AS n FROM coupon_results"),
    codeSources: t("SELECT COUNT(*) AS n FROM coupon_code_sources"),
    fetchLog: t("SELECT COUNT(*) AS n FROM source_fetch_log"),
    cache: t("SELECT COUNT(*) AS n FROM source_cache"),
    sources: t("SELECT COUNT(*) AS n FROM coupon_sources"),
  };
}

const NOW = "2026-05-14T12:00:00.000Z";
const PAST = "2026-05-14T10:00:00.000Z";
const FUTURE = "2026-05-14T13:00:00.000Z";

describe("getSourceStatusSummary — bare DB", () => {
  it("returns a row per coupon_sources entry with zeroed counts and null fetch state", () => {
    const db = makeDb();
    const summary = getSourceStatusSummary(db, { now: NOW });
    const ids = summary.sources.map((s) => s.sourceId).sort();
    expect(ids).toEqual(["admin", "import", "seed"]);
    for (const row of summary.sources) {
      expect(row.enabled).toBe(true);
      expect(row.providerFeatureEnabled).toBe(false);
      expect(row.providerConfigured).toBe(false);
      expect(row.lastFetchAt).toBeNull();
      expect(row.lastFetchOutcome).toBeNull();
      expect(row.lastSafeError).toBeNull();
      expect(row.cacheEntries).toBe(0);
      expect(row.freshCacheEntries).toBe(0);
      expect(row.staleCacheEntries).toBe(0);
      expect(row.cachedCandidateCount).toBe(0);
      expect(row.newestCacheAt).toBeNull();
      expect(row.nextAllowedFetchAt).toBeNull();
    }
  });
});

describe("getSourceStatusSummary — cache + fetch-log aggregation", () => {
  it("aggregates fresh/stale cache counts, newest cache, and next-allowed fetch", () => {
    const db = makeDb();
    upsertSourceCacheEntry(db, {
      sourceId: "seed",
      cacheKey: "k:fresh",
      fetchedAt: PAST,
      expiresAt: FUTURE,
      status: "ok",
    });
    upsertSourceCacheEntry(db, {
      sourceId: "seed",
      cacheKey: "k:stale",
      fetchedAt: PAST,
      expiresAt: PAST,
      status: "ok",
    });
    const summary = getSourceStatusSummary(db, { now: NOW });
    const seed = summary.sources.find((s) => s.sourceId === "seed");
    expect(seed).toBeDefined();
    expect(seed!.cacheEntries).toBe(2);
    expect(seed!.freshCacheEntries).toBe(1);
    expect(seed!.staleCacheEntries).toBe(1);
    expect(seed!.newestCacheAt).toBe(PAST);
    expect(seed!.nextAllowedFetchAt).toBe(FUTURE);
  });

  it("summarizes each fetch outcome via the latest log row", () => {
    const outcomes: Array<
      "ok" | "empty" | "error" | "rate_limited" | "cache_hit"
    > = ["ok", "empty", "error", "rate_limited", "cache_hit"];
    for (const outcome of outcomes) {
      const db = makeDb();
      recordSourceFetchAttempt(
        db,
        {
          sourceId: "seed",
          cacheKey: "k:1",
          outcome,
          errorCode: outcome === "error" ? "parse_error" : null,
        },
        NOW,
      );
      const summary = getSourceStatusSummary(db, { now: NOW });
      const seed = summary.sources.find((s) => s.sourceId === "seed")!;
      expect(seed.lastFetchOutcome).toBe(outcome);
      expect(seed.lastFetchAt).toBe(NOW);
      expect(seed.lastSafeError).toBe(
        outcome === "error" ? "parse_error" : null,
      );
    }
  });

  it("uses only the latest fetch row per source", () => {
    const db = makeDb();
    recordSourceFetchAttempt(
      db,
      { sourceId: "seed", cacheKey: "k:1", outcome: "ok" },
      "2026-05-14T11:00:00.000Z",
    );
    recordSourceFetchAttempt(
      db,
      {
        sourceId: "seed",
        cacheKey: "k:1",
        outcome: "error",
        errorCode: "http_5xx",
      },
      "2026-05-14T11:30:00.000Z",
    );
    const summary = getSourceStatusSummary(db, { now: NOW });
    const seed = summary.sources.find((s) => s.sourceId === "seed")!;
    expect(seed.lastFetchOutcome).toBe("error");
    expect(seed.lastSafeError).toBe("http_5xx");
    expect(seed.lastFetchAt).toBe("2026-05-14T11:30:00.000Z");
  });
});

describe("getSourceStatusSummary — cachedCandidateCount", () => {
  it("counts entries from valid candidates_json arrays only", () => {
    const db = makeDb();
    upsertSourceCacheEntry(db, {
      sourceId: "seed",
      cacheKey: "k:1",
      fetchedAt: PAST,
      expiresAt: FUTURE,
      status: "ok",
      candidatesJson: JSON.stringify([
        { code: "A" },
        { code: "B" },
        { code: "C" },
      ]),
    });
    upsertSourceCacheEntry(db, {
      sourceId: "seed",
      cacheKey: "k:2",
      fetchedAt: PAST,
      expiresAt: FUTURE,
      status: "ok",
      candidatesJson: JSON.stringify([{ code: "D" }]),
    });
    const summary = getSourceStatusSummary(db, { now: NOW });
    const seed = summary.sources.find((s) => s.sourceId === "seed")!;
    expect(seed.cachedCandidateCount).toBe(4);
  });

  it("treats corrupt candidates_json as zero without throwing", () => {
    const db = makeDb();
    // Bypass the helper write validator to land a corrupt blob.
    db.prepare(
      `INSERT INTO source_cache
         (source_id, cache_key, fetched_at, expires_at, status,
          body_sha256, metadata_json, candidates_json)
         VALUES (?, ?, ?, ?, ?, NULL, NULL, ?)`,
    ).run("seed", "k:1", PAST, FUTURE, "ok", "{this is not json");
    expect(() => getSourceStatusSummary(db, { now: NOW })).not.toThrow();
    const summary = getSourceStatusSummary(db, { now: NOW });
    const seed = summary.sources.find((s) => s.sourceId === "seed")!;
    expect(seed.cachedCandidateCount).toBe(0);
  });
});

describe("getSourceStatusSummary — provider status callback", () => {
  it("respects the per-source providerStatus callback", () => {
    const db = makeDb();
    const providerStatus: ProviderStatusFn = (sourceId) => {
      if (sourceId === "seed") {
        return { featureEnabled: true, configured: true };
      }
      if (sourceId === "admin") {
        return { featureEnabled: true, configured: false };
      }
      return { featureEnabled: false, configured: false };
    };
    const summary = getSourceStatusSummary(db, { now: NOW, providerStatus });
    const seed = summary.sources.find((s) => s.sourceId === "seed")!;
    expect(seed.providerFeatureEnabled).toBe(true);
    expect(seed.providerConfigured).toBe(true);
    const admin = summary.sources.find((s) => s.sourceId === "admin")!;
    expect(admin.providerFeatureEnabled).toBe(true);
    expect(admin.providerConfigured).toBe(false);
    const imp = summary.sources.find((s) => s.sourceId === "import")!;
    expect(imp.providerFeatureEnabled).toBe(false);
    expect(imp.providerConfigured).toBe(false);
  });

  it("falls closed when providerStatus is not supplied", () => {
    const db = makeDb();
    const summary = getSourceStatusSummary(db, { now: NOW });
    for (const row of summary.sources) {
      expect(row.providerFeatureEnabled).toBe(false);
      expect(row.providerConfigured).toBe(false);
    }
  });

  it("drops configured when featureEnabled is false even if callback says true", () => {
    const db = makeDb();
    const providerStatus: ProviderStatusFn = () => ({
      featureEnabled: false,
      configured: true,
    });
    const summary = getSourceStatusSummary(db, { now: NOW, providerStatus });
    for (const row of summary.sources) {
      expect(row.providerFeatureEnabled).toBe(false);
      expect(row.providerConfigured).toBe(false);
    }
  });
});

describe("getSourceStatusSummary — redaction", () => {
  it("does not echo body_sha256, metadata_json, or candidates_json values", () => {
    const db = makeDb();
    upsertSourceCacheEntry(db, {
      sourceId: "seed",
      cacheKey: "k:1",
      fetchedAt: PAST,
      expiresAt: FUTURE,
      status: "ok",
      bodySha256:
        "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
      metadata: { offer_count: 7 },
      candidatesJson: JSON.stringify([{ code: "SECRET_CODE_PROBE" }]),
    });
    const summary = getSourceStatusSummary(db, { now: NOW });
    const serialized = JSON.stringify(summary);
    expect(serialized).not.toContain(
      "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
    );
    expect(serialized).not.toContain("SECRET_CODE_PROBE");
    expect(serialized).not.toContain("metadata_json");
    expect(serialized).not.toContain("body_sha256");
    expect(serialized).not.toContain("candidates_json");
  });

  it("never returns SALVARE_AWIN_API_KEY, Authorization, or DB-path markers", () => {
    const db = makeDb();
    const summary = getSourceStatusSummary(db, { now: NOW });
    const serialized = JSON.stringify(summary);
    expect(serialized).not.toContain("SALVARE_AWIN_API_KEY");
    expect(serialized).not.toContain("SALVARE_ADMIN_TOKEN");
    expect(serialized.toLowerCase()).not.toContain("authorization");
    expect(serialized.toLowerCase()).not.toContain("bearer");
    expect(serialized).not.toContain("dbPath");
  });

  it("drops malformed error_code values to null", () => {
    const db = makeDb();
    db.prepare(
      `INSERT INTO source_fetch_log
         (source_id, cache_key, attempted_at, outcome, status_code, error_code, duration_ms)
         VALUES (?, ?, ?, ?, NULL, ?, NULL)`,
    ).run("seed", "k:1", NOW, "error", "free form: oops!");
    const summary = getSourceStatusSummary(db, { now: NOW });
    const seed = summary.sources.find((s) => s.sourceId === "seed")!;
    expect(seed.lastFetchOutcome).toBe("error");
    expect(seed.lastSafeError).toBeNull();
  });
});

describe("getSourceStatusSummary — read-only", () => {
  it("does not change any table counts across repeated calls", () => {
    const db = makeDb();
    upsertSourceCacheEntry(db, {
      sourceId: "seed",
      cacheKey: "k:1",
      fetchedAt: PAST,
      expiresAt: FUTURE,
      status: "ok",
      candidatesJson: JSON.stringify([{ code: "A" }]),
    });
    recordSourceFetchAttempt(
      db,
      { sourceId: "seed", cacheKey: "k:1", outcome: "ok" },
      NOW,
    );
    const before = countTables(db);
    for (let i = 0; i < 5; i += 1) {
      getSourceStatusSummary(db, { now: NOW });
    }
    expect(countTables(db)).toEqual(before);
  });
});
