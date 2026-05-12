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
} from "./source-provider-awin";
import type {
  AwinProviderConfig,
  SourceProviderConfig,
} from "./source-provider-config";
import type { AwinPreviewFn } from "./admin-source-preview-routes";

const IMPORT_PATH = "/admin/source-import/awin";
const API_KEY = "secret-key-shhh";
const FIXED_NOW_MS = Date.parse("2026-05-12T12:00:00.000Z");

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
  db?: Db,
): Promise<Harness> {
  const harnessDb = db ?? openDatabase(":memory:");
  if (!db) {
    upsertCouponCodes(harnessDb, "seeded.example", ["SEED1", "SEED2"]);
    appendResultRecord(harnessDb, {
      domain: "seeded.example",
      code: "SEED1",
      success: true,
      savingsCents: 100,
      finalTotalCents: 900,
    });
  }
  const server = createSalvareServer({
    db: harnessDb,
    adminToken,
    awinPreview,
  });
  await new Promise<void>((resolve) =>
    server.listen(0, "127.0.0.1", resolve),
  );
  const address = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    server,
    db: harnessDb,
  };
}

async function stopHarness(h: Harness): Promise<void> {
  await new Promise<void>((resolve, reject) =>
    h.server.close((err) => (err ? reject(err) : resolve())),
  );
  h.db.close();
}

function counts(db: Db): {
  coupons: number;
  results: number;
  fetchLog: number;
  codeSources: number;
  awinCodeSources: number;
} {
  const coupons = (
    db.prepare("SELECT COUNT(*) AS n FROM coupon_codes").get() as { n: number }
  ).n;
  const results = (
    db.prepare("SELECT COUNT(*) AS n FROM coupon_results").get() as {
      n: number;
    }
  ).n;
  const fetchLog = (
    db.prepare("SELECT COUNT(*) AS n FROM source_fetch_log").get() as {
      n: number;
    }
  ).n;
  const codeSources = (
    db.prepare("SELECT COUNT(*) AS n FROM coupon_code_sources").get() as {
      n: number;
    }
  ).n;
  const awinCodeSources = (
    db
      .prepare(
        "SELECT COUNT(*) AS n FROM coupon_code_sources WHERE source_id = 'awin'",
      )
      .get() as { n: number }
  ).n;
  return { coupons, results, fetchLog, codeSources, awinCodeSources };
}

