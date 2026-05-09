import { describe, it, expect } from "vitest";
import { openDatabase, type Db } from "./db";
import {
  canFetchSourceNow,
  getLastSourceFetch,
  getSourceCacheEntry,
  getSourceCacheSummary,
  pruneExpiredSourceCache,
  recordSourceFetchAttempt,
  upsertSourceCacheEntry,
} from "./db-source-cache";

function makeDb(): Db {
  return openDatabase(":memory:");
}

const T0 = "2026-05-09T12:00:00.000Z";
const T_PLUS_30S = "2026-05-09T12:00:30.000Z";
const T_PLUS_2M = "2026-05-09T12:02:00.000Z";
const T_PLUS_1H = "2026-05-09T13:00:00.000Z";
const T_PLUS_1H30M = "2026-05-09T13:30:00.000Z";

describe("recordSourceFetchAttempt", () => {
  it("inserts a fetch log row with normalized fields", () => {
    const db = makeDb();
    const row = recordSourceFetchAttempt(
      db,
      {
        sourceId: "seed",
        cacheKey: "shop.example/coupons",
        outcome: "ok",
        statusCode: 200,
        durationMs: 42,
      },
      T0,
    );
    expect(row.id).toBeGreaterThan(0);
    expect(row.sourceId).toBe("seed");
    expect(row.cacheKey).toBe("shop.example/coupons");
    expect(row.outcome).toBe("ok");
    expect(row.statusCode).toBe(200);
    expect(row.errorCode).toBeNull();
    expect(row.durationMs).toBe(42);
    expect(row.attemptedAt).toBe(T0);
  });

  it("rejects unknown source_id via FK constraint", () => {
    const db = makeDb();
    expect(() =>
      recordSourceFetchAttempt(
        db,
        { sourceId: "no-such-source", cacheKey: "k", outcome: "ok" },
        T0,
      ),
    ).toThrow();
  });

  it("rejects invalid cacheKey, outcome, statusCode, errorCode, durationMs", () => {
    const db = makeDb();
    expect(() =>
      recordSourceFetchAttempt(
        db,
        { sourceId: "seed", cacheKey: "BAD KEY", outcome: "ok" },
        T0,
      ),
    ).toThrow();
    expect(() =>
      recordSourceFetchAttempt(
        db,
        {
          sourceId: "seed",
          cacheKey: "k",
          outcome: "weird" as never,
        },
        T0,
      ),
    ).toThrow();
    expect(() =>
      recordSourceFetchAttempt(
        db,
        { sourceId: "seed", cacheKey: "k", outcome: "ok", statusCode: 9999 },
        T0,
      ),
    ).toThrow();
    expect(() =>
      recordSourceFetchAttempt(
        db,
        {
          sourceId: "seed",
          cacheKey: "k",
          outcome: "error",
          errorCode: "Network error: connection refused",
        },
        T0,
      ),
    ).toThrow();
    expect(() =>
      recordSourceFetchAttempt(
        db,
        {
          sourceId: "seed",
          cacheKey: "k",
          outcome: "ok",
          durationMs: -1,
        },
        T0,
      ),
    ).toThrow();
  });
});

describe("getLastSourceFetch", () => {
  it("returns the most recent attempt by attempted_at", () => {
    const db = makeDb();
    recordSourceFetchAttempt(
      db,
      { sourceId: "seed", cacheKey: "k", outcome: "ok" },
      T0,
    );
    recordSourceFetchAttempt(
      db,
      { sourceId: "seed", cacheKey: "k", outcome: "error" },
      T_PLUS_2M,
    );
    const last = getLastSourceFetch(db, "seed", "k");
    expect(last?.outcome).toBe("error");
    expect(last?.attemptedAt).toBe(T_PLUS_2M);
  });

  it("returns null when no attempts exist", () => {
    const db = makeDb();
    expect(getLastSourceFetch(db, "seed", "k")).toBeNull();
  });
});

