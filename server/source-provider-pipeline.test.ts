// Characterization pins for the v0.47.0 shared-pipeline refactor.
//
// These tests are written and GREEN against the PRE-refactor adapters
// (Awin v0.33 with cache-read short-circuit, Impact v0.42 without one).
// They MUST stay byte-identical and green through the extraction of
// `runProviderPipeline`. They pin the highest-regression-risk surface:
// Awin's live, user-exposed cache-fresh-hit path and early returns, plus
// a golden full-result for both providers.
//
// The pinned field list is identical for both providers:
//   ok, providerId, sourceId, outcome, errorCode, candidates[],
//   errors[], fetched, cacheHit, durationMs(type).
// Impact's pre-refactor result omits `cacheHit`; the `r.cacheHit ?? false`
// normalization keeps the pin refactor-invariant (undefined -> false
// before, explicit false after).

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { openDatabase, type Db } from "./db";
import {
  runProviderPipeline,
  type ProviderPipelineSpec,
} from "./source-provider-pipeline";
import {
  createAwinAdapter,
  type AwinFetcher,
  type AwinAdapterClock,
} from "./source-provider-awin";
import {
  createImpactAdapter,
  type ImpactFetcher,
  type ImpactAdapterClock,
} from "./source-provider-impact";
import type { AwinProviderConfig, ImpactProviderConfig } from "./source-provider-config";
import type {
  ProviderAdapterResult,
  SourceAdapterCandidate,
} from "./source-provider-types";

// --- deterministic clocks (independent per adapter instance) -------------

const AWIN_NOW_MS = Date.parse("2026-05-11T12:00:00.000Z");
const IMPACT_NOW_MS = Date.parse("2026-05-15T12:00:00.000Z");

// `nowMs` increments the call counter; `nowIso` does not. The single
// `nowMs()` call at adapter entry (`startedMs`) is the only increment
// before candidate construction, so every candidate's `discoveredAt`
// is `NOW_MS + 1`. Pinning this exact value locks the clock-call order
// the refactor must preserve.
const AWIN_DISCOVERED_AT = new Date(AWIN_NOW_MS + 1).toISOString();
const IMPACT_DISCOVERED_AT = new Date(IMPACT_NOW_MS + 1).toISOString();

function awinClock(): AwinAdapterClock {
  let calls = 0;
  return {
    nowIso: () => new Date(AWIN_NOW_MS + calls).toISOString(),
    nowMs: () => AWIN_NOW_MS + calls++,
  };
}

function impactClock(): ImpactAdapterClock {
  let calls = 0;
  return {
    nowIso: () => new Date(IMPACT_NOW_MS + calls).toISOString(),
    nowMs: () => IMPACT_NOW_MS + calls++,
  };
}

function loadFixture(name: string): string {
  const url = new URL(`./fixtures/${name}`, import.meta.url);
  return readFileSync(fileURLToPath(url), "utf8");
}

function makeDb(): Db {
  return openDatabase(":memory:");
}

function awinConfig(overrides: Partial<AwinProviderConfig> = {}): AwinProviderConfig {
  return {
    enabled: true,
    providerId: "awin",
    apiKey: "secret-key-shhh",
    publisherId: "pub-42",
    ...overrides,
  };
}

function impactConfig(
  overrides: Partial<ImpactProviderConfig> = {},
): ImpactProviderConfig {
  return {
    enabled: true,
    providerId: "impact",
    apiKey: "fake-impact-key-not-real",
    accountSid: "FAKE-ACCOUNT-SID-NOT-REAL",
    ...overrides,
  };
}

function countingAwinFetcher(body: string, status = 200) {
  const state = { calls: 0 };
  const fetcher: AwinFetcher = async () => {
    state.calls += 1;
    return { status, body };
  };
  return { fetcher, state };
}

function countingImpactFetcher(body: string, status = 200) {
  const state = { calls: 0 };
  const fetcher: ImpactFetcher = async () => {
    state.calls += 1;
    return { status, body };
  };
  return { fetcher, state };
}

// --- normalized pin shape -------------------------------------------------

interface Pinned {
  ok: boolean;
  providerId: string;
  sourceId: string;
  outcome: string;
  errorCode: string | undefined;
  candidates: SourceAdapterCandidate[];
  errors: ProviderAdapterResult["errors"];
  fetched: boolean;
  cacheHit: boolean;
  durationMsIsNumber: boolean;
}

