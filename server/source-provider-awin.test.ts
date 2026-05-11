import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { openDatabase, type Db } from "./db";
import { ensureCouponSource } from "./db-sources";
import {
  readAwinConfig,
  type AwinProviderConfig,
  type SourceProviderConfig,
} from "./source-provider-config";
import {
  createAwinAdapter,
  type AwinFetcher,
  type AwinFetcherResponse,
  type AwinAdapterClock,
  type AwinAdapterResult,
} from "./source-provider-awin";

const FIXED_NOW_MS = Date.parse("2026-05-11T12:00:00.000Z");
const FIXED_NOW_ISO = new Date(FIXED_NOW_MS).toISOString();

function fixedClock(): AwinAdapterClock {
  let calls = 0;
  return {
    nowIso: () => new Date(FIXED_NOW_MS + calls).toISOString(),
    nowMs: () => FIXED_NOW_MS + calls++,
  };
}

function loadFixture(name: string): string {
  const url = new URL(`./fixtures/${name}`, import.meta.url);
  return readFileSync(fileURLToPath(url), "utf8");
}

function makeDb(): Db {
  return openDatabase(":memory:");
}

function enabledConfig(overrides: Partial<AwinProviderConfig> = {}): AwinProviderConfig {
  return {
    enabled: true,
    providerId: "awin",
    apiKey: "secret-key-shhh",
    publisherId: "pub-42",
    ...overrides,
  };
}

function fetcherFromFixture(
  body: string,
  status = 200,
): { fetcher: AwinFetcher; calls: Array<{ url: string; headers: Record<string, string> }> } {
  const calls: Array<{ url: string; headers: Record<string, string> }> = [];
  const fetcher: AwinFetcher = async (url, init) => {
    calls.push({ url, headers: init.headers });
    return { status, body } satisfies AwinFetcherResponse;
  };
  return { fetcher, calls };
}

function expectNoSecretsLeak(result: AwinAdapterResult, apiKey: string): void {
  const text = JSON.stringify(result);
  expect(text).not.toContain(apiKey);
  expect(text.toLowerCase()).not.toContain("authorization");
  expect(text.toLowerCase()).not.toContain("bearer");
  expect(text).not.toMatch(/awin1\.com/);
  expect(text).not.toContain("clickThroughUrl");
  expect(text).not.toContain("trackingUrl");
  expect(text).not.toContain("commissionRate");
  expect(text).not.toContain("publisherId");
}

describe("readAwinConfig", () => {
  it("returns flag_off when env flag is unset", () => {
    const cfg = readAwinConfig({});
    expect(cfg).toEqual({ enabled: false, reason: "flag_off" });
  });

  it("returns flag_off for any value other than 'true'", () => {
    expect(readAwinConfig({ SALVARE_SOURCE_PROVIDER_ENABLED: "1" })).toEqual({
      enabled: false,
      reason: "flag_off",
    });
    expect(readAwinConfig({ SALVARE_SOURCE_PROVIDER_ENABLED: "yes" })).toEqual({
      enabled: false,
      reason: "flag_off",
    });
    expect(readAwinConfig({ SALVARE_SOURCE_PROVIDER_ENABLED: "  " })).toEqual({
      enabled: false,
      reason: "flag_off",
    });
  });

  it("returns provider_unset when provider id is missing", () => {
    expect(
      readAwinConfig({ SALVARE_SOURCE_PROVIDER_ENABLED: "true" }),
    ).toEqual({ enabled: false, reason: "provider_unset" });
  });

  it("returns provider_unsupported for unknown provider", () => {
    expect(
      readAwinConfig({
        SALVARE_SOURCE_PROVIDER_ENABLED: "true",
        SALVARE_SOURCE_PROVIDER: "fake",
      }),
    ).toEqual({ enabled: false, reason: "provider_unsupported" });
  });

  it("returns missing_api_key when key is absent or blank", () => {
    expect(
      readAwinConfig({
        SALVARE_SOURCE_PROVIDER_ENABLED: "true",
        SALVARE_SOURCE_PROVIDER: "awin",
      }),
    ).toEqual({ enabled: false, reason: "missing_api_key" });
    expect(
      readAwinConfig({
        SALVARE_SOURCE_PROVIDER_ENABLED: "true",
        SALVARE_SOURCE_PROVIDER: "awin",
        SALVARE_AWIN_API_KEY: "   ",
      }),
    ).toEqual({ enabled: false, reason: "missing_api_key" });
  });

  it("returns enabled config when flag, provider id, and key are present", () => {
    const cfg = readAwinConfig({
      SALVARE_SOURCE_PROVIDER_ENABLED: "true",
      SALVARE_SOURCE_PROVIDER: "awin",
      SALVARE_AWIN_API_KEY: "real-key",
      SALVARE_AWIN_PUBLISHER_ID: "pub-1",
    });
    expect(cfg).toEqual({
      enabled: true,
      providerId: "awin",
      apiKey: "real-key",
      publisherId: "pub-1",
    });
  });
});