describe("canFetchSourceNow", () => {
  it("blocks unknown sources with reason 'unknown_source'", () => {
    const db = makeDb();
    const decision = canFetchSourceNow(
      db,
      { sourceId: "no-such-source", cacheKey: "k", minIntervalMs: 60_000 },
      T0,
    );
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("unknown_source");
  });

  it("blocks within minIntervalMs after a recent attempt", () => {
    const db = makeDb();
    recordSourceFetchAttempt(
      db,
      { sourceId: "seed", cacheKey: "k", outcome: "ok" },
      T0,
    );
    const decision = canFetchSourceNow(
      db,
      { sourceId: "seed", cacheKey: "k", minIntervalMs: 60_000 },
      T_PLUS_30S,
    );
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("recent_attempt");
    expect(decision.retryAfterMs).toBe(30_000);
  });

  it("allows after the interval has elapsed", () => {
    const db = makeDb();
    recordSourceFetchAttempt(
      db,
      { sourceId: "seed", cacheKey: "k", outcome: "ok" },
      T0,
    );
    const decision = canFetchSourceNow(
      db,
      { sourceId: "seed", cacheKey: "k", minIntervalMs: 60_000 },
      T_PLUS_2M,
    );
    expect(decision.allowed).toBe(true);
    expect(decision.reason).toBeUndefined();
  });

  it("blocks while a fresh cache entry covers (source, key)", () => {
    const db = makeDb();
    upsertSourceCacheEntry(db, {
      sourceId: "seed",
      cacheKey: "k",
      fetchedAt: T0,
      expiresAt: T_PLUS_1H,
      status: "ok",
    });
    const decision = canFetchSourceNow(
      db,
      { sourceId: "seed", cacheKey: "k", minIntervalMs: 0 },
      T_PLUS_2M,
    );
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("cache_fresh");
    expect(decision.retryAfterMs).toBeGreaterThan(0);
  });

  it("ignores expired cache entries when deciding", () => {
    const db = makeDb();
    upsertSourceCacheEntry(db, {
      sourceId: "seed",
      cacheKey: "k",
      fetchedAt: T0,
      expiresAt: T_PLUS_2M,
      status: "ok",
    });
    const decision = canFetchSourceNow(
      db,
      { sourceId: "seed", cacheKey: "k", minIntervalMs: 0 },
      T_PLUS_1H,
    );
    expect(decision.allowed).toBe(true);
  });

  it("rejects negative or non-integer minIntervalMs", () => {
    const db = makeDb();
    expect(() =>
      canFetchSourceNow(
        db,
        { sourceId: "seed", cacheKey: "k", minIntervalMs: -1 },
        T0,
      ),
    ).toThrow();
    expect(() =>
      canFetchSourceNow(
        db,
        { sourceId: "seed", cacheKey: "k", minIntervalMs: 1.5 },
        T0,
      ),
    ).toThrow();
  });
});