function pin(r: ProviderAdapterResult): Pinned {
  return {
    ok: r.ok,
    providerId: r.providerId,
    sourceId: r.sourceId,
    outcome: r.outcome,
    errorCode: r.errorCode,
    candidates: r.candidates,
    errors: r.errors,
    fetched: r.fetched,
    cacheHit: r.cacheHit ?? false,
    durationMsIsNumber: typeof r.durationMs === "number",
  };
}

const AWIN_GOLDEN_CANDIDATES: SourceAdapterCandidate[] = [
  {
    domain: "shop.example",
    code: "AWIN10",
    sourceId: "awin",
    discoveredAt: AWIN_DISCOVERED_AT,
    label: "10% off your first order",
    expiresAt: "2026-12-31",
  },
  {
    domain: "shop.example",
    code: "FREESHIP",
    sourceId: "awin",
    discoveredAt: AWIN_DISCOVERED_AT,
    label: "Free shipping over $50",
    expiresAt: "2026-09-30T23:59:59Z",
  },
  {
    domain: "other.example",
    code: "OTHER15",
    sourceId: "awin",
    discoveredAt: AWIN_DISCOVERED_AT,
    label: "15% off everything",
    expiresAt: "2026-08-15",
  },
];

const IMPACT_GOLDEN_CANDIDATES: SourceAdapterCandidate[] = [
  {
    domain: "shop.example",
    code: "IMPACT10",
    sourceId: "impact",
    discoveredAt: IMPACT_DISCOVERED_AT,
    label: "10% off your first order",
    expiresAt: "2026-12-31",
  },
  {
    domain: "shop.example",
    code: "FREESHIP",
    sourceId: "impact",
    discoveredAt: IMPACT_DISCOVERED_AT,
    label: "Free shipping over $50",
    expiresAt: "2026-09-30T23:59:59Z",
  },
  {
    domain: "other.example",
    code: "OTHER15",
    sourceId: "impact",
    discoveredAt: IMPACT_DISCOVERED_AT,
    label: "15% off everything",
    expiresAt: "2026-08-15",
  },
];

// --- (a) Awin cache-fresh HIT --------------------------------------------

describe("characterization — Awin cache-fresh HIT (highest risk)", () => {
  async function primeCache(db: Db): Promise<void> {
    const { fetcher } = countingAwinFetcher(loadFixture("awin-offers-ok.json"));
    const adapter = createAwinAdapter({
      config: awinConfig(),
      fetcher,
      db,
      clock: awinClock(),
    });
    await adapter.fetchAndParse({ domain: "shop.example" });
  }

  it("returns cached candidates, no HTTP, single cache_hit log row", async () => {
    const db = makeDb();
    await primeCache(db);

    const cacheBefore = (
      db.prepare("SELECT COUNT(*) AS n FROM source_cache").get() as { n: number }
    ).n;
    const logBefore = (
      db.prepare("SELECT COUNT(*) AS n FROM source_fetch_log").get() as {
        n: number;
      }
    ).n;

    const { fetcher, state } = countingAwinFetcher("{}");
    const adapter = createAwinAdapter({
      config: awinConfig(),
      fetcher,
      db,
      clock: awinClock(),
    });
    const result = await adapter.fetchAndParse({ domain: "shop.example" });

    expect(state.calls).toBe(0); // no HTTP issued
    expect(pin(result)).toEqual({
      ok: true,
      providerId: "awin",
      sourceId: "awin",
      outcome: "cache_hit",
      errorCode: undefined,
      candidates: AWIN_GOLDEN_CANDIDATES,
      errors: [],
      fetched: false,
      cacheHit: true,
      durationMsIsNumber: true,
    });

    const cacheAfter = (
      db.prepare("SELECT COUNT(*) AS n FROM source_cache").get() as { n: number }
    ).n;
    expect(cacheAfter).toBe(cacheBefore); // no new cache row

    const log = db
      .prepare(
        "SELECT outcome, status_code, error_code FROM source_fetch_log ORDER BY id ASC",
      )
      .all() as Array<{
      outcome: string;
      status_code: number | null;
      error_code: string | null;
    }>;
    expect(log).toHaveLength(logBefore + 1);
    const hit = log[log.length - 1];
    expect(hit.outcome).toBe("cache_hit");
    expect(hit.status_code).toBeNull();
    expect(hit.error_code).toBeNull();
  });
});

// --- (b) Awin cache-MISS full fetch (normal happy path) ------------------