describe("createAwinAdapter — disabled paths", () => {
  it("returns disabled when feature flag is off and never calls fetcher", async () => {
    let called = false;
    const fetcher: AwinFetcher = async () => {
      called = true;
      return { status: 200, body: "{}" };
    };
    const adapter = createAwinAdapter({
      config: { enabled: false, reason: "flag_off" } as SourceProviderConfig as AwinProviderConfig,
      fetcher,
    });
    const result = await adapter.fetchAndParse({ domain: "shop.example" });
    expect(called).toBe(false);
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe("disabled");
    expect(result.fetched).toBe(false);
    expect(result.candidates).toEqual([]);
  });

  it("returns missing_api_key and never calls fetcher when key is absent", async () => {
    let called = false;
    const fetcher: AwinFetcher = async () => {
      called = true;
      return { status: 200, body: "{}" };
    };
    const adapter = createAwinAdapter({
      config: { ...enabledConfig(), apiKey: "" },
      fetcher,
    });
    const result = await adapter.fetchAndParse({ domain: "shop.example" });
    expect(called).toBe(false);
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe("missing_api_key");
    expect(result.fetched).toBe(false);
  });
});

describe("createAwinAdapter — parse paths (mocked HTTP)", () => {
  it("normalizes voucher offers, drops cashback, and strips affiliate fields", async () => {
    const { fetcher, calls } = fetcherFromFixture(loadFixture("awin-offers-ok.json"));
    const adapter = createAwinAdapter({
      config: enabledConfig(),
      fetcher,
      clock: fixedClock(),
    });
    const result = await adapter.fetchAndParse({ domain: "shop.example" });

    expect(result.ok).toBe(true);
    expect(result.outcome).toBe("ok");
    expect(result.fetched).toBe(true);
    // Fixture: 2 vouchers for shop.example, 1 cashback (dropped), 1 voucher
    // for other.example (kept — adapter trusts provider response and does
    // not re-filter by input domain). Net: 3 candidates.
    expect(result.candidates).toHaveLength(3);

    expect(result.candidates[0]).toMatchObject({
      domain: "shop.example",
      code: "AWIN10",
      sourceId: "awin",
      label: "10% off your first order",
      expiresAt: "2026-12-31",
    });
    expect(result.candidates[1]).toMatchObject({
      domain: "shop.example",
      code: "FREESHIP",
      sourceId: "awin",
      label: "Free shipping over $50",
    });
    expect(result.candidates[2]).toMatchObject({
      domain: "other.example",
      code: "OTHER15",
      sourceId: "awin",
    });

    for (const c of result.candidates) {
      expect(Object.keys(c)).not.toContain("clickThroughUrl");
      expect(Object.keys(c)).not.toContain("trackingUrl");
      expect(Object.keys(c)).not.toContain("commissionRate");
      expect(Object.keys(c)).not.toContain("deepLink");
      expect(Object.keys(c)).not.toContain("publisherId");
    }

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain("merchantDomain=shop.example");
    expect(calls[0].headers.Authorization).toBe("Bearer secret-key-shhh");

    expectNoSecretsLeak(result, "secret-key-shhh");
  });

  it("returns empty outcome when fixture has no offers", async () => {
    const { fetcher } = fetcherFromFixture(loadFixture("awin-offers-empty.json"));
    const adapter = createAwinAdapter({ config: enabledConfig(), fetcher, clock: fixedClock() });
    const result = await adapter.fetchAndParse({ domain: "shop.example" });
    expect(result.ok).toBe(true);
    expect(result.outcome).toBe("empty");
    expect(result.candidates).toEqual([]);
  });

  it("returns parse_error on malformed JSON", async () => {
    const { fetcher } = fetcherFromFixture(loadFixture("awin-offers-malformed.json"));
    const adapter = createAwinAdapter({ config: enabledConfig(), fetcher, clock: fixedClock() });
    const result = await adapter.fetchAndParse({ domain: "shop.example" });
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe("parse_error");
    expect(result.candidates).toEqual([]);
    expectNoSecretsLeak(result, "secret-key-shhh");
  });

  it("returns parse_error when JSON has wrong shape", async () => {
    const { fetcher } = fetcherFromFixture('{"unexpected":true}');
    const adapter = createAwinAdapter({ config: enabledConfig(), fetcher, clock: fixedClock() });
    const result = await adapter.fetchAndParse({ domain: "shop.example" });
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe("parse_error");
  });

  it("records per-row errors but keeps surviving rows", async () => {
    const { fetcher } = fetcherFromFixture(loadFixture("awin-offers-mixed-types.json"));
    const adapter = createAwinAdapter({ config: enabledConfig(), fetcher, clock: fixedClock() });
    const result = await adapter.fetchAndParse({ domain: "shop.example" });
    expect(result.ok).toBe(true);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].code).toBe("GOODONE");
    expect(result.errors.length).toBeGreaterThan(0);
    for (const err of result.errors) {
      expect(typeof err.reason).toBe("string");
      expect(err.reason.length).toBeLessThan(40);
    }
  });

  it("returns http_4xx for 404 response and never echoes payload", async () => {
    const { fetcher } = fetcherFromFixture('{"error":"not found","secret":"leak-me"}', 404);
    const adapter = createAwinAdapter({ config: enabledConfig(), fetcher, clock: fixedClock() });
    const result = await adapter.fetchAndParse({ domain: "shop.example" });
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe("http_4xx");
    expect(JSON.stringify(result)).not.toContain("leak-me");
  });

  it("returns http_5xx for 503", async () => {
    const { fetcher } = fetcherFromFixture("{}", 503);
    const adapter = createAwinAdapter({ config: enabledConfig(), fetcher, clock: fixedClock() });
    const result = await adapter.fetchAndParse({ domain: "shop.example" });
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe("http_5xx");
  });

  it("returns fetch_error and records log when fetcher throws", async () => {
    const fetcher: AwinFetcher = async () => {
      throw new Error("network down with secret-key-shhh in message");
    };
    const adapter = createAwinAdapter({ config: enabledConfig(), fetcher, clock: fixedClock() });
    const result = await adapter.fetchAndParse({ domain: "shop.example" });
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe("fetch_error");
    expectNoSecretsLeak(result, "secret-key-shhh");
  });

  it("returns timeout when fetcher throws AbortError", async () => {
    const fetcher: AwinFetcher = async () => {
      const err = new Error("aborted");
      err.name = "AbortError";
      throw err;
    };
    const adapter = createAwinAdapter({ config: enabledConfig(), fetcher, clock: fixedClock() });
    const result = await adapter.fetchAndParse({ domain: "shop.example" });
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe("timeout");
  });

  it("rejects invalid input domain without calling fetcher", async () => {
    let called = false;
    const fetcher: AwinFetcher = async () => {
      called = true;
      return { status: 200, body: "{}" };
    };
    const adapter = createAwinAdapter({ config: enabledConfig(), fetcher, clock: fixedClock() });
    const result = await adapter.fetchAndParse({ domain: "  " });
    expect(called).toBe(false);
    expect(result.errorCode).toBe("parse_error");
  });
});

