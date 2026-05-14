import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createSalvareServer } from "./index";
import { openDatabase, type Db } from "./db";
import { upsertCouponCodes } from "./db-coupons";
import { importCouponsExport } from "./db-import";
import { importProviderCandidates } from "./db-source-import";
import { appendResultRecord } from "./db-results";
import { recordCouponCodeSource, BUILTIN_SOURCE_IDS } from "./db-sources";

const PATH = "/admin/source-summary";

interface Harness {
  baseUrl: string;
  server: Server;
  db: Db;
}

async function startHarness(
  db: Db,
  adminToken: string | null = null,
): Promise<Harness> {
  const server = createSalvareServer({ db, adminToken });
  await new Promise<void>((resolve) =>
    server.listen(0, "127.0.0.1", resolve),
  );
  const address = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    server,
    db,
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
  codeSources: number;
  fetchLog: number;
  cache: number;
  sources: number;
} {
  const coupons = (
    db.prepare("SELECT COUNT(*) AS n FROM coupon_codes").get() as { n: number }
  ).n;
  const results = (
    db.prepare("SELECT COUNT(*) AS n FROM coupon_results").get() as {
      n: number;
    }
  ).n;
  const codeSources = (
    db.prepare("SELECT COUNT(*) AS n FROM coupon_code_sources").get() as {
      n: number;
    }
  ).n;
  const fetchLog = (
    db.prepare("SELECT COUNT(*) AS n FROM source_fetch_log").get() as {
      n: number;
    }
  ).n;
  const cache = (
    db.prepare("SELECT COUNT(*) AS n FROM source_cache").get() as {
      n: number;
    }
  ).n;
  const sources = (
    db.prepare("SELECT COUNT(*) AS n FROM coupon_sources").get() as {
      n: number;
    }
  ).n;
  return { coupons, results, codeSources, fetchLog, cache, sources };
}

async function get(
  baseUrl: string,
  query: string,
  token?: string,
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (token !== undefined) headers.Authorization = `Bearer ${token}`;
  return fetch(`${baseUrl}${PATH}${query}`, { method: "GET", headers });
}

function seedMixedProvenance(db: Db): void {
  // 1. Admin-owned codes for shop.example (gets admin provenance via the
  //    helper's built-in writer).
  upsertCouponCodes(db, "shop.example", ["ADMIN10", "SHARED"]);

  // 2. Import an export-shaped payload — records `import` provenance.
  importCouponsExport(db, { "shop.example": ["ADMIN10", "SHARED", "IMP1"] });

  // 3. Add an Awin-imported candidate (shares SHARED with admin+import).
  importProviderCandidates(db, {
    sourceId: "awin",
    sourceName: "Awin",
    sourceType: "api",
    domain: "shop.example",
    candidates: [
      { domain: "shop.example", code: "SHARED", label: "10% off" },
      {
        domain: "shop.example",
        code: "AWINONLY",
        label: "Free shipping",
        expiresAt: "2026-12-31",
      },
    ],
  });

  // 4. Attach bootstrap `seed` provenance to SHARED (the `seed` coupon_sources
  //    row is auto-seeded by initSchema, so no ensureCouponSource is needed).
  const storeId = (
    db.prepare(`SELECT id FROM stores WHERE domain = ?`).get("shop.example") as
      | { id: number }
      | undefined
  )?.id as number;
  recordCouponCodeSource(db, {
    storeId,
    code: "SHARED",
    sourceId: BUILTIN_SOURCE_IDS.seed,
    discoveredAt: "2026-01-01T00:00:00.000Z",
  });
}