describe("characterization — Awin cache-MISS full fetch", () => {
  it("fetches, pins golden result, writes one cache row", async () => {
    const db = makeDb();
    const { fetcher, state } = countingAwinFetcher(
      loadFixture("awin-offers-ok.json"),
    );
    const adapter = createAwinAdapter({
      config: awinConfig(),
      fetcher,
      db,
      clock: awinClock(),
    });
    const result = await adapter.fetchAndParse({ domain: "shop.example" });

    expect(state.calls).toBe(1);
    expect(pin(result)).toEqual({
      ok: true,
      providerId: "awin",
      sourceId: "awin",
      outcome: "ok",
      errorCode: undefined,
      candidates: AWIN_GOLDEN_CANDIDATES,
      errors: [],
      fetched: true,
      cacheHit: false,
      durationMsIsNumber: true,
    });

    const cacheCount = (
      db.prepare("SELECT COUNT(*) AS n FROM source_cache").get() as { n: number }
    ).n;
    expect(cacheCount).toBe(1);
  });
});

// --- (c) Awin early returns ----------------------------------------------

describe("characterization — Awin early returns", () => {
  it("disabled: errorCode=disabled, durationMs=0, no fetch/log/cache", async () => {
    const db = makeDb();
    const { fetcher, state } = countingAwinFetcher("{}");
    const adapter = createAwinAdapter({
      config: { enabled: false, reason: "flag_off" } as unknown as AwinProviderConfig,
      fetcher,
      db,
      clock: awinClock(),
    });
    const result = await adapter.fetchAndParse({ domain: "shop.example" });

    expect(state.calls).toBe(0);
    expect(pin(result)).toEqual({
      ok: false,
      providerId: "awin",
      sourceId: "awin",
      outcome: "error",
      errorCode: "disabled",
      candidates: [],
      errors: [],
      fetched: false,
      cacheHit: false,
      durationMsIsNumber: true,
    });
    expect(result.durationMs).toBe(0);
    expect(
      (db.prepare("SELECT COUNT(*) AS n FROM source_fetch_log").get() as {
        n: number;
      }).n,
    ).toBe(0);
    expect(
      (db.prepare("SELECT COUNT(*) AS n FROM source_cache").get() as {
        n: number;
      }).n,
    ).toBe(0);
  });

  it("missing_api_key: errorCode=missing_api_key, durationMs=0, no fetch", async () => {
    const db = makeDb();
    const { fetcher, state } = countingAwinFetcher("{}");
    const adapter = createAwinAdapter({
      config: awinConfig({ apiKey: "" }),
      fetcher,
      db,
      clock: awinClock(),
    });
    const result = await adapter.fetchAndParse({ domain: "shop.example" });

    expect(state.calls).toBe(0);
    expect(pin(result)).toEqual({
      ok: false,
      providerId: "awin",
      sourceId: "awin",
      outcome: "error",
      errorCode: "missing_api_key",
      candidates: [],
      errors: [],
      fetched: false,
      cacheHit: false,
      durationMsIsNumber: true,
    });
    expect(result.durationMs).toBe(0);
  });

  it("invalid domain: errorCode=parse_error, durationMs=0, no fetch", async () => {
    const db = makeDb();
    const { fetcher, state } = countingAwinFetcher("{}");
    const adapter = createAwinAdapter({
      config: awinConfig(),
      fetcher,
      db,
      clock: awinClock(),
    });
    const result = await adapter.fetchAndParse({ domain: "  " });

    expect(state.calls).toBe(0);
    expect(pin(result)).toEqual({
      ok: false,
      providerId: "awin",
      sourceId: "awin",
      outcome: "error",
      errorCode: "parse_error",
      candidates: [],
      errors: [],
      fetched: false,
      cacheHit: false,
      durationMsIsNumber: true,
    });
    expect(result.durationMs).toBe(0);
  });
});

// --- Impact golden full-result pin ---------------------------------------

describe("characterization — Impact golden full-result", () => {
  it("pins the Impact happy-path result (cacheHit ?? false invariant)", async () => {
    const db = makeDb();
    const { fetcher, state } = countingImpactFetcher(
      loadFixture("impact-offers-ok.json"),
    );
    const adapter = createImpactAdapter({
      config: impactConfig(),
      fetcher,
      db,
      clock: impactClock(),
    });
    const result = await adapter.fetchAndParse({ domain: "shop.example" });

    expect(state.calls).toBe(1);
    expect(pin(result)).toEqual({
      ok: true,
      providerId: "impact",
      sourceId: "impact",
      outcome: "ok",
      errorCode: undefined,
      candidates: IMPACT_GOLDEN_CANDIDATES,
      errors: [],
      fetched: true,
      cacheHit: false,
      durationMsIsNumber: true,
    });
  });
});