describe("createAwinAdapter — db integration", () => {
  it("registers awin source row at runtime when db is provided", async () => {
    const db = makeDb();
    const { fetcher } = fetcherFromFixture(loadFixture("awin-offers-ok.json"));
    const adapter = createAwinAdapter({
      config: enabledConfig(),
      fetcher,
      db,
      clock: fixedClock(),
    });
    await adapter.fetchAndParse({ domain: "shop.example" });
    const row = db
      .prepare("SELECT id, type, enabled FROM coupon_sources WHERE id = ?")
      .get("awin") as { id: string; type: string; enabled: number } | undefined;
    expect(row).toBeDefined();
    expect(row?.type).toBe("api");
    expect(row?.enabled).toBe(1);
  });

  it("does NOT register awin source row when db is omitted", async () => {
    const db = makeDb();
    const { fetcher } = fetcherFromFixture(loadFixture("awin-offers-ok.json"));
    const adapter = createAwinAdapter({
      config: enabledConfig(),
      fetcher,
      clock: fixedClock(),
    });
    await adapter.fetchAndParse({ domain: "shop.example" });
    const row = db
      .prepare("SELECT 1 AS x FROM coupon_sources WHERE id = ?")
      .get("awin");
    expect(row).toBeUndefined();
  });

  it("writes a fetch_log row with outcome, status, duration on success", async () => {
    const db = makeDb();
    const { fetcher } = fetcherFromFixture(loadFixture("awin-offers-ok.json"));
    const adapter = createAwinAdapter({
      config: enabledConfig(),
      fetcher,
      db,
      clock: fixedClock(),
    });
    await adapter.fetchAndParse({ domain: "shop.example" });
    const log = db
      .prepare(
        "SELECT outcome, status_code, error_code, duration_ms FROM source_fetch_log WHERE source_id = ?",
      )
      .all("awin") as Array<{
      outcome: string;
      status_code: number | null;
      error_code: string | null;
      duration_ms: number | null;
    }>;
    expect(log).toHaveLength(1);
    expect(log[0].outcome).toBe("ok");
    expect(log[0].status_code).toBe(200);
    expect(log[0].error_code).toBeNull();
    expect(typeof log[0].duration_ms).toBe("number");
  });

  it("writes a source_cache row with body sha256 and safe metadata on success", async () => {
    const db = makeDb();
    const { fetcher } = fetcherFromFixture(loadFixture("awin-offers-ok.json"));
    const adapter = createAwinAdapter({
      config: enabledConfig(),
      fetcher,
      db,
      clock: fixedClock(),
    });
    await adapter.fetchAndParse({ domain: "shop.example" });
    const cache = db
      .prepare(
        "SELECT cache_key, status, body_sha256, metadata_json FROM source_cache WHERE source_id = ?",
      )
      .get("awin") as
      | { cache_key: string; status: string; body_sha256: string; metadata_json: string }
      | undefined;
    expect(cache).toBeDefined();
    expect(cache?.cache_key).toBe("merchant:shop.example");
    expect(cache?.status).toBe("ok");
    expect(cache?.body_sha256).toMatch(/^[0-9a-f]{64}$/);
    const meta = JSON.parse(cache?.metadata_json ?? "{}") as Record<string, unknown>;
    expect(meta).toEqual({ offer_count: 3, error_count: 0 });
    expect(JSON.stringify(meta).toLowerCase()).not.toContain("authorization");
    expect(JSON.stringify(meta)).not.toContain("secret-key-shhh");
  });

  it("logs error outcome with errorCode on http failure", async () => {
    const db = makeDb();
    const { fetcher } = fetcherFromFixture("{}", 500);
    const adapter = createAwinAdapter({
      config: enabledConfig(),
      fetcher,
      db,
      clock: fixedClock(),
    });
    await adapter.fetchAndParse({ domain: "shop.example" });
    const log = db
      .prepare(
        "SELECT outcome, status_code, error_code FROM source_fetch_log WHERE source_id = ?",
      )
      .get("awin") as { outcome: string; status_code: number; error_code: string };
    expect(log.outcome).toBe("error");
    expect(log.status_code).toBe(500);
    expect(log.error_code).toBe("http_5xx");
    const cacheCount = (
      db.prepare("SELECT COUNT(*) AS n FROM source_cache").get() as { n: number }
    ).n;
    expect(cacheCount).toBe(0);
  });

  it("never writes to coupon_codes or coupon_code_sources", async () => {
    const db = makeDb();
    const { fetcher } = fetcherFromFixture(loadFixture("awin-offers-ok.json"));
    const adapter = createAwinAdapter({
      config: enabledConfig(),
      fetcher,
      db,
      clock: fixedClock(),
    });
    await adapter.fetchAndParse({ domain: "shop.example" });
    const codeCount = (
      db.prepare("SELECT COUNT(*) AS n FROM coupon_codes").get() as { n: number }
    ).n;
    const provCount = (
      db.prepare("SELECT COUNT(*) AS n FROM coupon_code_sources").get() as { n: number }
    ).n;
    expect(codeCount).toBe(0);
    expect(provCount).toBe(0);
  });

  it("survives when source row pre-exists (idempotent ensureCouponSource)", async () => {
    const db = makeDb();
    ensureCouponSource(
      db,
      { id: "awin", name: "Awin Offers API", type: "api", enabled: true },
      FIXED_NOW_ISO,
    );
    const { fetcher } = fetcherFromFixture(loadFixture("awin-offers-ok.json"));
    const adapter = createAwinAdapter({
      config: enabledConfig(),
      fetcher,
      db,
      clock: fixedClock(),
    });
    const result = await adapter.fetchAndParse({ domain: "shop.example" });
    expect(result.ok).toBe(true);
  });
});