describe("upsertSourceCacheEntry", () => {
  it("inserts and returns a normalized entry", () => {
    const db = makeDb();
    const entry = upsertSourceCacheEntry(db, {
      sourceId: "seed",
      cacheKey: "k",
      fetchedAt: T0,
      expiresAt: T_PLUS_1H,
      status: "ok",
      bodySha256: "a".repeat(64),
      metadata: { count: 3, kind: "feed", live: true, note: null },
    });
    expect(entry.sourceId).toBe("seed");
    expect(entry.status).toBe("ok");
    expect(entry.bodySha256).toBe("a".repeat(64));
    expect(entry.metadata).toEqual({
      count: 3,
      kind: "feed",
      live: true,
      note: null,
    });
  });

  it("updates an existing row on (source_id, cache_key) conflict", () => {
    const db = makeDb();
    upsertSourceCacheEntry(db, {
      sourceId: "seed",
      cacheKey: "k",
      fetchedAt: T0,
      expiresAt: T_PLUS_2M,
      status: "ok",
    });
    const updated = upsertSourceCacheEntry(db, {
      sourceId: "seed",
      cacheKey: "k",
      fetchedAt: T_PLUS_30S,
      expiresAt: T_PLUS_1H,
      status: "empty",
      bodySha256: "b".repeat(64),
    });
    expect(updated.status).toBe("empty");
    expect(updated.expiresAt).toBe(T_PLUS_1H);
    expect(updated.bodySha256).toBe("b".repeat(64));
    const count = (
      db
        .prepare(
          `SELECT COUNT(*) AS c FROM source_cache WHERE source_id = 'seed' AND cache_key = 'k'`,
        )
        .get() as { c: number }
    ).c;
    expect(count).toBe(1);
  });

  it("rejects bad sha256, oversized metadata, denylisted metadata keys", () => {
    const db = makeDb();
    expect(() =>
      upsertSourceCacheEntry(db, {
        sourceId: "seed",
        cacheKey: "k",
        fetchedAt: T0,
        expiresAt: T_PLUS_1H,
        status: "ok",
        bodySha256: "ZZZ",
      }),
    ).toThrow();
    const big = "x".repeat(201);
    expect(() =>
      upsertSourceCacheEntry(db, {
        sourceId: "seed",
        cacheKey: "k",
        fetchedAt: T0,
        expiresAt: T_PLUS_1H,
        status: "ok",
        metadata: { note: big },
      }),
    ).toThrow();
    for (const key of [
      "Authorization",
      "Cookie",
      "bearer",
      "token",
      "set-cookie",
      "session-id",
      "x-api-key",
    ]) {
      expect(() =>
        upsertSourceCacheEntry(db, {
          sourceId: "seed",
          cacheKey: "k",
          fetchedAt: T0,
          expiresAt: T_PLUS_1H,
          status: "ok",
          metadata: { [key.toLowerCase()]: "redacted" },
        }),
      ).toThrow();
    }
    expect(() =>
      upsertSourceCacheEntry(db, {
        sourceId: "seed",
        cacheKey: "k",
        fetchedAt: T0,
        expiresAt: T_PLUS_1H,
        status: "ok",
        metadata: { html: "<html>boom</html>".repeat(200) },
      }),
    ).toThrow();
  });

  it("rejects expiresAt earlier than fetchedAt", () => {
    const db = makeDb();
    expect(() =>
      upsertSourceCacheEntry(db, {
        sourceId: "seed",
        cacheKey: "k",
        fetchedAt: T_PLUS_1H,
        expiresAt: T0,
        status: "ok",
      }),
    ).toThrow();
  });

  it("rejects unknown source_id via FK", () => {
    const db = makeDb();
    expect(() =>
      upsertSourceCacheEntry(db, {
        sourceId: "no-such-source",
        cacheKey: "k",
        fetchedAt: T0,
        expiresAt: T_PLUS_1H,
        status: "ok",
      }),
    ).toThrow();
  });
});

describe("getSourceCacheEntry", () => {
  it("returns fresh=true while now < expiresAt", () => {
    const db = makeDb();
    upsertSourceCacheEntry(db, {
      sourceId: "seed",
      cacheKey: "k",
      fetchedAt: T0,
      expiresAt: T_PLUS_1H,
      status: "ok",
    });
    const lookup = getSourceCacheEntry(db, "seed", "k", T_PLUS_2M);
    expect(lookup?.fresh).toBe(true);
    expect(lookup?.expired).toBe(false);
  });

  it("returns expired=true once expiresAt <= now", () => {
    const db = makeDb();
    upsertSourceCacheEntry(db, {
      sourceId: "seed",
      cacheKey: "k",
      fetchedAt: T0,
      expiresAt: T_PLUS_2M,
      status: "ok",
    });
    const lookup = getSourceCacheEntry(db, "seed", "k", T_PLUS_1H);
    expect(lookup?.fresh).toBe(false);
    expect(lookup?.expired).toBe(true);
  });

  it("returns null when no row exists", () => {
    const db = makeDb();
    expect(getSourceCacheEntry(db, "seed", "k", T0)).toBeNull();
  });
});

describe("pruneExpiredSourceCache", () => {
  it("removes only rows where expires_at <= now", () => {
    const db = makeDb();
    upsertSourceCacheEntry(db, {
      sourceId: "seed",
      cacheKey: "fresh",
      fetchedAt: T0,
      expiresAt: T_PLUS_1H30M,
      status: "ok",
    });
    upsertSourceCacheEntry(db, {
      sourceId: "seed",
      cacheKey: "stale",
      fetchedAt: T0,
      expiresAt: T_PLUS_2M,
      status: "ok",
    });
    const result = pruneExpiredSourceCache(db, T_PLUS_1H);
    expect(result.deleted).toBe(1);
    const remaining = (
      db
        .prepare(`SELECT COUNT(*) AS c FROM source_cache`)
        .get() as { c: number }
    ).c;
    expect(remaining).toBe(1);
    expect(getSourceCacheEntry(db, "seed", "fresh", T_PLUS_1H)?.fresh).toBe(true);
  });
});