// --- pipeline contract tests ---------------------------------------------

const ROWS_BODY = JSON.stringify({
  rows: [{ domain: "shop.example", code: "PIPE10" }],
});

function baseSpec(
  overrides: Partial<ProviderPipelineSpec> = {},
): ProviderPipelineSpec {
  return {
    providerId: "awin",
    sourceId: "awin",
    sourceName: "Awin Offers API",
    sourceType: "api",
    cacheSupported: true,
    config: { enabled: true, apiKey: "pipe-key" },
    buildUrl: () => "https://provider.test/x",
    extractEnvelope: (p) =>
      p !== null && typeof p === "object" && Array.isArray((p as { rows?: unknown }).rows)
        ? ((p as { rows: unknown[] }).rows)
        : null,
    mapRow: (v) => {
      const o = v as { domain?: unknown; code?: unknown };
      return { kind: "row", row: { domain: o.domain, code: o.code } };
    },
    ...overrides,
  };
}

function fixedAwinClock(): AwinAdapterClock {
  let calls = 0;
  return {
    nowIso: () => new Date(AWIN_NOW_MS + calls).toISOString(),
    nowMs: () => AWIN_NOW_MS + calls++,
  };
}

function bodyFetcher(body: string, status = 200) {
  const state = { calls: 0 };
  const fetcher = async () => {
    state.calls += 1;
    return { status, body };
  };
  return { fetcher, state };
}

describe("pipeline contract — cache-read short-circuit gated by cacheSupported", () => {
  it("cacheSupported:false never short-circuits even with a fresh ok cache row", async () => {
    const db = makeDb();
    // Prime via a cacheSupported:true run.
    const prime = bodyFetcher(ROWS_BODY);
    await runProviderPipeline(
      baseSpec(),
      { db, fetcher: prime.fetcher, clock: fixedAwinClock(), timeoutMs: 1, cacheTtlMs: 60_000 },
      { domain: "shop.example" },
    );

    const noCache = bodyFetcher(ROWS_BODY);
    const r = await runProviderPipeline(
      baseSpec({ cacheSupported: false }),
      { db, fetcher: noCache.fetcher, clock: fixedAwinClock(), timeoutMs: 1, cacheTtlMs: 60_000 },
      { domain: "shop.example" },
    );
    expect(noCache.state.calls).toBe(1); // fetched, not short-circuited
    expect(r.cacheHit).toBe(false);
    expect(r.fetched).toBe(true);
  });

  it("cacheSupported:true short-circuits the same primed cache row", async () => {
    const db = makeDb();
    const prime = bodyFetcher(ROWS_BODY);
    await runProviderPipeline(
      baseSpec(),
      { db, fetcher: prime.fetcher, clock: fixedAwinClock(), timeoutMs: 1, cacheTtlMs: 60_000 },
      { domain: "shop.example" },
    );

    const hit = bodyFetcher(ROWS_BODY);
    const r = await runProviderPipeline(
      baseSpec(),
      { db, fetcher: hit.fetcher, clock: fixedAwinClock(), timeoutMs: 1, cacheTtlMs: 60_000 },
      { domain: "shop.example" },
    );
    expect(hit.state.calls).toBe(0); // no HTTP
    expect(r.cacheHit).toBe(true);
    expect(r.outcome).toBe("cache_hit");
    expect(r.fetched).toBe(false);
  });
});

