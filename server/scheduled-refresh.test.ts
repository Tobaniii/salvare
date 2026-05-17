// v0.52.0 — scheduled source-refresh loop tests.
//
// Mirrors the source-refresh.test.ts harness: in-memory SQLite, committed
// JSON fixtures, an injectable clock AND an injectable timer. NO live HTTP,
// NO real setInterval, NO wall-clock waits.

import { describe, it, expect } from "vitest";
import { openDatabase, type Db } from "./db";
import { runSourceRefresh } from "./source-refresh";
import { importProviderCandidates } from "./db-source-import";
import { recordSourceFetchAttempt } from "./db-source-cache";
import { createProviderRegistry } from "./source-provider-registry";
import type { AwinAdapterClock, AwinFetcher } from "./source-provider-awin";
import { createManualTimer } from "./scheduled-timer";
import {
  readScheduledRefreshConfig,
  runScheduledRefreshTick,
  startScheduledRefresh,
  DEFAULT_SCHEDULED_INTERVAL_MS,
} from "./scheduled-refresh";

const API_KEY = "secret-key-shhh";
const T0 = Date.parse("2026-05-14T12:00:00.000Z");

function makeDb(): Db {
  return openDatabase(":memory:");
}

function clockAt(ms: number): AwinAdapterClock {
  return { nowIso: () => new Date(ms).toISOString(), nowMs: () => ms };
}

function providerEnv(): NodeJS.ProcessEnv {
  return {
    SALVARE_SOURCE_PROVIDER_ENABLED: "true",
    SALVARE_SOURCE_PROVIDER: "awin",
    SALVARE_AWIN_API_KEY: API_KEY,
    SALVARE_AWIN_PUBLISHER_ID: "pub-42",
  };
}

function loadOkFixture(): string {
  // shop.example → AWIN10, FREESHIP ; other.example → OTHER15
  return JSON.stringify({
    offers: [
      {
        merchantUrl: "https://shop.example/",
        code: "AWIN10",
        promotionType: "voucher",
        title: "10% off",
        endDate: "2026-12-31",
      },
      {
        merchantUrl: "https://shop.example/",
        voucherCode: "FREESHIP",
        promotionType: "voucher_code",
        description: "Free shipping",
        validTo: "2026-09-30T23:59:59Z",
      },
    ],
  });
}

function okFetcher(): AwinFetcher {
  const body = loadOkFixture();
  return async () => ({ status: 200, body });
}

function trapFetcher(): AwinFetcher {
  return async () => {
    throw new Error("fetcher must not be called");
  };
}

/** Seed provenance only (no source_cache / source_fetch_log) so the domain is
 *  returned by listProviderProvenanceDomains and canFetchSourceNow is ALLOWED. */
function seedProvenance(
  db: Db,
  domain: string,
  sourceId = "awin",
  code = "SEED1",
): void {
  importProviderCandidates(db, {
    sourceId,
    sourceName: sourceId === "awin" ? "Awin" : "impact.com Promotions API",
    sourceType: "api",
    domain,
    candidates: [{ domain, code }],
  });
}

function counts(db: Db): {
  coupons: number;
  results: number;
  awinProvenance: number;
} {
  const n = (sql: string): number =>
    (db.prepare(sql).get() as { n: number }).n;
  return {
    coupons: n("SELECT COUNT(*) AS n FROM coupon_codes"),
    results: n("SELECT COUNT(*) AS n FROM coupon_results"),
    awinProvenance: n(
      "SELECT COUNT(*) AS n FROM coupon_code_sources WHERE source_id = 'awin'",
    ),
  };
}

function fetchLogRows(db: Db, sourceId: string): number {
  return (
    db
      .prepare(
        "SELECT COUNT(*) AS n FROM source_fetch_log WHERE source_id = ?",
      )
      .get(sourceId) as { n: number }
  ).n;
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) {
    await new Promise((r) => setImmediate(r));
  }
};

