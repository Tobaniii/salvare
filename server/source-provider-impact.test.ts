import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { openDatabase, type Db } from "./db";
import { ensureCouponSource } from "./db-sources";
import {
  readImpactConfig,
  type ImpactProviderConfig,
  type ImpactSourceProviderConfig,
} from "./source-provider-config";
import {
  createImpactAdapter,
  type ImpactFetcher,
  type ImpactFetcherResponse,
  type ImpactAdapterClock,
  type ImpactAdapterResult,
} from "./source-provider-impact";

const FIXED_NOW_MS = Date.parse("2026-05-15T12:00:00.000Z");
const FIXED_NOW_ISO = new Date(FIXED_NOW_MS).toISOString();
const FAKE_API_KEY = "fake-impact-key-not-real";
const FAKE_ACCOUNT_SID = "FAKE-ACCOUNT-SID-NOT-REAL";

function fixedClock(): ImpactAdapterClock {
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

function enabledConfig(
  overrides: Partial<ImpactProviderConfig> = {},
): ImpactProviderConfig {
  return {
    enabled: true,
    providerId: "impact",
    apiKey: FAKE_API_KEY,
    accountSid: FAKE_ACCOUNT_SID,
    ...overrides,
  };
}

function fetcherFromFixture(
  body: string,
  status = 200,
): {
  fetcher: ImpactFetcher;
  calls: Array<{ url: string; headers: Record<string, string> }>;
} {
  const calls: Array<{ url: string; headers: Record<string, string> }> = [];
  const fetcher: ImpactFetcher = async (url, init) => {
    calls.push({ url, headers: init.headers });
    return { status, body } satisfies ImpactFetcherResponse;
  };
  return { fetcher, calls };
}

function expectNoSecretsLeak(result: ImpactAdapterResult): void {
  const text = JSON.stringify(result);
  expect(text).not.toContain(FAKE_API_KEY);
  expect(text).not.toContain(FAKE_ACCOUNT_SID);
  expect(text.toLowerCase()).not.toContain("authorization");
  expect(text.toLowerCase()).not.toContain("bearer");
  expect(text).not.toContain("TrackingUrl");
  expect(text).not.toContain("trackingUrl");
  expect(text).not.toContain("DeepLink");
  expect(text).not.toContain("ClickUrl");
  expect(text).not.toContain("PartnerId");
  expect(text).not.toContain("AdvertiserId");
  expect(text).not.toContain("AccountSid");
  expect(text).not.toContain("AuthToken");
  expect(text).not.toContain("Payout");
  expect(text).not.toContain("CommissionRate");
  expect(text).not.toContain("EarningsPerClick");
  expect(text).not.toContain("fake-tracking.example");
  expect(text).not.toContain("FAKE-PARTNER-NOT-REAL");
  expect(text).not.toContain("FAKE-ADVERTISER-NOT-REAL");
}

describe("readImpactConfig", () => {
  it("returns flag_off when env flag is unset", () => {
    expect(readImpactConfig({})).toEqual({ enabled: false, reason: "flag_off" });
  });

  it("returns flag_off for any value other than 'true'", () => {
    expect(readImpactConfig({ SALVARE_IMPACT_ENABLED: "1" })).toEqual({
      enabled: false,
      reason: "flag_off",
    });
    expect(readImpactConfig({ SALVARE_IMPACT_ENABLED: "yes" })).toEqual({
      enabled: false,
      reason: "flag_off",
    });
    expect(readImpactConfig({ SALVARE_IMPACT_ENABLED: "  " })).toEqual({
      enabled: false,
      reason: "flag_off",
    });
  });

  it("returns missing_api_key when key is absent or blank", () => {
    expect(
      readImpactConfig({ SALVARE_IMPACT_ENABLED: "true" }),
    ).toEqual({ enabled: false, reason: "missing_api_key" });
    expect(
      readImpactConfig({
        SALVARE_IMPACT_ENABLED: "true",
        SALVARE_IMPACT_API_KEY: "   ",
      }),
    ).toEqual({ enabled: false, reason: "missing_api_key" });
  });

  it("returns enabled config when flag + key are present (account sid optional)", () => {
    expect(
      readImpactConfig({
        SALVARE_IMPACT_ENABLED: "true",
        SALVARE_IMPACT_API_KEY: "real-key",
      }),
    ).toEqual({
      enabled: true,
      providerId: "impact",
      apiKey: "real-key",
      accountSid: null,
    });
  });

  it("captures account sid when provided", () => {
    expect(
      readImpactConfig({
        SALVARE_IMPACT_ENABLED: "true",
        SALVARE_IMPACT_API_KEY: "real-key",
        SALVARE_IMPACT_ACCOUNT_SID: "sid-1",
      }),
    ).toEqual({
      enabled: true,
      providerId: "impact",
      apiKey: "real-key",
      accountSid: "sid-1",
    });
  });

  it("never echoes env values back to the caller in disabled responses", () => {
    const disabled = readImpactConfig({
      SALVARE_IMPACT_ENABLED: "true",
      SALVARE_IMPACT_API_KEY: "   ",
    });
    expect(JSON.stringify(disabled)).not.toContain("real-key");
  });
});

describe("createImpactAdapter — disabled paths", () => {
  it("returns disabled when feature flag is off and never calls fetcher", async () => {
    let called = false;
    const fetcher: ImpactFetcher = async () => {
      called = true;
      return { status: 200, body: "{}" };
    };
    const adapter = createImpactAdapter({
      config: {
        enabled: false,
        reason: "flag_off",
      } as ImpactSourceProviderConfig as ImpactProviderConfig,
      fetcher,
    });
    const result = await adapter.fetchAndParse({ domain: "shop.example" });
    expect(called).toBe(false);
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe("disabled");
    expect(result.fetched).toBe(false);
    expect(result.candidates).toEqual([]);
  });

  it("returns missing_api_key and never calls fetcher when key is empty", async () => {
    let called = false;
    const fetcher: ImpactFetcher = async () => {
      called = true;
      return { status: 200, body: "{}" };
    };
    const adapter = createImpactAdapter({
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

describe("createImpactAdapter — parse paths (mocked HTTP)", () => {
  it("normalizes promo-code promotions, drops cashback, and strips affiliate fields", async () => {
    const { fetcher, calls } = fetcherFromFixture(
      loadFixture("impact-offers-ok.json"),
    );
    const adapter = createImpactAdapter({
      config: enabledConfig(),
      fetcher,
      clock: fixedClock(),
    });
    const result = await adapter.fetchAndParse({ domain: "shop.example" });

    expect(result.ok).toBe(true);
    expect(result.outcome).toBe("ok");
    expect(result.fetched).toBe(true);
    // Fixture: 2 promo codes for shop.example, 1 cashback (dropped silently),
    // 1 voucher for other.example (kept — adapter trusts provider response and
    // does not re-filter by input domain). Net: 3 candidates.
    expect(result.candidates).toHaveLength(3);

    expect(result.candidates[0]).toMatchObject({
      domain: "shop.example",
      code: "IMPACT10",
      sourceId: "impact",
      label: "10% off your first order",
      expiresAt: "2026-12-31",
    });
    expect(result.candidates[1]).toMatchObject({
      domain: "shop.example",
      code: "FREESHIP",
      sourceId: "impact",
      label: "Free shipping over $50",
    });
    expect(result.candidates[2]).toMatchObject({
      domain: "other.example",
      code: "OTHER15",
      sourceId: "impact",
    });

    for (const c of result.candidates) {
      expect(Object.keys(c)).not.toContain("TrackingUrl");
      expect(Object.keys(c)).not.toContain("trackingUrl");
      expect(Object.keys(c)).not.toContain("DeepLink");
      expect(Object.keys(c)).not.toContain("ClickUrl");
      expect(Object.keys(c)).not.toContain("PartnerId");
      expect(Object.keys(c)).not.toContain("AdvertiserId");
      expect(Object.keys(c)).not.toContain("AccountSid");
      expect(Object.keys(c)).not.toContain("Payout");
      expect(Object.keys(c)).not.toContain("CommissionRate");
    }

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain("advertiserDomain=shop.example");
    expect(calls[0].url).toContain(
      `Mediapartners/${encodeURIComponent(FAKE_ACCOUNT_SID)}`,
    );
    expect(calls[0].headers.Authorization).toBe(`Bearer ${FAKE_API_KEY}`);

    expectNoSecretsLeak(result);
  });

  it("works without account sid (url omits Mediapartners segment)", async () => {
    const { fetcher, calls } = fetcherFromFixture(
      loadFixture("impact-offers-ok.json"),
    );
    const adapter = createImpactAdapter({
      config: enabledConfig({ accountSid: null }),
      fetcher,
      clock: fixedClock(),
    });
    const result = await adapter.fetchAndParse({ domain: "shop.example" });
    expect(result.ok).toBe(true);
    expect(calls[0].url).not.toContain("Mediapartners");
    expect(calls[0].url).toContain("/Promotions?advertiserDomain=shop.example");
  });

  it("returns parse_error on malformed JSON", async () => {
    const { fetcher } = fetcherFromFixture(loadFixture("impact-offers-malformed.json"));
    const adapter = createImpactAdapter({
      config: enabledConfig(),
      fetcher,
      clock: fixedClock(),
    });
    const result = await adapter.fetchAndParse({ domain: "shop.example" });
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe("parse_error");
    expect(result.candidates).toEqual([]);
    expectNoSecretsLeak(result);
  });

  it("returns parse_error when envelope shape is wrong", async () => {
    const { fetcher } = fetcherFromFixture('{"unexpected":true}');
    const adapter = createImpactAdapter({
      config: enabledConfig(),
      fetcher,
      clock: fixedClock(),
    });
    const result = await adapter.fetchAndParse({ domain: "shop.example" });
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe("parse_error");
  });

  it("returns http_4xx for 404 and never echoes the payload", async () => {
    const { fetcher } = fetcherFromFixture(
      '{"error":"not found","secret":"leak-me-impact"}',
      404,
    );
    const adapter = createImpactAdapter({
      config: enabledConfig(),
      fetcher,
      clock: fixedClock(),
    });
    const result = await adapter.fetchAndParse({ domain: "shop.example" });
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe("http_4xx");
    expect(JSON.stringify(result)).not.toContain("leak-me-impact");
  });

  it("returns http_5xx for 503", async () => {
    const { fetcher } = fetcherFromFixture("{}", 503);
    const adapter = createImpactAdapter({
      config: enabledConfig(),
      fetcher,
      clock: fixedClock(),
    });
    const result = await adapter.fetchAndParse({ domain: "shop.example" });
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe("http_5xx");
  });

  it("returns fetch_error when fetcher throws and never echoes secret in error message", async () => {
    const fetcher: ImpactFetcher = async () => {
      throw new Error(`network down with ${FAKE_API_KEY} in message`);
    };
    const adapter = createImpactAdapter({
      config: enabledConfig(),
      fetcher,
      clock: fixedClock(),
    });
    const result = await adapter.fetchAndParse({ domain: "shop.example" });
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe("fetch_error");
    expectNoSecretsLeak(result);
  });

  it("returns timeout when fetcher throws AbortError", async () => {
    const fetcher: ImpactFetcher = async () => {
      const err = new Error("aborted");
      err.name = "AbortError";
      throw err;
    };
    const adapter = createImpactAdapter({
      config: enabledConfig(),
      fetcher,
      clock: fixedClock(),
    });
    const result = await adapter.fetchAndParse({ domain: "shop.example" });
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe("timeout");
  });

  it("rejects invalid input domain without calling fetcher", async () => {
    let called = false;
    const fetcher: ImpactFetcher = async () => {
      called = true;
      return { status: 200, body: "{}" };
    };
    const adapter = createImpactAdapter({
      config: enabledConfig(),
      fetcher,
      clock: fixedClock(),
    });
    const result = await adapter.fetchAndParse({ domain: "  " });
    expect(called).toBe(false);
    expect(result.errorCode).toBe("parse_error");
  });

  it("also accepts the lowercase 'promotions' envelope key", async () => {
    const { fetcher } = fetcherFromFixture(
      JSON.stringify({
        promotions: [
          {
            AdvertiserUrl: "https://lc.example/",
            PromoCode: "LC10",
            PromotionType: "PROMO_CODE",
            Name: "lowercase envelope",
          },
        ],
      }),
    );
    const adapter = createImpactAdapter({
      config: enabledConfig(),
      fetcher,
      clock: fixedClock(),
    });
    const result = await adapter.fetchAndParse({ domain: "lc.example" });
    expect(result.ok).toBe(true);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].code).toBe("LC10");
  });
});

describe("createImpactAdapter — db integration", () => {
  it("registers impact source row at runtime when db is provided", async () => {
    const db = makeDb();
    const { fetcher } = fetcherFromFixture(loadFixture("impact-offers-ok.json"));
    const adapter = createImpactAdapter({
      config: enabledConfig(),
      fetcher,
      db,
      clock: fixedClock(),
    });
    await adapter.fetchAndParse({ domain: "shop.example" });
    const row = db
      .prepare("SELECT id, name, type, enabled FROM coupon_sources WHERE id = ?")
      .get("impact") as
      | { id: string; name: string; type: string; enabled: number }
      | undefined;
    expect(row).toBeDefined();
    expect(row?.name).toBe("impact.com Promotions API");
    expect(row?.type).toBe("api");
    expect(row?.enabled).toBe(1);
  });

  it("does NOT register impact source row when db is omitted", async () => {
    const db = makeDb();
    const { fetcher } = fetcherFromFixture(loadFixture("impact-offers-ok.json"));
    const adapter = createImpactAdapter({
      config: enabledConfig(),
      fetcher,
      clock: fixedClock(),
    });
    await adapter.fetchAndParse({ domain: "shop.example" });
    const row = db
      .prepare("SELECT 1 AS x FROM coupon_sources WHERE id = ?")
      .get("impact");
    expect(row).toBeUndefined();
  });

  it("writes a fetch_log row with outcome, status, duration on success", async () => {
    const db = makeDb();
    const { fetcher } = fetcherFromFixture(loadFixture("impact-offers-ok.json"));
    const adapter = createImpactAdapter({
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
      .all("impact") as Array<{
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
    const { fetcher } = fetcherFromFixture(loadFixture("impact-offers-ok.json"));
    const adapter = createImpactAdapter({
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
      .get("impact") as
      | {
          cache_key: string;
          status: string;
          body_sha256: string;
          metadata_json: string;
        }
      | undefined;
    expect(cache).toBeDefined();
    expect(cache?.cache_key).toBe("merchant:shop.example");
    expect(cache?.status).toBe("ok");
    expect(cache?.body_sha256).toMatch(/^[0-9a-f]{64}$/);
    const meta = JSON.parse(cache?.metadata_json ?? "{}") as Record<string, unknown>;
    expect(meta).toEqual({ offer_count: 3, error_count: 0 });
    const metaText = JSON.stringify(meta);
    expect(metaText.toLowerCase()).not.toContain("authorization");
    expect(metaText).not.toContain(FAKE_API_KEY);
    expect(metaText).not.toContain(FAKE_ACCOUNT_SID);
    expect(metaText).not.toContain("TrackingUrl");
  });

  it("persists candidates_json that excludes affiliate / payout / partner fields", async () => {
    const db = makeDb();
    const { fetcher } = fetcherFromFixture(loadFixture("impact-offers-ok.json"));
    const adapter = createImpactAdapter({
      config: enabledConfig(),
      fetcher,
      db,
      clock: fixedClock(),
    });
    await adapter.fetchAndParse({ domain: "shop.example" });
    const row = db
      .prepare(
        "SELECT candidates_json FROM source_cache WHERE source_id = ? AND cache_key = ?",
      )
      .get("impact", "merchant:shop.example") as
      | { candidates_json: string | null }
      | undefined;
    expect(row).toBeDefined();
    expect(row?.candidates_json).not.toBeNull();
    const serialized = row!.candidates_json!;
    const arr = JSON.parse(serialized) as Array<Record<string, unknown>>;
    expect(Array.isArray(arr)).toBe(true);
    expect(arr).toHaveLength(3);
    expect(arr[0]).toMatchObject({ domain: "shop.example", code: "IMPACT10", sourceId: "impact" });
    expect(serialized).not.toContain("TrackingUrl");
    expect(serialized).not.toContain("DeepLink");
    expect(serialized).not.toContain("ClickUrl");
    expect(serialized).not.toContain("PartnerId");
    expect(serialized).not.toContain("AdvertiserId");
    expect(serialized).not.toContain("AccountSid");
    expect(serialized).not.toContain("Payout");
    expect(serialized).not.toContain("CommissionRate");
    expect(serialized).not.toContain(FAKE_API_KEY);
    expect(serialized).not.toContain(FAKE_ACCOUNT_SID);
    expect(serialized.toLowerCase()).not.toContain("authorization");
  });

  it("logs error outcome with errorCode on http failure and skips cache write", async () => {
    const db = makeDb();
    const { fetcher } = fetcherFromFixture("{}", 500);
    const adapter = createImpactAdapter({
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
      .get("impact") as { outcome: string; status_code: number; error_code: string };
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
    const { fetcher } = fetcherFromFixture(loadFixture("impact-offers-ok.json"));
    const adapter = createImpactAdapter({
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
      {
        id: "impact",
        name: "impact.com Promotions API",
        type: "api",
        enabled: true,
      },
      FIXED_NOW_ISO,
    );
    const { fetcher } = fetcherFromFixture(loadFixture("impact-offers-ok.json"));
    const adapter = createImpactAdapter({
      config: enabledConfig(),
      fetcher,
      db,
      clock: fixedClock(),
    });
    const result = await adapter.fetchAndParse({ domain: "shop.example" });
    expect(result.ok).toBe(true);
  });
});

describe("createImpactAdapter — edge cases fixture", () => {
  function makeAdapter() {
    const { fetcher } = fetcherFromFixture(
      loadFixture("impact-offers-edge-cases.json"),
    );
    return createImpactAdapter({
      config: enabledConfig(),
      fetcher,
      clock: fixedClock(),
    });
  }

  it("same-domain duplicate codes: first kept, second produces per-row error", async () => {
    const result = await makeAdapter().fetchAndParse({ domain: "shop.example" });
    const shopDupes = result.candidates.filter(
      (c) => c.code === "DUPE" && c.domain === "shop.example",
    );
    expect(shopDupes).toHaveLength(1);
    expect(result.errors.length).toBeGreaterThanOrEqual(1);
  });

  it("same code on different domains is not treated as a duplicate", async () => {
    const result = await makeAdapter().fetchAndParse({ domain: "shop.example" });
    const shopDupe = result.candidates.find(
      (c) => c.code === "DUPE" && c.domain === "shop.example",
    );
    const otherDupe = result.candidates.find(
      (c) => c.code === "DUPE" && c.domain === "other.example",
    );
    expect(shopDupe).toBeDefined();
    expect(otherDupe).toBeDefined();
  });

  it("null code produces per-row error and does not block remaining valid rows", async () => {
    const result = await makeAdapter().fetchAndParse({ domain: "shop.example" });
    const nolabel = result.candidates.find((c) => c.code === "NOLABEL");
    const noexpiry = result.candidates.find((c) => c.code === "NOEXPIRY");
    expect(nolabel).toBeDefined();
    expect(noexpiry).toBeDefined();
    expect(result.errors.length).toBeGreaterThanOrEqual(1);
  });

  it("missing label produces valid candidate without label field", async () => {
    const result = await makeAdapter().fetchAndParse({ domain: "shop.example" });
    const nolabel = result.candidates.find((c) => c.code === "NOLABEL");
    expect(nolabel?.label).toBeUndefined();
  });

  it("missing expiry produces valid candidate without expiresAt field", async () => {
    const result = await makeAdapter().fetchAndParse({ domain: "shop.example" });
    const noexpiry = result.candidates.find((c) => c.code === "NOEXPIRY");
    expect(noexpiry?.expiresAt).toBeUndefined();
  });

  it("type alias and bare-hostname domain both work", async () => {
    const result = await makeAdapter().fetchAndParse({ domain: "shop.example" });
    const typeonly = result.candidates.find((c) => c.code === "TYPEONLY");
    expect(typeonly).toBeDefined();
    expect(typeonly?.domain).toBe("widget.example");
  });

  it("unknown promotion type is silently dropped without per-row error", async () => {
    const result = await makeAdapter().fetchAndParse({ domain: "shop.example" });
    const bad = result.candidates.find((c) => c.code === "BADTYPE");
    expect(bad).toBeUndefined();
    const badTypeErrors = result.errors.filter((e) => e.index === 7);
    expect(badTypeErrors).toHaveLength(0);
  });

  it("output stays redacted on edge-case fixture", async () => {
    const result = await makeAdapter().fetchAndParse({ domain: "shop.example" });
    expectNoSecretsLeak(result);
  });
});
