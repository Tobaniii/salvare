import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createSalvareServer } from "./index";
import { openDatabase, type Db } from "./db";
import { upsertCouponCodes } from "./db-coupons";
import { appendResultRecord } from "./db-results";
import {
  createAwinAdapter,
  type AwinFetcher,
  type AwinAdapterClock,
  type AwinAdapterResult,
} from "./source-provider-awin";
import type {
  AwinProviderConfig,
  SourceProviderConfig,
} from "./source-provider-config";
import type { AwinPreviewFn } from "./admin-source-preview-routes";

const PREVIEW_PATH = "/admin/source-preview/awin";
const API_KEY = "secret-key-shhh";
const FIXED_NOW_MS = Date.parse("2026-05-11T12:00:00.000Z");

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

function enabledConfig(): AwinProviderConfig {
  return {
    enabled: true,
    providerId: "awin",
    apiKey: API_KEY,
    publisherId: "pub-42",
  };
}

function fixtureFetcher(body: string, status = 200): AwinFetcher {
  return async () => ({ status, body });
}

interface Harness {
  baseUrl: string;
  server: Server;
  db: Db;
}

function buildFromAdapter(
  db: Db,
  config: SourceProviderConfig,
  fetcher: AwinFetcher,
): AwinPreviewFn {
  const adapter = createAwinAdapter({
    config: config as AwinProviderConfig,
    fetcher,
    db,
    clock: fixedClock(),
  });
  return (input) => adapter.fetchAndParse(input);
}

async function startHarness(
  awinPreview: AwinPreviewFn,
  adminToken: string | null = null,
): Promise<Harness> {
  const db = openDatabase(":memory:");
  upsertCouponCodes(db, "seeded.example", ["SEED1", "SEED2"]);
  appendResultRecord(db, {
    domain: "seeded.example",
    code: "SEED1",
    success: true,
    savingsCents: 100,
    finalTotalCents: 900,
  });
  const server = createSalvareServer({ db, adminToken, awinPreview });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  return { baseUrl: `http://127.0.0.1:${address.port}`, server, db };
}

async function stopHarness(h: Harness): Promise<void> {
  await new Promise<void>((resolve, reject) =>
    h.server.close((err) => (err ? reject(err) : resolve())),
  );
  h.db.close();
}

function counts(db: Db): { coupons: number; results: number; fetchLog: number } {
  const coupons = (
    db.prepare("SELECT COUNT(*) AS n FROM coupon_codes").get() as { n: number }
  ).n;
  const results = (
    db.prepare("SELECT COUNT(*) AS n FROM coupon_results").get() as { n: number }
  ).n;
  const fetchLog = (
    db.prepare("SELECT COUNT(*) AS n FROM source_fetch_log").get() as {
      n: number;
    }
  ).n;
  return { coupons, results, fetchLog };
}

