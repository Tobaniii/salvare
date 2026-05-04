import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createSalvareServer } from "./index";
import { openDatabase, type Db } from "./db";
import { upsertCouponCodes } from "./db-coupons";
import { appendResultRecord } from "./db-results";

interface Harness {
  baseUrl: string;
  server: Server;
  db: Db;
}

async function startHarness(adminToken: string | null): Promise<Harness> {
  const db = openDatabase(":memory:");
  upsertCouponCodes(db, "example.com", ["A1", "A2"]);
  appendResultRecord(db, {
    domain: "example.com",
    code: "A1",
    success: true,
    savingsCents: 100,
    finalTotalCents: 900,
  });

  const server = createSalvareServer({ db, adminToken });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
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

const PROTECTED_ENDPOINTS: Array<{
  name: string;
  path: string;
  init: RequestInit;
}> = [
  {
    name: "GET /admin/coupons",
    path: "/admin/coupons",
    init: { method: "GET" },
  },
  {
    name: "GET /admin/coupon-stats",
    path: "/admin/coupon-stats?domain=example.com",
    init: { method: "GET" },
  },
  {
    name: "POST /admin/coupons",
    path: "/admin/coupons",
    init: {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        domain: "auth-test.com",
        candidateCodes: ["X1"],
      }),
    },
  },
  {
    name: "DELETE /admin/coupons",
    path: "/admin/coupons?domain=example.com",
    init: { method: "DELETE" },
  },
  {
    name: "DELETE /results",
    path: "/results?domain=example.com",
    init: { method: "DELETE" },
  },
  {
    name: "GET /admin/export/coupons",
    path: "/admin/export/coupons",
    init: { method: "GET" },
  },
  {
    name: "GET /admin/export/results",
    path: "/admin/export/results",
    init: { method: "GET" },
  },
  {
    name: "POST /admin/import/preview/coupons",
    path: "/admin/import/preview/coupons",
    init: {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ "preview.com": ["P1"] }),
    },
  },
  {
    name: "POST /admin/import/preview/results",
    path: "/admin/import/preview/results",
    init: {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ results: [] }),
    },
  },
  {
    name: "POST /admin/import/apply/coupons",
    path: "/admin/import/apply/coupons",
    init: {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ "apply-auth.com": ["AA1"] }),
    },
  },
  {
    name: "POST /admin/import/apply/results",
    path: "/admin/import/apply/results",
    init: {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ results: [] }),
    },
  },
];

