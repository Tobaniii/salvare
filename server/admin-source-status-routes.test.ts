import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createSalvareServer } from "./index";
import { openDatabase, type Db } from "./db";
import {
  recordSourceFetchAttempt,
  upsertSourceCacheEntry,
} from "./db-source-cache";
import type { ProviderStatusFn } from "./db-source-status";

const PATH = "/admin/source-status";

interface Harness {
  baseUrl: string;
  server: Server;
  db: Db;
}

async function startHarness(
  db: Db,
  options: {
    adminToken?: string | null;
    providerStatus?: ProviderStatusFn;
  } = {},
): Promise<Harness> {
  const server = createSalvareServer({
    db,
    adminToken: options.adminToken ?? null,
    providerStatus: options.providerStatus,
  });
  await new Promise<void>((resolve) =>
    server.listen(0, "127.0.0.1", resolve),
  );
  const address = server.address() as AddressInfo;
  return { baseUrl: `http://127.0.0.1:${address.port}`, server, db };
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
  codeSources: number;
  fetchLog: number;
  cache: number;
  sources: number;
} {
  const n = (sql: string) =>
    (db.prepare(sql).get() as { n: number }).n;
  return {
    coupons: n("SELECT COUNT(*) AS n FROM coupon_codes"),
    results: n("SELECT COUNT(*) AS n FROM coupon_results"),
    codeSources: n("SELECT COUNT(*) AS n FROM coupon_code_sources"),
    fetchLog: n("SELECT COUNT(*) AS n FROM source_fetch_log"),
    cache: n("SELECT COUNT(*) AS n FROM source_cache"),
    sources: n("SELECT COUNT(*) AS n FROM coupon_sources"),
  };
}

async function get(
  baseUrl: string,
  token?: string,
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (token !== undefined) headers.Authorization = `Bearer ${token}`;
  return fetch(`${baseUrl}${PATH}`, { method: "GET", headers });
}

const NOW = "2026-05-14T12:00:00.000Z";
const PAST = "2026-05-14T10:00:00.000Z";
const FUTURE = "2030-01-01T00:00:00.000Z";

describe("GET /admin/source-status — auth", () => {
  const TOKEN = "status-token-zzz";
  let h: Harness;
  beforeAll(async () => {
    const db = openDatabase(":memory:");
    h = await startHarness(db, { adminToken: TOKEN });
  });
  afterAll(async () => stopHarness(h));

  it("returns 401 without Authorization", async () => {
    const res = await get(h.baseUrl);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });

  it("returns 401 with wrong token", async () => {
    const res = await get(h.baseUrl, "nope");
    expect(res.status).toBe(401);
  });

  it("accepts correct token and returns 200", async () => {
    const res = await get(h.baseUrl, TOKEN);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.sources)).toBe(true);
  });
});

describe("GET /admin/source-status — shape and aggregation", () => {
  let h: Harness;
  let dbRef!: Db;
  beforeAll(async () => {
    const db = openDatabase(":memory:");
    upsertSourceCacheEntry(db, {
      sourceId: "seed",
      cacheKey: "k:1",
      fetchedAt: PAST,
      expiresAt: FUTURE,
      status: "ok",
      candidatesJson: JSON.stringify([{ code: "A" }, { code: "B" }]),
    });
    recordSourceFetchAttempt(
      db,
      {
        sourceId: "seed",
        cacheKey: "k:1",
        outcome: "ok",
        errorCode: null,
        durationMs: 42,
      },
      NOW,
    );
    h = await startHarness(db, {
      providerStatus: (sourceId) =>
        sourceId === "seed"
          ? { featureEnabled: true, configured: true }
          : { featureEnabled: false, configured: false },
    });
    dbRef = db;
  });
  afterAll(async () => stopHarness(h));

  it("returns one row per coupon_sources entry with the allowlisted fields", async () => {
    const before = counts(dbRef);
    const res = await get(h.baseUrl);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.sources)).toBe(true);
    const ids = (body.sources as Array<{ sourceId: string }>)
      .map((s) => s.sourceId)
      .sort();
    expect(ids).toEqual(["admin", "import", "seed"]);

    const seed = (body.sources as Array<Record<string, unknown>>).find(
      (s) => s.sourceId === "seed",
    )!;
    expect(seed.sourceName).toBe("Bootstrap seed");
    expect(seed.sourceType).toBe("seed");
    expect(seed.enabled).toBe(true);
    expect(seed.providerFeatureEnabled).toBe(true);
    expect(seed.providerConfigured).toBe(true);
    expect(seed.lastFetchAt).toBe(NOW);
    expect(seed.lastFetchOutcome).toBe("ok");
    expect(seed.lastSafeError).toBeNull();
    expect(seed.cacheEntries).toBe(1);
    expect(seed.freshCacheEntries).toBe(1);
    expect(seed.staleCacheEntries).toBe(0);
    expect(seed.cachedCandidateCount).toBe(2);
    expect(seed.newestCacheAt).toBe(PAST);
    expect(seed.nextAllowedFetchAt).toBe(FUTURE);

    expect(counts(dbRef)).toEqual(before);
  });

  it("response contains only the allowlisted top-level keys per source", async () => {
    const res = await get(h.baseUrl);
    const body = await res.json();
    const expected = new Set([
      "sourceId",
      "sourceName",
      "sourceType",
      "enabled",
      "providerFeatureEnabled",
      "providerConfigured",
      "lastFetchAt",
      "lastFetchOutcome",
      "lastSafeError",
      "cacheEntries",
      "freshCacheEntries",
      "staleCacheEntries",
      "cachedCandidateCount",
      "newestCacheAt",
      "nextAllowedFetchAt",
    ]);
    for (const row of body.sources as Array<Record<string, unknown>>) {
      for (const key of Object.keys(row)) {
        expect(expected.has(key)).toBe(true);
      }
    }
  });

  it("never echoes API key, env vars, raw payloads, headers, or affiliate fields", async () => {
    const res = await get(h.baseUrl);
    const raw = await res.text();
    expect(raw).not.toContain("SALVARE_AWIN_API_KEY");
    expect(raw).not.toContain("SALVARE_ADMIN_TOKEN");
    expect(raw.toLowerCase()).not.toContain("authorization");
    expect(raw.toLowerCase()).not.toContain("bearer");
    expect(raw).not.toContain("clickThroughUrl");
    expect(raw).not.toContain("trackingUrl");
    expect(raw).not.toContain("commissionRate");
    expect(raw).not.toContain("publisherId");
    expect(raw).not.toContain("deepLink");
    expect(raw).not.toContain("sourceUrl");
    expect(raw).not.toContain("body_sha256");
    expect(raw).not.toContain("metadata_json");
    expect(raw).not.toContain("candidates_json");
    expect(raw).not.toContain("dbPath");
  });
});