describe("getSourceCacheSummary", () => {
  it("rolls up totals/fresh/expired per source, including zero-use sources", () => {
    const db = makeDb();
    upsertSourceCacheEntry(db, {
      sourceId: "seed",
      cacheKey: "a",
      fetchedAt: T0,
      expiresAt: T_PLUS_1H30M,
      status: "ok",
    });
    upsertSourceCacheEntry(db, {
      sourceId: "seed",
      cacheKey: "b",
      fetchedAt: T0,
      expiresAt: T_PLUS_2M,
      status: "ok",
    });
    upsertSourceCacheEntry(db, {
      sourceId: "admin",
      cacheKey: "c",
      fetchedAt: T_PLUS_30S,
      expiresAt: T_PLUS_1H30M,
      status: "ok",
    });
    const summary = getSourceCacheSummary(db, T_PLUS_1H);
    const bySource = new Map(summary.map((s) => [s.sourceId, s]));
    expect(bySource.get("seed")?.total).toBe(2);
    expect(bySource.get("seed")?.fresh).toBe(1);
    expect(bySource.get("seed")?.expired).toBe(1);
    expect(bySource.get("admin")?.total).toBe(1);
    expect(bySource.get("admin")?.fresh).toBe(1);
    expect(bySource.get("admin")?.expired).toBe(0);
    expect(bySource.get("import")?.total).toBe(0);
    expect(bySource.get("import")?.lastFetchedAt).toBeNull();
  });
});

describe("redaction contract", () => {
  it("upsertSourceCacheEntry round-trip never echoes raw HTML, headers, env, paths", () => {
    const db = makeDb();
    const entry = upsertSourceCacheEntry(db, {
      sourceId: "seed",
      cacheKey: "k",
      fetchedAt: T0,
      expiresAt: T_PLUS_1H,
      status: "ok",
      bodySha256: "f".repeat(64),
      metadata: { kind: "feed", count: 7 },
    });
    const serialized = JSON.stringify(entry);
    expect(serialized).not.toContain("<html");
    expect(serialized).not.toContain("<!DOCTYPE");
    expect(serialized).not.toContain("Authorization");
    expect(serialized).not.toContain("Bearer ");
    expect(serialized).not.toContain("Cookie");
    expect(serialized).not.toContain("Set-Cookie");
    expect(serialized).not.toContain("SALVARE_");
    expect(serialized).not.toContain("/etc/");
  });

  it("recordSourceFetchAttempt output never includes secrets or payloads", () => {
    const db = makeDb();
    const row = recordSourceFetchAttempt(
      db,
      {
        sourceId: "seed",
        cacheKey: "k",
        outcome: "error",
        statusCode: 500,
        errorCode: "timeout",
        durationMs: 1234,
      },
      T0,
    );
    const serialized = JSON.stringify(row);
    expect(serialized).not.toContain("Authorization");
    expect(serialized).not.toContain("Bearer ");
    expect(serialized).not.toContain("Cookie");
    expect(serialized).not.toContain("SALVARE_");
    expect(serialized).not.toContain("/etc/");
    expect(serialized).not.toContain("<html");
  });

  it("getSourceCacheSummary output never leaks paths, env, or auth-shaped fields", () => {
    const db = makeDb();
    upsertSourceCacheEntry(db, {
      sourceId: "seed",
      cacheKey: "k",
      fetchedAt: T0,
      expiresAt: T_PLUS_1H,
      status: "ok",
    });
    const summary = getSourceCacheSummary(db, T_PLUS_2M);
    const serialized = JSON.stringify(summary);
    expect(serialized).not.toContain("Authorization");
    expect(serialized).not.toContain("Bearer ");
    expect(serialized).not.toContain("Cookie");
    expect(serialized).not.toContain("SALVARE_");
    expect(serialized).not.toContain("/etc/");
  });
});