describe("pipeline contract — extractEnvelope isolation", () => {
  const awinSpec = baseSpec({
    extractEnvelope: (p) =>
      p !== null && typeof p === "object" && Array.isArray((p as { offers?: unknown }).offers)
        ? ((p as { offers: unknown[] }).offers)
        : null,
  });
  const impactSpec = baseSpec({
    sourceId: "impact",
    providerId: "impact",
    sourceName: "impact.com Promotions API",
    extractEnvelope: (p) => {
      if (p === null || typeof p !== "object") return null;
      const e = p as { Promotions?: unknown; promotions?: unknown };
      if (Array.isArray(e.Promotions)) return e.Promotions;
      if (Array.isArray(e.promotions)) return e.promotions;
      return null;
    },
  });
  const deps = () => ({
    fetcher: bodyFetcher("").fetcher,
    clock: fixedAwinClock(),
    timeoutMs: 1,
    cacheTtlMs: 1,
  });

  it("awin spec rejects an impact-shaped envelope as parse_error", async () => {
    const f = bodyFetcher(JSON.stringify({ Promotions: [{ domain: "a.b", code: "X" }] }));
    const r = await runProviderPipeline(
      awinSpec,
      { ...deps(), fetcher: f.fetcher },
      { domain: "shop.example" },
    );
    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe("parse_error");
  });

  it("impact spec rejects an awin-shaped envelope as parse_error", async () => {
    const f = bodyFetcher(JSON.stringify({ offers: [{ domain: "a.b", code: "X" }] }));
    const r = await runProviderPipeline(
      impactSpec,
      { ...deps(), fetcher: f.fetcher },
      { domain: "shop.example" },
    );
    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe("parse_error");
  });

  it("each spec accepts its own envelope key", async () => {
    const aw = bodyFetcher(JSON.stringify({ offers: [{ domain: "shop.example", code: "A1" }] }));
    const ra = await runProviderPipeline(
      awinSpec,
      { ...deps(), fetcher: aw.fetcher },
      { domain: "shop.example" },
    );
    expect(ra.ok).toBe(true);
    expect(ra.candidates).toHaveLength(1);

    const im = bodyFetcher(
      JSON.stringify({ promotions: [{ domain: "shop.example", code: "I1" }] }),
    );
    const ri = await runProviderPipeline(
      impactSpec,
      { ...deps(), fetcher: im.fetcher },
      { domain: "shop.example" },
    );
    expect(ri.ok).toBe(true);
    expect(ri.candidates).toHaveLength(1);
  });
});

describe("pipeline contract — fetch-log / cache-write counts", () => {
  function logCount(db: Db): number {
    return (
      db.prepare("SELECT COUNT(*) AS n FROM source_fetch_log").get() as {
        n: number;
      }
    ).n;
  }
  function cacheCount(db: Db): number {
    return (
      db.prepare("SELECT COUNT(*) AS n FROM source_cache").get() as {
        n: number;
      }
    ).n;
  }

  it("success: exactly one fetch-log row and one cache row", async () => {
    const db = makeDb();
    const f = bodyFetcher(ROWS_BODY);
    await runProviderPipeline(
      baseSpec(),
      { db, fetcher: f.fetcher, clock: fixedAwinClock(), timeoutMs: 1, cacheTtlMs: 60_000 },
      { domain: "shop.example" },
    );
    expect(logCount(db)).toBe(1);
    expect(cacheCount(db)).toBe(1);
  });

  it("http 5xx: one fetch-log row, no cache row", async () => {
    const db = makeDb();
    const f = bodyFetcher("{}", 503);
    const r = await runProviderPipeline(
      baseSpec(),
      { db, fetcher: f.fetcher, clock: fixedAwinClock(), timeoutMs: 1, cacheTtlMs: 1 },
      { domain: "shop.example" },
    );
    expect(r.errorCode).toBe("http_5xx");
    expect(logCount(db)).toBe(1);
    expect(cacheCount(db)).toBe(0);
  });

  it("fetch throw: one fetch-log row, no cache row", async () => {
    const db = makeDb();
    const fetcher = async () => {
      throw new Error("boom");
    };
    const r = await runProviderPipeline(
      baseSpec(),
      { db, fetcher, clock: fixedAwinClock(), timeoutMs: 1, cacheTtlMs: 1 },
      { domain: "shop.example" },
    );
    expect(r.errorCode).toBe("fetch_error");
    expect(logCount(db)).toBe(1);
    expect(cacheCount(db)).toBe(0);
  });

  it("parse error: one fetch-log row, no cache row", async () => {
    const db = makeDb();
    const f = bodyFetcher("not-json");
    const r = await runProviderPipeline(
      baseSpec(),
      { db, fetcher: f.fetcher, clock: fixedAwinClock(), timeoutMs: 1, cacheTtlMs: 1 },
      { domain: "shop.example" },
    );
    expect(r.errorCode).toBe("parse_error");
    expect(logCount(db)).toBe(1);
    expect(cacheCount(db)).toBe(0);
  });

  it("early return (disabled): no fetch-log, no cache row", async () => {
    const db = makeDb();
    const f = bodyFetcher(ROWS_BODY);
    const r = await runProviderPipeline(
      baseSpec({ config: { enabled: false } }),
      { db, fetcher: f.fetcher, clock: fixedAwinClock(), timeoutMs: 1, cacheTtlMs: 1 },
      { domain: "shop.example" },
    );
    expect(r.errorCode).toBe("disabled");
    expect(f.state.calls).toBe(0);
    expect(logCount(db)).toBe(0);
    expect(cacheCount(db)).toBe(0);
  });
});