describe("GET /admin/source-status — read-only across repeated calls", () => {
  let h: Harness;
  let dbRef!: Db;
  beforeAll(async () => {
    const db = openDatabase(":memory:");
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
    h = await startHarness(db);
    dbRef = db;
  });
  afterAll(async () => stopHarness(h));

  it("does not change any table counts across 5 calls", async () => {
    const before = counts(dbRef);
    for (let i = 0; i < 5; i += 1) {
      const res = await get(h.baseUrl);
      expect(res.status).toBe(200);
    }
    expect(counts(dbRef)).toEqual(before);
  });
});

describe("GET /admin/source-status — disabled / unconfigured provider", () => {
  let h: Harness;
  beforeAll(async () => {
    const db = openDatabase(":memory:");
    h = await startHarness(db, {
      providerStatus: () => ({ featureEnabled: false, configured: false }),
    });
  });
  afterAll(async () => stopHarness(h));

  it("reports safe booleans only — no env var values, no key state details", async () => {
    const res = await get(h.baseUrl);
    expect(res.status).toBe(200);
    const body = await res.json();
    for (const row of body.sources as Array<Record<string, unknown>>) {
      expect(typeof row.providerFeatureEnabled).toBe("boolean");
      expect(typeof row.providerConfigured).toBe("boolean");
      expect(row.providerFeatureEnabled).toBe(false);
      expect(row.providerConfigured).toBe(false);
    }
  });

  it("missing key (featureEnabled=true, configured=false) is reported as booleans", async () => {
    const db = openDatabase(":memory:");
    const local = await startHarness(db, {
      providerStatus: (sid) =>
        sid === "seed"
          ? { featureEnabled: true, configured: false }
          : { featureEnabled: false, configured: false },
    });
    try {
      const res = await get(local.baseUrl);
      const body = await res.json();
      const seed = (body.sources as Array<Record<string, unknown>>).find(
        (s) => s.sourceId === "seed",
      )!;
      expect(seed.providerFeatureEnabled).toBe(true);
      expect(seed.providerConfigured).toBe(false);
    } finally {
      await stopHarness(local);
    }
  });
});

describe("GET /admin/source-status — corrupt cache row", () => {
  let h: Harness;
  beforeAll(async () => {
    const db = openDatabase(":memory:");
    db.prepare(
      `INSERT INTO source_cache
         (source_id, cache_key, fetched_at, expires_at, status,
          body_sha256, metadata_json, candidates_json)
         VALUES (?, ?, ?, ?, ?, NULL, NULL, ?)`,
    ).run("seed", "k:bad", PAST, FUTURE, "ok", "{this is not json");
    h = await startHarness(db);
  });
  afterAll(async () => stopHarness(h));

  it("does not throw or echo raw payload — cachedCandidateCount is 0", async () => {
    const res = await get(h.baseUrl);
    expect(res.status).toBe(200);
    const raw = await res.text();
    expect(raw).not.toContain("this is not json");
    const body = JSON.parse(raw);
    const seed = (body.sources as Array<Record<string, unknown>>).find(
      (s) => s.sourceId === "seed",
    )!;
    expect(seed.cachedCandidateCount).toBe(0);
  });
});