async function postImport(
  baseUrl: string,
  body: unknown,
  token?: string,
): Promise<Response> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (token !== undefined) headers.Authorization = `Bearer ${token}`;
  return fetch(`${baseUrl}${IMPORT_PATH}`, {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("POST /admin/source-import/awin — auth", () => {
  const TOKEN = "import-token-xyz";
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
    const res = await postImport(h.baseUrl, {
      domain: "shop.example",
      confirm: "IMPORT",
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });

  it("returns 401 with wrong token", async () => {
    const res = await postImport(
      h.baseUrl,
      { domain: "shop.example", confirm: "IMPORT" },
      "wrong-token",
    );
    expect(res.status).toBe(401);
  });

  it("accepts correct token", async () => {
    const res = await postImport(
      h.baseUrl,
      { domain: "shop.example", confirm: "IMPORT" },
      TOKEN,
    );
    expect(res.status).toBe(200);
  });
});

describe("POST /admin/source-import/awin — confirmation and validation", () => {
  let h: Harness;
  let previewCalls = 0;
  beforeAll(async () => {
    const stub: AwinPreviewFn = async () => {
      previewCalls += 1;
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

  it("rejects missing confirm with safe 400", async () => {
    const res = await postImport(h.baseUrl, { domain: "shop.example" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      ok: false,
      error: "confirmation required",
    });
  });

  it("rejects wrong confirm phrase with safe 400", async () => {
    const res = await postImport(h.baseUrl, {
      domain: "shop.example",
      confirm: "import",
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      ok: false,
      error: "confirmation required",
    });
  });

  it("rejects missing domain with safe 400 (confirm present)", async () => {
    const res = await postImport(h.baseUrl, { confirm: "IMPORT" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: "invalid domain" });
  });

  it("rejects malformed domain with safe 400", async () => {
    const res = await postImport(h.baseUrl, {
      domain: "not a domain!!",
      confirm: "IMPORT",
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: "invalid domain" });
  });

  it("rejects malformed JSON body with safe 400 and does not echo body", async () => {
    const res = await fetch(`${h.baseUrl}${IMPORT_PATH}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{not json secretvalue",
    });
    expect(res.status).toBe(400);
    const raw = await res.text();
    expect(raw).not.toContain("secretvalue");
    expect(JSON.parse(raw)).toEqual({
      ok: false,
      error: "invalid import payload",
    });
  });

  it("never invoked the preview function for invalid inputs", () => {
    expect(previewCalls).toBe(0);
  });
});

describe("POST /admin/source-import/awin — disabled provider envelope", () => {
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

  it("returns 200 ok:false disabled:true and writes nothing", async () => {
    const before = counts(h.db);
    const res = await postImport(h.baseUrl, {
      domain: "shop.example",
      confirm: "IMPORT",
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      ok: false,
      provider: "awin",
      domain: "shop.example",
      disabled: true,
      reason: "disabled",
      candidatesAccepted: 0,
      codesImported: 0,
      provenanceRecorded: 0,
      rejected: 0,
      errors: [],
    });
    expect(counts(h.db)).toEqual(before);
  });
});

describe("POST /admin/source-import/awin — success via mocked adapter", () => {
  let h: Harness;
  let dbRef!: Db;
  beforeAll(async () => {
    const db = openDatabase(":memory:");
    upsertCouponCodes(db, "shop.example", ["EXISTING1"]);
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
    h = await startHarness(preview, null, db);
    dbRef = db;
  });
  afterAll(async () => stopHarness(h));

  it("imports shop.example candidates additively and records awin provenance", async () => {
    const before = counts(dbRef);
    const res = await postImport(h.baseUrl, {
      domain: "shop.example",
      confirm: "IMPORT",
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.provider).toBe("awin");
    expect(body.domain).toBe("shop.example");
    // Fixture has AWIN10 + FREESHIP for shop.example; OTHER15 belongs to
    // other.example and must be rejected by the request-domain match.
    expect(body.candidatesAccepted).toBe(2);
    expect(body.codesImported).toBe(2);
    expect(body.provenanceRecorded).toBe(2);
    expect(body.rejected).toBe(1);
    expect(body.errors).toEqual([]);

    const after = counts(dbRef);
    // Pre-existing EXISTING1 row is preserved; AWIN10 + FREESHIP are added.
    expect(after.coupons).toBe(before.coupons + 2);
    expect(after.results).toBe(before.results);
    expect(after.awinCodeSources).toBe(before.awinCodeSources + 2);
  });

  it("does not delete pre-existing EXISTING1 or its admin provenance", async () => {
    const codeRow = dbRef
      .prepare(
        `SELECT c.code FROM coupon_codes c
           JOIN stores s ON s.id = c.store_id
          WHERE s.domain = ? AND c.code = ?`,
      )
      .get("shop.example", "EXISTING1") as { code: string } | undefined;
    expect(codeRow?.code).toBe("EXISTING1");
    const adminProvenance = (
      dbRef
        .prepare(
          `SELECT COUNT(*) AS n FROM coupon_code_sources
             WHERE code = ? AND source_id = 'admin'`,
        )
        .get("EXISTING1") as { n: number }
    ).n;
    expect(adminProvenance).toBe(1);
  });

  it("repeated import is idempotent — no duplicate rows", async () => {
    const before = counts(dbRef);
    const res = await postImport(h.baseUrl, {
      domain: "shop.example",
      confirm: "IMPORT",
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.candidatesAccepted).toBe(2);
    expect(body.codesImported).toBe(0);
    expect(body.provenanceRecorded).toBe(0);

    const after = counts(dbRef);
    expect(after.coupons).toBe(before.coupons);
    expect(after.awinCodeSources).toBe(before.awinCodeSources);
    expect(after.results).toBe(before.results);
  });

  it("does not write coupon_results across all calls", async () => {
    const before = counts(dbRef);
    await postImport(h.baseUrl, {
      domain: "shop.example",
      confirm: "IMPORT",
    });
    expect(counts(dbRef).results).toBe(before.results);
  });

  it("response does not include API key, Authorization, affiliate fields, or env vars", async () => {
    const res = await postImport(h.baseUrl, {
      domain: "shop.example",
      confirm: "IMPORT",
    });
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
});

describe("POST /admin/source-import/awin — shared code gains awin provenance", () => {
  let h: Harness;
  let dbRef!: Db;
  beforeAll(async () => {
    const db = openDatabase(":memory:");
    // Existing admin-owned code that happens to match a fixture code.
    upsertCouponCodes(db, "shop.example", ["AWIN10", "ADMINONLY"]);
    const preview = buildFromAdapter(
      db,
      enabledConfig(),
      fixtureFetcher(loadFixture("awin-offers-ok.json")),
    );
    h = await startHarness(preview, null, db);
    dbRef = db;
  });
  afterAll(async () => stopHarness(h));

  it("keeps a single coupon_codes row and adds awin provenance alongside admin", async () => {
    const couponBefore = counts(dbRef).coupons;
    const res = await postImport(h.baseUrl, {
      domain: "shop.example",
      confirm: "IMPORT",
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    // AWIN10 already exists; FREESHIP is new.
    expect(body.codesImported).toBe(1);
    // Both AWIN10 and FREESHIP gain new awin provenance rows.
    expect(body.provenanceRecorded).toBe(2);

    const awin10Rows = (
      dbRef
        .prepare(
          `SELECT COUNT(*) AS n FROM coupon_codes c
             JOIN stores s ON s.id = c.store_id
            WHERE s.domain = ? AND c.code = ?`,
        )
        .get("shop.example", "AWIN10") as { n: number }
    ).n;
    expect(awin10Rows).toBe(1);

    const awin10ProvenanceSources = dbRef
      .prepare(
        `SELECT source_id FROM coupon_code_sources WHERE code = ?
           ORDER BY source_id ASC`,
      )
      .all("AWIN10") as Array<{ source_id: string }>;
    expect(awin10ProvenanceSources.map((r) => r.source_id)).toEqual([
      "admin",
      "awin",
    ]);

    // ADMINONLY remains with admin provenance only and was never touched.
    const adminOnlyProvenance = dbRef
      .prepare(
        `SELECT source_id FROM coupon_code_sources WHERE code = ?`,
      )
      .all("ADMINONLY") as Array<{ source_id: string }>;
    expect(adminOnlyProvenance.map((r) => r.source_id)).toEqual(["admin"]);

    // No duplicate coupon_codes row for the store as a whole.
    const total = counts(dbRef).coupons;
    expect(total).toBe(couponBefore + 1); // only FREESHIP added
  });
});

describe("POST /admin/source-import/awin — does not import mismatched-domain candidates", () => {
  let h: Harness;
  let dbRef!: Db;
  beforeAll(async () => {
    const db = openDatabase(":memory:");
    const preview = buildFromAdapter(
      db,
      enabledConfig(),
      fixtureFetcher(loadFixture("awin-offers-ok.json")),
    );
    h = await startHarness(preview, null, db);
    dbRef = db;
  });
  afterAll(async () => stopHarness(h));

  it("for domain=other.example, only OTHER15 is imported and shop.example candidates are rejected", async () => {
    const res = await postImport(h.baseUrl, {
      domain: "other.example",
      confirm: "IMPORT",
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.domain).toBe("other.example");
    expect(body.candidatesAccepted).toBe(1);
    expect(body.codesImported).toBe(1);
    expect(body.provenanceRecorded).toBe(1);
    expect(body.rejected).toBe(2);

    const otherCodes = dbRef
      .prepare(
        `SELECT c.code FROM coupon_codes c
           JOIN stores s ON s.id = c.store_id
          WHERE s.domain = ?
          ORDER BY c.id ASC`,
      )
      .all("other.example") as Array<{ code: string }>;
    expect(otherCodes.map((r) => r.code)).toEqual(["OTHER15"]);
  });
});