describe("auth disabled (no SALVARE_ADMIN_TOKEN)", () => {
  let h: Harness;

  beforeAll(async () => {
    h = await startHarness(null);
  });

  afterAll(async () => {
    await stopHarness(h);
  });

  it.each(PROTECTED_ENDPOINTS)(
    "$name responds normally without Authorization",
    async ({ path, init }) => {
      const res = await fetch(`${h.baseUrl}${path}`, init);
      expect(res.status).not.toBe(401);
    },
  );

  it("GET /coupons stays open", async () => {
    const res = await fetch(`${h.baseUrl}/coupons?domain=example.com`);
    expect(res.status).toBe(200);
  });

  it("POST /results stays open", async () => {
    const res = await fetch(`${h.baseUrl}/results`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        domain: "example.com",
        code: "A1",
        success: true,
        savingsCents: 50,
        finalTotalCents: 950,
      }),
    });
    expect(res.status).toBe(200);
  });

  it("GET /results stays open", async () => {
    const res = await fetch(`${h.baseUrl}/results?domain=example.com`);
    expect(res.status).toBe(200);
  });

  it("GET /health is unprotected and reports adminTokenConfigured: false", async () => {
    const res = await fetch(`${h.baseUrl}/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      ok: true,
      service: "salvare-backend",
      auth: { adminTokenConfigured: false },
    });
  });
});

describe("auth enabled (SALVARE_ADMIN_TOKEN set)", () => {
  const TOKEN = "test-token-abc-123";
  let h: Harness;

  beforeAll(async () => {
    h = await startHarness(TOKEN);
  });

  afterAll(async () => {
    await stopHarness(h);
  });

  describe("rejects without/with wrong credentials", () => {
    it.each(PROTECTED_ENDPOINTS)(
      "$name returns 401 with no Authorization header",
      async ({ path, init }) => {
        const res = await fetch(`${h.baseUrl}${path}`, init);
        expect(res.status).toBe(401);
        expect(await res.json()).toEqual({ error: "unauthorized" });
      },
    );

    it.each(PROTECTED_ENDPOINTS)(
      "$name returns 401 with wrong token",
      async ({ path, init }) => {
        const res = await fetch(`${h.baseUrl}${path}`, {
          ...init,
          headers: {
            ...(init.headers ?? {}),
            Authorization: "Bearer wrong-token",
          },
        });
        expect(res.status).toBe(401);
      },
    );

    it.each(PROTECTED_ENDPOINTS)(
      "$name returns 401 with non-Bearer scheme",
      async ({ path, init }) => {
        const res = await fetch(`${h.baseUrl}${path}`, {
          ...init,
          headers: {
            ...(init.headers ?? {}),
            Authorization: `Token ${TOKEN}`,
          },
        });
        expect(res.status).toBe(401);
      },
    );
  });

  describe("GET /admin stays unprotected (Option B)", () => {
    it("returns 200 with no Authorization header even when token is configured", async () => {
      const res = await fetch(`${h.baseUrl}/admin`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toMatch(/text\/html/);
    });
  });

  describe("accepts with correct Bearer token", () => {

    it("GET /admin/coupons returns coupon map", async () => {
      const res = await fetch(`${h.baseUrl}/admin/coupons`, {
        headers: { Authorization: `Bearer ${TOKEN}` },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.coupons).toEqual({ "example.com": ["A1", "A2"] });
    });

    it("GET /admin/coupon-stats returns ranked stats", async () => {
      const res = await fetch(
        `${h.baseUrl}/admin/coupon-stats?domain=example.com`,
        { headers: { Authorization: `Bearer ${TOKEN}` } },
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.domain).toBe("example.com");
      expect(Array.isArray(body.codes)).toBe(true);
    });

    it("POST /admin/coupons upserts and returns the saved record", async () => {
      const res = await fetch(`${h.baseUrl}/admin/coupons`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${TOKEN}`,
        },
        body: JSON.stringify({
          domain: "auth-ok.com",
          candidateCodes: ["NEW1"],
        }),
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        domain: "auth-ok.com",
        candidateCodes: ["NEW1"],
      });
    });

    it("DELETE /admin/coupons removes the domain", async () => {
      await fetch(`${h.baseUrl}/admin/coupons`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${TOKEN}`,
        },
        body: JSON.stringify({
          domain: "to-delete.com",
          candidateCodes: ["X"],
        }),
      });
      const res = await fetch(
        `${h.baseUrl}/admin/coupons?domain=to-delete.com`,
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${TOKEN}` },
        },
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        deleted: true,
        domain: "to-delete.com",
      });
    });

    it("GET /admin/export/coupons returns the seed-shaped payload", async () => {
      const res = await fetch(`${h.baseUrl}/admin/export/coupons`, {
        headers: { Authorization: `Bearer ${TOKEN}` },
      });
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toMatch(/application\/json/);
      expect(res.headers.get("content-disposition")).toContain(
        "salvare-coupons-export.json",
      );
      const body = await res.json();
      expect(body["example.com"]).toEqual(["A1", "A2"]);
    });

    it("GET /admin/export/results returns the results envelope", async () => {
      const res = await fetch(`${h.baseUrl}/admin/export/results`, {
        headers: { Authorization: `Bearer ${TOKEN}` },
      });
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toMatch(/application\/json/);
      expect(res.headers.get("content-disposition")).toContain(
        "salvare-results-export.json",
      );
      const body = await res.json();
      expect(Array.isArray(body.results)).toBe(true);
      expect(body.results.length).toBeGreaterThan(0);
      const first = body.results[0];
      expect(Object.keys(first).sort()).toEqual(
        [
          "code",
          "domain",
          "finalTotalCents",
          "savingsCents",
          "success",
          "testedAt",
        ].sort(),
      );
    });

    it("export endpoints do not leak token, db path, headers, or env values", async () => {
      const couponsRaw = await (
        await fetch(`${h.baseUrl}/admin/export/coupons`, {
          headers: { Authorization: `Bearer ${TOKEN}` },
        })
      ).text();
      const resultsRaw = await (
        await fetch(`${h.baseUrl}/admin/export/results`, {
          headers: { Authorization: `Bearer ${TOKEN}` },
        })
      ).text();

      for (const raw of [couponsRaw, resultsRaw]) {
        expect(raw).not.toContain(TOKEN);
        expect(raw).not.toContain("dbPath");
        expect(raw).not.toContain("authorization");
        expect(raw).not.toContain("Authorization");
        expect(raw).not.toContain("SALVARE_ADMIN_TOKEN");
        expect(raw).not.toContain("PATH");
        expect(raw).not.toContain("HOME");
      }
    });

    it("POST /admin/import/preview/coupons returns the summary for a valid payload", async () => {
      const res = await fetch(
        `${h.baseUrl}/admin/import/preview/coupons`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${TOKEN}`,
          },
          body: JSON.stringify({
            "preview-a.com": ["A1", "A2"],
            "preview-b.com": ["B1"],
          }),
        },
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({
        ok: true,
        type: "coupons",
        domains: 2,
        codes: 3,
        domainNames: ["preview-a.com", "preview-b.com"],
        domainNamesTruncated: false,
      });
    });

    it("POST /admin/import/preview/results returns the summary for a valid payload", async () => {
      const res = await fetch(
        `${h.baseUrl}/admin/import/preview/results`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${TOKEN}`,
          },
          body: JSON.stringify({
            results: [
              {
                domain: "preview-a.com",
                code: "A1",
                success: true,
                savingsCents: 100,
                finalTotalCents: 900,
                testedAt: "2026-05-03T00:00:00.000Z",
              },
              {
                domain: "preview-b.com",
                code: "B1",
                success: false,
                savingsCents: 0,
                finalTotalCents: 1000,
                testedAt: "2026-05-03T01:00:00.000Z",
              },
            ],
          }),
        },
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({
        ok: true,
        type: "results",
        records: 2,
        domains: 2,
        domainNames: ["preview-a.com", "preview-b.com"],
        domainNamesTruncated: false,
      });
    });

    it("import preview rejects invalid coupons payload with safe error body", async () => {
      const res = await fetch(
        `${h.baseUrl}/admin/import/preview/coupons`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${TOKEN}`,
          },
          body: JSON.stringify({ "bad.com": "not-an-array" }),
        },
      );
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({
        ok: false,
        error: "invalid import payload",
      });
    });

    it("import preview rejects invalid results payload with safe error body", async () => {
      const res = await fetch(
        `${h.baseUrl}/admin/import/preview/results`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${TOKEN}`,
          },
          body: JSON.stringify({ results: [{ domain: "x.com" }] }),
        },
      );
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({
        ok: false,
        error: "invalid import payload",
      });
    });

    it("import preview rejects malformed JSON body with safe error", async () => {
      const res = await fetch(
        `${h.baseUrl}/admin/import/preview/coupons`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${TOKEN}`,
          },
          body: "{not json",
        },
      );
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({
        ok: false,
        error: "invalid import payload",
      });
    });

    it("import preview does not mutate database contents", async () => {
      const before = await (
        await fetch(`${h.baseUrl}/admin/export/coupons`, {
          headers: { Authorization: `Bearer ${TOKEN}` },
        })
      ).text();
      const beforeResults = await (
        await fetch(`${h.baseUrl}/admin/export/results`, {
          headers: { Authorization: `Bearer ${TOKEN}` },
        })
      ).text();

      await fetch(`${h.baseUrl}/admin/import/preview/coupons`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${TOKEN}`,
        },
        body: JSON.stringify({ "should-not-persist.com": ["NEVER"] }),
      });
      await fetch(`${h.baseUrl}/admin/import/preview/results`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${TOKEN}`,
        },
        body: JSON.stringify({
          results: [
            {
              domain: "should-not-persist.com",
              code: "NEVER",
              success: true,
              savingsCents: 1,
              finalTotalCents: 1,
              testedAt: "2026-05-03T00:00:00.000Z",
            },
          ],
        }),
      });

      const after = await (
        await fetch(`${h.baseUrl}/admin/export/coupons`, {
          headers: { Authorization: `Bearer ${TOKEN}` },
        })
      ).text();
      const afterResults = await (
        await fetch(`${h.baseUrl}/admin/export/results`, {
          headers: { Authorization: `Bearer ${TOKEN}` },
        })
      ).text();
      expect(after).toBe(before);
      expect(afterResults).toBe(beforeResults);
      expect(after).not.toContain("should-not-persist.com");
      expect(afterResults).not.toContain("should-not-persist.com");
    });

    it("import preview responses do not leak token, db path, headers, env vars, full records, or unknown fields", async () => {
      const couponsRes = await fetch(
        `${h.baseUrl}/admin/import/preview/coupons`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${TOKEN}`,
          },
          body: JSON.stringify({
            "leak-test.com": ["SECRETCODE"],
          }),
        },
      );
      const couponsRaw = await couponsRes.text();

      const resultsRes = await fetch(
        `${h.baseUrl}/admin/import/preview/results`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${TOKEN}`,
          },
          body: JSON.stringify({
            results: [
              {
                domain: "leak-test.com",
                code: "SECRETCODE",
                success: true,
                savingsCents: 12345,
                finalTotalCents: 67890,
                testedAt: "2026-05-03T00:00:00.000Z",
                bonusUnknownField: "should-not-echo",
              },
            ],
          }),
        },
      );
      const resultsRaw = await resultsRes.text();

      for (const raw of [couponsRaw, resultsRaw]) {
        expect(raw).not.toContain(TOKEN);
        expect(raw).not.toContain("dbPath");
        expect(raw).not.toContain("authorization");
        expect(raw).not.toContain("Authorization");
        expect(raw).not.toContain("PATH");
        expect(raw).not.toContain("HOME");
        expect(raw).not.toContain("SECRETCODE");
        expect(raw).not.toContain("12345");
        expect(raw).not.toContain("67890");
        expect(raw).not.toContain("bonusUnknownField");
      }
    });

    it("DELETE /results clears history for the domain", async () => {
      const res = await fetch(`${h.baseUrl}/results?domain=example.com`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${TOKEN}` },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.domain).toBe("example.com");
      expect(typeof body.deletedCount).toBe("number");
    });
  });

  describe("unprotected endpoints stay open even with token configured", () => {
    it("GET /coupons works without Authorization", async () => {
      const res = await fetch(`${h.baseUrl}/coupons?domain=example.com`);
      expect(res.status).toBe(200);
    });

    it("POST /results works without Authorization (extension path)", async () => {
      const res = await fetch(`${h.baseUrl}/results`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          domain: "example.com",
          code: "A1",
          success: true,
          savingsCents: 50,
          finalTotalCents: 950,
        }),
      });
      expect(res.status).toBe(200);
    });

    it("GET /results works without Authorization", async () => {
      const res = await fetch(`${h.baseUrl}/results?domain=example.com`);
      expect(res.status).toBe(200);
    });

    it("GET /health works without Authorization and reflects token-configured", async () => {
      const res = await fetch(`${h.baseUrl}/health`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.service).toBe("salvare-backend");
      expect(typeof body.version).toBe("string");
      expect(body.database).toMatchObject({
        schemaInitialized: true,
        hasCoupons: true,
        hasResults: true,
      });
      expect(body.auth).toEqual({ adminTokenConfigured: true });
    });

    it("GET /health response does not contain the configured token value or seeded data", async () => {
      const res = await fetch(`${h.baseUrl}/health`);
      const raw = await res.text();
      expect(raw).not.toContain(TOKEN);
      // The harness seeds coupon code "A1" and domain "example.com" — neither
      // should leak through /health (coarse booleans only).
      expect(raw).not.toContain("A1");
      expect(raw).not.toContain("example.com");
    });
  });

  describe("CORS preflight", () => {
    it("OPTIONS to a protected endpoint returns 204 with no Authorization", async () => {
      const res = await fetch(`${h.baseUrl}/admin/coupons`, {
        method: "OPTIONS",
      });
      expect(res.status).toBe(204);
    });
  });
});