async function postPreview(
  baseUrl: string,
  body: unknown,
  token?: string,
): Promise<Response> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token !== undefined) headers.Authorization = `Bearer ${token}`;
  return fetch(`${baseUrl}${PREVIEW_PATH}`, {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("POST /admin/source-preview/awin — disabled provider", () => {
  let h: Harness;
  beforeAll(async () => {
    const stub: AwinPreviewFn = async () => ({
      ok: false,
      providerId: "awin",
      sourceId: "awin",
      outcome: "error",
      errorCode: "disabled",
      candidates: [],
      errors: [],
      fetched: false,
      cacheHit: false,
      durationMs: 0,
    });
    h = await startHarness(stub);
  });
  afterAll(async () => stopHarness(h));

  it("returns 200 disabled:true reason:disabled and writes nothing", async () => {
    const before = counts(h.db);
    const res = await postPreview(h.baseUrl, { domain: "shop.example" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      ok: false,
      provider: "awin",
      domain: "shop.example",
      cacheHit: false,
      fetched: false,
      disabled: true,
      reason: "disabled",
      candidateCount: 0,
      candidates: [],
      errors: [],
    });
    expect(counts(h.db)).toEqual(before);
  });
});

describe("POST /admin/source-preview/awin — missing api key", () => {
  let h: Harness;
  beforeAll(async () => {
    const stub: AwinPreviewFn = async () => ({
      ok: false,
      providerId: "awin",
      sourceId: "awin",
      outcome: "error",
      errorCode: "missing_api_key",
      candidates: [],
      errors: [],
      fetched: false,
      cacheHit: false,
      durationMs: 0,
    });
    h = await startHarness(stub);
  });
  afterAll(async () => stopHarness(h));

  it("returns disabled:true reason:missing_api_key", async () => {
    const res = await postPreview(h.baseUrl, { domain: "shop.example" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.disabled).toBe(true);
    expect(body.reason).toBe("missing_api_key");
    expect(body.candidates).toEqual([]);
  });
});

describe("POST /admin/source-preview/awin — input validation", () => {
  let h: Harness;
  let fetcherCalls = 0;
  beforeAll(async () => {
    const stub: AwinPreviewFn = async () => {
      fetcherCalls += 1;
      return {
        ok: true,
        providerId: "awin",
        sourceId: "awin",
        outcome: "ok",
        candidates: [],
        errors: [],
        fetched: true,
        cacheHit: false,
        durationMs: 1,
      };
    };
    h = await startHarness(stub);
  });
  afterAll(async () => stopHarness(h));

  it("rejects missing body with safe 400", async () => {
    const res = await postPreview(h.baseUrl, {});
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: "invalid domain" });
  });

  it("rejects empty domain with safe 400", async () => {
    const res = await postPreview(h.baseUrl, { domain: "" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: "invalid domain" });
  });

  it("rejects non-string domain with safe 400", async () => {
    const res = await postPreview(h.baseUrl, { domain: 42 });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: "invalid domain" });
  });

  it("rejects unsafe / malformed domain with safe 400", async () => {
    const res = await postPreview(h.baseUrl, {
      domain: "not a valid domain!!",
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: "invalid domain" });
  });

  it("rejects oversize domain with safe 400", async () => {
    const longDomain = `${"a".repeat(300)}.com`;
    const res = await postPreview(h.baseUrl, { domain: longDomain });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: "invalid domain" });
  });

  it("rejects malformed JSON body with safe 400 and does not echo body", async () => {
    const res = await fetch(`${h.baseUrl}${PREVIEW_PATH}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{not json secretpayload",
    });
    expect(res.status).toBe(400);
    const raw = await res.text();
    expect(raw).not.toContain("secretpayload");
    expect(JSON.parse(raw)).toEqual({
      ok: false,
      error: "invalid preview payload",
    });
  });

  it("rejects invalid query with safe 400", async () => {
    const res = await postPreview(h.baseUrl, {
      domain: "shop.example",
      query: "BAD QUERY!!",
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: "invalid query" });
  });

  it("never invoked the preview function for invalid inputs", () => {
    expect(fetcherCalls).toBe(0);
  });
});

describe("POST /admin/source-preview/awin — success via mocked adapter", () => {
  let h: Harness;
  let dbRef!: Db;
  beforeAll(async () => {
    const db = openDatabase(":memory:");
    upsertCouponCodes(db, "seeded.example", ["SEED1", "SEED2"]);
    appendResultRecord(db, {
      domain: "seeded.example",
      code: "SEED1",
      success: true,
      savingsCents: 100,
      finalTotalCents: 900,
    });
    const preview = buildFromAdapter(
      db,
      enabledConfig(),
      fixtureFetcher(loadFixture("awin-offers-ok.json")),
    );
    const server = createSalvareServer({
      db,
      adminToken: null,
      awinPreview: preview,
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address() as AddressInfo;
    h = { baseUrl: `http://127.0.0.1:${address.port}`, server, db };
    dbRef = db;
  });
  afterAll(async () => stopHarness(h));

  it("returns normalized candidates and writes no coupon rows", async () => {
    const before = counts(dbRef);
    const res = await postPreview(h.baseUrl, { domain: "shop.example" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.provider).toBe("awin");
    expect(body.domain).toBe("shop.example");
    expect(body.fetched).toBe(true);
    expect(body.cacheHit).toBe(false);
    expect(body.candidateCount).toBe(3);
    expect(Array.isArray(body.candidates)).toBe(true);
    expect(body.candidates).toHaveLength(3);
    expect(body.candidates[0]).toMatchObject({
      sourceId: "awin",
      domain: "shop.example",
      code: "AWIN10",
      label: "10% off your first order",
      expiresAt: "2026-12-31",
    });
    expect(body.errors).toEqual([]);

    const after = counts(dbRef);
    expect(after.coupons).toBe(before.coupons);
    expect(after.results).toBe(before.results);
    expect(after.fetchLog).toBeGreaterThan(before.fetchLog);
  });

  it("response never includes API key, Authorization, affiliate fields, or env vars", async () => {
    const res = await postPreview(h.baseUrl, { domain: "shop.example" });
    const raw = await res.text();
    expect(raw).not.toContain(API_KEY);
    expect(raw.toLowerCase()).not.toContain("authorization");
    expect(raw.toLowerCase()).not.toContain("bearer");
    expect(raw).not.toContain("clickThroughUrl");
    expect(raw).not.toContain("trackingUrl");
    expect(raw).not.toContain("commissionRate");
    expect(raw).not.toContain("deepLink");
    expect(raw).not.toContain("publisherId");
    expect(raw).not.toContain("awin1.com");
    expect(raw).not.toContain("SALVARE_AWIN_API_KEY");
    expect(raw).not.toContain("SALVARE_SOURCE_PROVIDER");
    expect(raw).not.toContain("SALVARE_ADMIN_TOKEN");
    expect(raw).not.toContain("dbPath");
    expect(raw).not.toContain("PATH");
    expect(raw).not.toContain("HOME");
  });

  it("second call against same domain serves cache hit and does not refetch", async () => {
    // First call already happened in prior tests; issue another to confirm.
    const res = await postPreview(h.baseUrl, { domain: "shop.example" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.cacheHit).toBe(true);
    expect(body.fetched).toBe(false);
    expect(body.candidateCount).toBe(3);
  });

  it("coupon_codes and coupon_results counts remain unchanged across all calls", async () => {
    const before = counts(dbRef);
    await postPreview(h.baseUrl, { domain: "shop.example" });
    await postPreview(h.baseUrl, { domain: "shop.example" });
    const after = counts(dbRef);
    expect(after.coupons).toBe(before.coupons);
    expect(after.results).toBe(before.results);
  });
});

describe("POST /admin/source-preview/awin — auth", () => {
  const TOKEN = "preview-token-xyz";
  let h: Harness;
  beforeAll(async () => {
    const stub: AwinPreviewFn = async () => ({
      ok: true,
      providerId: "awin",
      sourceId: "awin",
      outcome: "ok",
      candidates: [],
      errors: [],
      fetched: true,
      cacheHit: false,
      durationMs: 1,
    });
    h = await startHarness(stub, TOKEN);
  });
  afterAll(async () => stopHarness(h));

  it("returns 401 without Authorization", async () => {
    const res = await postPreview(h.baseUrl, { domain: "shop.example" });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });

  it("returns 401 with wrong token", async () => {
    const res = await postPreview(
      h.baseUrl,
      { domain: "shop.example" },
      "wrong-token",
    );
    expect(res.status).toBe(401);
  });

  it("accepts correct token", async () => {
    const res = await postPreview(
      h.baseUrl,
      { domain: "shop.example" },
      TOKEN,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });
});

describe("POST /admin/source-preview/:providerId — generic routing (v0.45.0)", () => {
  let h: Harness;
  let dbRef!: Db;
  beforeAll(async () => {
    const db = openDatabase(":memory:");
    const preview = buildFromAdapter(
      db,
      enabledConfig(),
      fixtureFetcher(loadFixture("awin-offers-ok.json")),
    );
    const server = createSalvareServer({
      db,
      adminToken: null,
      awinPreview: preview,
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address() as AddressInfo;
    h = { baseUrl: `http://127.0.0.1:${address.port}`, server, db };
    dbRef = db;
  });
  afterAll(async () => stopHarness(h));

  it("awin preview succeeds via the :providerId path with the v0.44 response shape", async () => {
    const res = await fetch(`${h.baseUrl}/admin/source-preview/awin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ domain: "shop.example" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.provider).toBe("awin");
    // Byte-identical key set vs v0.44 success envelope.
    expect(Object.keys(body).sort()).toEqual(
      [
        "ok",
        "provider",
        "domain",
        "cacheHit",
        "fetched",
        "candidateCount",
        "candidates",
        "errors",
      ].sort(),
    );
  });

  it("writes a source_fetch_log row with source_id='awin' on the generic path", async () => {
    await fetch(`${h.baseUrl}/admin/source-preview/awin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ domain: "fetchlog.example" }),
    });
    const row = dbRef
      .prepare(
        `SELECT source_id FROM source_fetch_log
           WHERE source_id = 'awin' ORDER BY id DESC LIMIT 1`,
      )
      .get() as { source_id: string } | undefined;
    expect(row).toBeDefined();
    expect(row!.source_id).toBe("awin");
  });

  it("unknown provider fails closed (HTTP 200 deny envelope, no stack/raw)", async () => {
    const res = await fetch(`${h.baseUrl}/admin/source-preview/bogus`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ domain: "shop.example" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.reason).toBe("unknown_provider");
    expect(body.provider).toBe("bogus");
    expect(body.candidates).toEqual([]);
    expect(body.disabled).toBeUndefined();
    const raw = JSON.stringify(body);
    expect(raw).not.toContain("Error");
    expect(raw).not.toContain("at ");
    expect(raw).not.toContain("stack");
  });

  it("impact preview is denied on the user surface (not_user_exposed)", async () => {
    const res = await fetch(`${h.baseUrl}/admin/source-preview/impact`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ domain: "shop.example" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.reason).toBe("not_user_exposed");
    expect(body.candidates).toEqual([]);
    expect(body.candidateCount).toBe(0);
  });

  it("illegal-charset segment returns 400 and never echoes the raw id", async () => {
    const res = await fetch(`${h.baseUrl}/admin/source-preview/aw!n`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ domain: "shop.example" }),
    });
    expect(res.status).toBe(400);
    const raw = await res.text();
    expect(JSON.parse(raw)).toEqual({ ok: false, error: "invalid provider" });
    expect(raw).not.toContain("aw!n");
  });

  it("oversize segment returns 400 without echoing the raw id", async () => {
    const huge = "a".repeat(64);
    const res = await fetch(
      `${h.baseUrl}/admin/source-preview/${huge}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain: "shop.example" }),
      },
    );
    expect(res.status).toBe(400);
    const raw = await res.text();
    expect(raw).not.toContain(huge);
  });
});