// --------------------------------------------------------------------------
describe("readScheduledRefreshConfig", () => {
  it("1. unset enable → flag_off", () => {
    expect(readScheduledRefreshConfig({})).toEqual({
      enabled: false,
      reason: "flag_off",
    });
  });

  it("2. enable must be exactly \"true\" (\"1\" → flag_off)", () => {
    expect(
      readScheduledRefreshConfig({ SALVARE_SCHEDULED_REFRESH_ENABLED: "1" }),
    ).toEqual({ enabled: false, reason: "flag_off" });
    expect(
      readScheduledRefreshConfig({ SALVARE_SCHEDULED_REFRESH_ENABLED: "TRUE" }),
    ).toEqual({ enabled: false, reason: "flag_off" });
  });

  it("3. enabled, no interval → default 6h", () => {
    expect(
      readScheduledRefreshConfig({ SALVARE_SCHEDULED_REFRESH_ENABLED: "true" }),
    ).toEqual({ enabled: true, intervalMs: DEFAULT_SCHEDULED_INTERVAL_MS });
  });

  it("4. enabled, non-numeric interval → interval_invalid", () => {
    expect(
      readScheduledRefreshConfig({
        SALVARE_SCHEDULED_REFRESH_ENABLED: "true",
        SALVARE_SCHEDULED_REFRESH_INTERVAL_MS: "abc",
      }),
    ).toEqual({ enabled: false, reason: "interval_invalid" });
  });

  it("5. enabled, 0 / -5 interval → interval_invalid", () => {
    for (const v of ["0", "-5", "12.5", "1e9"]) {
      expect(
        readScheduledRefreshConfig({
          SALVARE_SCHEDULED_REFRESH_ENABLED: "true",
          SALVARE_SCHEDULED_REFRESH_INTERVAL_MS: v,
        }),
      ).toEqual({ enabled: false, reason: "interval_invalid" });
    }
  });

  it("6. enabled, below 6h floor → clamped up to 6h", () => {
    expect(
      readScheduledRefreshConfig({
        SALVARE_SCHEDULED_REFRESH_ENABLED: "true",
        SALVARE_SCHEDULED_REFRESH_INTERVAL_MS: "60000",
      }),
    ).toEqual({ enabled: true, intervalMs: DEFAULT_SCHEDULED_INTERVAL_MS });
  });

  it("7. enabled, above floor (12h) preserved", () => {
    expect(
      readScheduledRefreshConfig({
        SALVARE_SCHEDULED_REFRESH_ENABLED: "true",
        SALVARE_SCHEDULED_REFRESH_INTERVAL_MS: "43200000",
      }),
    ).toEqual({ enabled: true, intervalMs: 43_200_000 });
  });
});