describe("GET /admin/source-summary — helper + route over mixed provenance", () => {
  let h: Harness;
  let dbRef!: Db;
  beforeAll(async () => {
    const db = openDatabase(":memory:");
    seedMixedProvenance(db);
    appendResultRecord(db, {
      domain: "shop.example",
      code: "ADMIN10",
      success: true,
      savingsCents: 50,
      finalTotalCents: 950,
    });
    h = await startHarness(db);
    dbRef = db;
  });
  afterAll(async () => stopHarness(h));

  it("returns codes with all source claims, source counts, and the truncated:false flag", async () => {
    const before = counts(dbRef);
    const res = await get(h.baseUrl, "?domain=shop.example");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.domain).toBe("shop.example");
    expect(typeof body.storeId).toBe("number");
    expect(body.truncated).toBe(false);

    const codeNames = (body.codes as Array<{ code: string }>).map(
      (c) => c.code,
    );
    expect(codeNames).toEqual(["ADMIN10", "SHARED", "IMP1", "AWINONLY"]);

    const shared = (body.codes as Array<{
      code: string;
      sources: Array<{ sourceId: string }>;
    }>).find((c) => c.code === "SHARED");
    expect(shared).toBeDefined();
    const sharedSources = shared!.sources.map((s) => s.sourceId).sort();
    expect(sharedSources).toEqual(["admin", "awin", "import", "seed"]);

    expect(body.codeCount).toBe(4);
    expect(body.sourceCount).toBe(4);
    expect(
      (
        body.sourceSummary as Array<{
          sourceId: string;
          codeCount: number;
        }>
      ).sort((a, b) => a.sourceId.localeCompare(b.sourceId)),
    ).toEqual([
      {
        sourceId: "admin",
        sourceName: "Admin UI",
        sourceType: "manual",
        codeCount: 2,
      },
      {
        sourceId: "awin",
        sourceName: "Awin",
        sourceType: "api",
        codeCount: 2,
      },
      {
        sourceId: "import",
        sourceName: "JSON import",
        sourceType: "import",
        codeCount: 3,
      },
      {
        sourceId: "seed",
        sourceName: "Bootstrap seed",
        sourceType: "seed",
        codeCount: 1,
      },
    ]);

    // Read-only: no DB row changes.
    expect(counts(dbRef)).toEqual(before);
  });

  it("response never contains sourceUrl, affiliate fields, API key, env vars, or DB path", async () => {
    const res = await get(h.baseUrl, "?domain=shop.example");
    const raw = await res.text();
    expect(raw).not.toContain("sourceUrl");
    expect(raw).not.toContain("clickThroughUrl");
    expect(raw).not.toContain("trackingUrl");
    expect(raw).not.toContain("commissionRate");
    expect(raw).not.toContain("publisherId");
    expect(raw).not.toContain("deepLink");
    expect(raw.toLowerCase()).not.toContain("authorization");
    expect(raw.toLowerCase()).not.toContain("bearer");
    expect(raw).not.toContain("SALVARE_AWIN_API_KEY");
    expect(raw).not.toContain("SALVARE_ADMIN_TOKEN");
    expect(raw).not.toContain("PATH");
    expect(raw).not.toContain("HOME");
    expect(raw).not.toContain("dbPath");
  });
});

describe("GET /admin/source-summary — unknown domain", () => {
  let h: Harness;
  beforeAll(async () => {
    const db = openDatabase(":memory:");
    h = await startHarness(db);
  });
  afterAll(async () => stopHarness(h));

  it("returns a safe empty summary (200) with storeId:null", async () => {
    const res = await get(h.baseUrl, "?domain=never-seeded.example");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      domain: "never-seeded.example",
      storeId: null,
      codeCount: 0,
      sourceCount: 0,
      truncated: false,
      codes: [],
      sourceSummary: [],
    });
  });
});

describe("GET /admin/source-summary — input validation", () => {
  let h: Harness;
  beforeAll(async () => {
    const db = openDatabase(":memory:");
    h = await startHarness(db);
  });
  afterAll(async () => stopHarness(h));

  it("missing domain returns safe 400", async () => {
    const res = await get(h.baseUrl, "");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: "invalid domain" });
  });

  it("empty domain returns safe 400", async () => {
    const res = await get(h.baseUrl, "?domain=");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: "invalid domain" });
  });

  it("unsafe / malformed domain returns safe 400 without echo", async () => {
    const res = await get(h.baseUrl, "?domain=not%20a%20domain%21%21");
    expect(res.status).toBe(400);
    const raw = await res.text();
    expect(raw).not.toContain("not a domain");
    expect(JSON.parse(raw)).toEqual({ ok: false, error: "invalid domain" });
  });

  it("oversize domain returns safe 400", async () => {
    const long = encodeURIComponent(`${"a".repeat(300)}.com`);
    const res = await get(h.baseUrl, `?domain=${long}`);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: "invalid domain" });
  });
});

describe("GET /admin/source-summary — auth", () => {
  const TOKEN = "summary-token-zzz";
  let h: Harness;
  beforeAll(async () => {
    const db = openDatabase(":memory:");
    upsertCouponCodes(db, "shop.example", ["A1"]);
    h = await startHarness(db, TOKEN);
  });
  afterAll(async () => stopHarness(h));

  it("returns 401 without Authorization", async () => {
    const res = await get(h.baseUrl, "?domain=shop.example");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });

  it("returns 401 with wrong token", async () => {
    const res = await get(h.baseUrl, "?domain=shop.example", "wrong-token");
    expect(res.status).toBe(401);
  });

  it("accepts correct token and returns 200", async () => {
    const res = await get(h.baseUrl, "?domain=shop.example", TOKEN);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.domain).toBe("shop.example");
  });
});

describe("GET /admin/source-summary — truncation at 500-code cap", () => {
  let h: Harness;
  let dbRef!: Db;
  beforeAll(async () => {
    const db = openDatabase(":memory:");
    const codes: string[] = [];
    for (let i = 0; i < 501; i += 1) {
      codes.push(`C${i.toString().padStart(4, "0")}`);
    }
    upsertCouponCodes(db, "bulk.example", codes);
    h = await startHarness(db);
    dbRef = db;
  });
  afterAll(async () => stopHarness(h));

  it("truncates to 500 codes and sets truncated:true; counts reflect the slice", async () => {
    const before = counts(dbRef);
    const res = await get(h.baseUrl, "?domain=bulk.example");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.truncated).toBe(true);
    expect(body.codeCount).toBe(500);
    expect((body.codes as unknown[]).length).toBe(500);
    expect(counts(dbRef)).toEqual(before);
  });
});