// --------------------------------------------------------------------------
describe("runScheduledRefreshTick", () => {
  const tickDeps = (
    db: Db,
    env: NodeJS.ProcessEnv,
    fetcher: AwinFetcher,
    clock: AwinAdapterClock,
    extra: Partial<Parameters<typeof runScheduledRefreshTick>[0]> = {},
  ): Parameters<typeof runScheduledRefreshTick>[0] => ({
    db,
    env,
    fetcher,
    clock,
    intervalMs: DEFAULT_SCHEDULED_INTERVAL_MS,
    inFlight: new Set<string>(),
    ...extra,
  });

  it("8. provider-disabled env → no-op (no fetch log, attempted 0)", async () => {
    const db = makeDb();
    seedProvenance(db, "shop.example");
    const before = counts(db);
    const beforeLog = fetchLogRows(db, "awin");
    const report = await runScheduledRefreshTick(
      tickDeps(db, {}, trapFetcher(), clockAt(T0)),
    );
    expect(report.attempted).toBe(0);
    expect(counts(db)).toEqual(before);
    expect(fetchLogRows(db, "awin")).toBe(beforeLog);
  });

  it("9. enabled + seeded domain → imports, results stay 0", async () => {
    const db = makeDb();
    seedProvenance(db, "shop.example");
    const report = await runScheduledRefreshTick(
      tickDeps(db, providerEnv(), okFetcher(), clockAt(T0)),
    );
    expect(report.attempted).toBeGreaterThanOrEqual(1);
    expect(report.perDomain.some((d) => d.result === "ran")).toBe(true);
    const c = counts(db);
    expect(c.coupons).toBeGreaterThan(0);
    expect(c.awinProvenance).toBeGreaterThan(0);
    expect(c.results).toBe(0);
  });

  it("10. skip cache_fresh — second tick does not call fetcher", async () => {
    const db = makeDb();
    seedProvenance(db, "shop.example");
    const first = await runScheduledRefreshTick(
      tickDeps(db, providerEnv(), okFetcher(), clockAt(T0)),
    );
    expect(first.attempted).toBeGreaterThanOrEqual(1);
    const before = counts(db);
    const second = await runScheduledRefreshTick(
      tickDeps(db, providerEnv(), trapFetcher(), clockAt(T0)),
    );
    expect(second.attempted).toBe(0);
    expect(second.skipped).toBeGreaterThanOrEqual(1);
    expect(
      second.perDomain.some((d) => d.reason === "cache_fresh"),
    ).toBe(true);
    expect(counts(db)).toEqual(before);
  });

  it("11. skip recent_attempt — recent log row blocks the tick", async () => {
    const db = makeDb();
    seedProvenance(db, "shop.example");
    recordSourceFetchAttempt(
      db,
      {
        sourceId: "awin",
        cacheKey: "merchant:shop.example",
        outcome: "ok",
        attemptedAt: new Date(T0).toISOString(),
      },
      new Date(T0).toISOString(),
    );
    const report = await runScheduledRefreshTick(
      tickDeps(db, providerEnv(), trapFetcher(), clockAt(T0 + 1000)),
    );
    expect(report.attempted).toBe(0);
    expect(
      report.perDomain.some((d) => d.reason === "recent_attempt"),
    ).toBe(true);
  });

  it("12. unknown_source — silent skip, no throw, no log row", async () => {
    const db = makeDb();
    seedProvenance(db, "shop.example");
    // Provenance implies the source row exists (FK ON DELETE RESTRICT makes
    // unknown_source structurally unreachable via the loop). Force the branch
    // with foreign_keys OFF so the scheduler's handling is still exercised.
    db.pragma("foreign_keys = OFF");
    db.prepare("DELETE FROM coupon_sources WHERE id = 'awin'").run();
    db.pragma("foreign_keys = ON");
    const beforeLog = fetchLogRows(db, "awin");
    const report = await runScheduledRefreshTick(
      tickDeps(db, providerEnv(), trapFetcher(), clockAt(T0)),
    );
    expect(report.errored).toBe(0);
    expect(
      report.perDomain.some((d) => d.reason === "unknown_source"),
    ).toBe(true);
    expect(fetchLogRows(db, "awin")).toBe(beforeLog);
  });

  it("13. impact is never scheduled (flag-driven eligibility)", async () => {
    const eligible = createProviderRegistry()
      .list()
      .filter(
        (d) =>
          d.activation.enabled === true &&
          d.activation.schedulerSupported === true,
      )
      .map((d) => d.providerId);
    expect(eligible).toEqual(["awin"]);

    const db = makeDb();
    seedProvenance(db, "impactonly.example", "impact");
    const report = await runScheduledRefreshTick(
      tickDeps(db, providerEnv(), okFetcher(), clockAt(T0)),
    );
    expect(report.perDomain.every((d) => d.provider === "awin")).toBe(true);
    expect(fetchLogRows(db, "impact")).toBe(0);
  });

  it("14. single-flight — in-flight pair is skipped, fetcher not called", async () => {
    const db = makeDb();
    seedProvenance(db, "shop.example");
    const inFlight = new Set<string>(["awin|shop.example"]);
    const report = await runScheduledRefreshTick(
      tickDeps(db, providerEnv(), trapFetcher(), clockAt(T0), { inFlight }),
    );
    expect(report.attempted).toBe(0);
    expect(report.perDomain).toEqual([
      {
        provider: "awin",
        domain: "shop.example",
        result: "skipped",
        reason: "in_flight",
      },
    ]);
  });

  it("15. idempotent repeat — second tick imports 0 net new rows", async () => {
    const db = makeDb();
    seedProvenance(db, "shop.example");
    await runScheduledRefreshTick(
      tickDeps(db, providerEnv(), okFetcher(), clockAt(T0)),
    );
    const afterFirst = counts(db);
    const later = T0 + DEFAULT_SCHEDULED_INTERVAL_MS + 1;
    const second = await runScheduledRefreshTick(
      tickDeps(db, providerEnv(), okFetcher(), clockAt(later)),
    );
    expect(second.attempted).toBeGreaterThanOrEqual(1);
    expect(counts(db)).toEqual(afterFirst);
    expect(afterFirst.results).toBe(0);
  });

  it("16. injected clock drives the persisted attempted_at", async () => {
    const db = makeDb();
    seedProvenance(db, "shop.example");
    const M = Date.parse("2026-07-01T08:30:00.000Z");
    await runScheduledRefreshTick(
      tickDeps(db, providerEnv(), okFetcher(), clockAt(M)),
    );
    const row = db
      .prepare(
        `SELECT attempted_at FROM source_fetch_log
           WHERE source_id = 'awin'
           ORDER BY id DESC LIMIT 1`,
      )
      .get() as { attempted_at: string };
    expect(row.attempted_at).toBe(new Date(M).toISOString());
  });

  it("17. error isolation — one domain fails, the other still imports", async () => {
    const db = makeDb();
    seedProvenance(db, "aaa.example");
    seedProvenance(db, "shop.example");
    const okBody = loadOkFixture();
    const fetcher: AwinFetcher = async (url) =>
      url.includes("aaa.example")
        ? { status: 503, body: "{}" }
        : { status: 200, body: okBody };
    const report = await runScheduledRefreshTick(
      tickDeps(db, providerEnv(), fetcher, clockAt(T0)),
    );
    const aaa = report.perDomain.find((d) => d.domain === "aaa.example");
    const shop = report.perDomain.find((d) => d.domain === "shop.example");
    expect(aaa?.result).toBe("error");
    expect(shop?.result).toBe("ran");
    expect(report.attempted).toBe(1);
    expect(report.errored).toBe(1);
    expect(counts(db).coupons).toBeGreaterThan(0);
  });

  it("18. no secrets in the TickReport", async () => {
    const db = makeDb();
    seedProvenance(db, "aaa.example");
    const fetcher: AwinFetcher = async () => ({ status: 503, body: "{}" });
    const report = await runScheduledRefreshTick(
      tickDeps(db, providerEnv(), fetcher, clockAt(T0)),
    );
    const text = JSON.stringify(report);
    expect(text).not.toContain(API_KEY);
    expect(text.toLowerCase()).not.toContain("authorization");
    expect(text.toLowerCase()).not.toContain("bearer");
    expect(text).not.toContain("SALVARE_AWIN_API_KEY");
    expect(text).not.toMatch(/awin1\.com/);
  });

  it("18a. cacheKey gate-sync — scheduler key == pipeline-persisted key", async () => {
    const db = makeDb();
    const D = "shop.example";
    seedProvenance(db, D);
    // Real pipeline import writes source_cache + source_fetch_log keyed by
    // the pipeline's own makeCacheKey (firewall, not exported here).
    const res = await runSourceRefresh(
      { provider: "awin", domain: D, import: true, confirm: "IMPORT" },
      {
        db,
        env: providerEnv(),
        fetcher: okFetcher(),
        clock: clockAt(T0),
      },
    );
    expect(res.exitCode).toBe(0);
    const cacheKey = (
      db
        .prepare(
          "SELECT cache_key FROM source_cache WHERE source_id = 'awin'",
        )
        .get() as { cache_key: string }
    ).cache_key;
    const logKey = (
      db
        .prepare(
          `SELECT cache_key FROM source_fetch_log
             WHERE source_id = 'awin' ORDER BY id DESC LIMIT 1`,
        )
        .get() as { cache_key: string }
    ).cache_key;
    // Pipeline is internally self-consistent (cache + log share one key).
    expect(cacheKey).toBe(logKey);
    // Behavioral byte-equality proof: a scheduler tick over the SAME domain
    // at the same instant must skip with `cache_fresh`. That can only happen
    // if the scheduler's computed cacheKey finds the pipeline-written row,
    // i.e. the two keys are byte-equal. A mismatch would miss both the cache
    // AND the log row → ALLOWED → trapFetcher throws → this test fails.
    const report = await runScheduledRefreshTick(
      tickDeps(db, providerEnv(), trapFetcher(), clockAt(T0)),
    );
    expect(report.attempted).toBe(0);
    expect(
      report.perDomain.some(
        (d) => d.domain === D && d.reason === "cache_fresh",
      ),
    ).toBe(true);
  });
});

// --------------------------------------------------------------------------
describe("scheduled-timer", () => {
  it("19. manual timer: schedule records, tick fires, stop halts", () => {
    const t = createManualTimer();
    let fired = 0;
    const handle = t.schedule(123, () => {
      fired += 1;
    });
    expect(t.scheduleCalls).toBe(1);
    expect(t.lastIntervalMs).toBe(123);
    t.tick();
    t.tick();
    expect(fired).toBe(2);
    handle.stop();
    t.tick();
    expect(fired).toBe(2);
  });

  it("20. real timer: stop() is idempotent and does not throw", async () => {
    const { createRealTimer } = await import("./scheduled-timer");
    const handle = createRealTimer().schedule(60_000, () => {});
    expect(() => {
      handle.stop();
      handle.stop();
    }).not.toThrow();
  });
});

// --------------------------------------------------------------------------
describe("startScheduledRefresh", () => {
  it("21. disabled env → no-op handle, timer never scheduled", () => {
    const db = makeDb();
    const timer = createManualTimer();
    const handle = startScheduledRefresh({
      db,
      env: { ...providerEnv() },
      timer,
      fetcher: trapFetcher(),
    });
    expect(timer.scheduleCalls).toBe(0);
    expect(() => handle.stop()).not.toThrow();
  });

  it("22. enabled env → schedules once at clamped interval; tick imports", async () => {
    const db = makeDb();
    seedProvenance(db, "shop.example");
    const timer = createManualTimer();
    const handle = startScheduledRefresh({
      db,
      env: { ...providerEnv(), SALVARE_SCHEDULED_REFRESH_ENABLED: "true" },
      timer,
      fetcher: okFetcher(),
      clock: clockAt(T0),
    });
    expect(timer.scheduleCalls).toBe(1);
    expect(timer.lastIntervalMs).toBe(DEFAULT_SCHEDULED_INTERVAL_MS);
    timer.tick();
    await flush();
    expect(counts(db).coupons).toBeGreaterThan(0);
    handle.stop();
  });

  it("23. re-entrancy — a slow tick cannot overlap the next", async () => {
    const db = makeDb();
    seedProvenance(db, "shop.example");
    const timer = createManualTimer();
    let release!: () => void;
    let fetchCalls = 0;
    const blockingFetcher: AwinFetcher = () => {
      fetchCalls += 1;
      return new Promise((resolve) => {
        release = () =>
          resolve({ status: 200, body: loadOkFixture() });
      });
    };
    const handle = startScheduledRefresh({
      db,
      env: { ...providerEnv(), SALVARE_SCHEDULED_REFRESH_ENABLED: "true" },
      timer,
      fetcher: blockingFetcher,
      clock: clockAt(T0),
    });
    timer.tick(); // starts tick #1 — runRefresh awaits blockingFetcher
    await flush();
    timer.tick(); // tick #2 must be a no-op (running guard)
    await flush();
    expect(fetchCalls).toBe(1);
    release();
    await flush();
    handle.stop();
  });
});
