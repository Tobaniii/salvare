import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createSalvareServer } from "./index";
import { openDatabase, type Db } from "./db";
import {
  getCandidateCodesForDomain,
  upsertCouponCodes,
} from "./db-coupons";
import {
  appendResultRecord,
  getResultsForDomain,
} from "./db-results";

interface Harness {
  baseUrl: string;
  server: Server;
  db: Db;
}

async function startHarness(adminToken: string | null): Promise<Harness> {
  const db = openDatabase(":memory:");
  upsertCouponCodes(db, "seed.com", ["S1", "S2"]);
  appendResultRecord(db, {
    domain: "seed.com",
    code: "S1",
    success: true,
    savingsCents: 50,
    finalTotalCents: 950,
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

describe("admin import apply (auth disabled)", () => {
  let h: Harness;

  beforeAll(async () => {
    h = await startHarness(null);
  });

  afterAll(async () => {
    await stopHarness(h);
  });

  it("POST /admin/import/apply/coupons writes payload and returns expected counts", async () => {
    const res = await fetch(`${h.baseUrl}/admin/import/apply/coupons`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        "apply-a.com": ["AA1", "AA2"],
        "apply-b.com": ["BB1"],
      }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      type: "coupons",
      domainsImported: 2,
      codesImported: 3,
    });
    expect(getCandidateCodesForDomain(h.db, "apply-a.com")).toEqual([
      "AA1",
      "AA2",
    ]);
    expect(getCandidateCodesForDomain(h.db, "apply-b.com")).toEqual(["BB1"]);
    // Untouched seeded domain remains.
    expect(getCandidateCodesForDomain(h.db, "seed.com")).toEqual(["S1", "S2"]);
  });

  it("POST /admin/import/apply/results writes payload and returns expected counts", async () => {
    const res = await fetch(`${h.baseUrl}/admin/import/apply/results`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        results: [
          {
            domain: "apply-a.com",
            code: "AA1",
            success: true,
            savingsCents: 100,
            finalTotalCents: 900,
            testedAt: "2026-05-03T01:00:00.000Z",
          },
          {
            domain: "apply-a.com",
            code: "AA2",
            success: false,
            savingsCents: 0,
            finalTotalCents: 1000,
            testedAt: "2026-05-03T02:00:00.000Z",
          },
          {
            domain: "apply-b.com",
            code: "BB1",
            success: true,
            savingsCents: 200,
            finalTotalCents: 800,
            testedAt: "2026-05-03T03:00:00.000Z",
          },
        ],
      }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      type: "results",
      recordsImported: 3,
      domainsReplaced: 2,
    });
    expect(getResultsForDomain(h.db, "apply-a.com").length).toBe(2);
    expect(getResultsForDomain(h.db, "apply-b.com").length).toBe(1);
    // Untouched seeded results remain.
    expect(getResultsForDomain(h.db, "seed.com").length).toBe(1);
  });

  it("apply coupons is idempotent — re-applying same payload leaves codes equal", async () => {
    const payload = JSON.stringify({ "idem.com": ["I1", "I2"] });
    const r1 = await fetch(`${h.baseUrl}/admin/import/apply/coupons`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
    });
    expect(r1.status).toBe(200);
    const codes1 = getCandidateCodesForDomain(h.db, "idem.com");
    const r2 = await fetch(`${h.baseUrl}/admin/import/apply/coupons`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
    });
    expect(r2.status).toBe(200);
    const codes2 = getCandidateCodesForDomain(h.db, "idem.com");
    expect(codes2).toEqual(codes1);
    expect(codes2).toEqual(["I1", "I2"]);
  });

  it("apply results is idempotent — re-applying same payload leaves history count stable", async () => {
    const payload = JSON.stringify({
      results: [
        {
          domain: "idem-r.com",
          code: "X1",
          success: true,
          savingsCents: 1,
          finalTotalCents: 1,
          testedAt: "2026-05-03T00:00:00.000Z",
        },
        {
          domain: "idem-r.com",
          code: "X2",
          success: false,
          savingsCents: 0,
          finalTotalCents: 2,
          testedAt: "2026-05-03T00:00:01.000Z",
        },
      ],
    });
    const r1 = await fetch(`${h.baseUrl}/admin/import/apply/results`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
    });
    expect(r1.status).toBe(200);
    const before = getResultsForDomain(h.db, "idem-r.com").length;
    const r2 = await fetch(`${h.baseUrl}/admin/import/apply/results`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
    });
    expect(r2.status).toBe(200);
    const after = getResultsForDomain(h.db, "idem-r.com").length;
    expect(after).toBe(before);
    expect(after).toBe(2);
  });

  it("apply rejects invalid coupons payload with safe 400 body", async () => {
    const res = await fetch(`${h.baseUrl}/admin/import/apply/coupons`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ "bad.com": "not-an-array" }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      ok: false,
      error: "invalid import payload",
    });
  });

  it("apply rejects invalid results payload with safe 400 body", async () => {
    const res = await fetch(`${h.baseUrl}/admin/import/apply/results`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ results: [{ domain: "x.com" }] }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      ok: false,
      error: "invalid import payload",
    });
  });

  it("apply rejects malformed JSON with safe 400 body", async () => {
    const res = await fetch(`${h.baseUrl}/admin/import/apply/coupons`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{not json",
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      ok: false,
      error: "invalid import payload",
    });
  });
});

describe("admin import apply (auth enabled)", () => {
  const TOKEN = "apply-test-token-xyz";
  let h: Harness;

  beforeAll(async () => {
    h = await startHarness(TOKEN);
  });

  afterAll(async () => {
    await stopHarness(h);
  });

  it("apply coupons rejects without Authorization", async () => {
    const res = await fetch(`${h.baseUrl}/admin/import/apply/coupons`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ "noauth.com": ["X"] }),
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
    // No mutation occurred.
    expect(getCandidateCodesForDomain(h.db, "noauth.com")).toEqual([]);
  });

  it("apply results rejects without Authorization", async () => {
    const res = await fetch(`${h.baseUrl}/admin/import/apply/results`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        results: [
          {
            domain: "noauth-r.com",
            code: "X",
            success: true,
            savingsCents: 1,
            finalTotalCents: 1,
            testedAt: "2026-05-03T00:00:00.000Z",
          },
        ],
      }),
    });
    expect(res.status).toBe(401);
    expect(getResultsForDomain(h.db, "noauth-r.com").length).toBe(0);
  });

  it("preview does not mutate; only apply writes to DB", async () => {
    const payload = {
      "preview-vs-apply.com": ["P1", "P2"],
    };
    const previewRes = await fetch(
      `${h.baseUrl}/admin/import/preview/coupons`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${TOKEN}`,
        },
        body: JSON.stringify(payload),
      },
    );
    expect(previewRes.status).toBe(200);
    expect(getCandidateCodesForDomain(h.db, "preview-vs-apply.com")).toEqual(
      [],
    );

    const applyRes = await fetch(
      `${h.baseUrl}/admin/import/apply/coupons`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${TOKEN}`,
        },
        body: JSON.stringify(payload),
      },
    );
    expect(applyRes.status).toBe(200);
    expect(getCandidateCodesForDomain(h.db, "preview-vs-apply.com")).toEqual([
      "P1",
      "P2",
    ]);
  });

  it("apply responses do not leak token, DB path, headers, env vars, full code lists, or unknown fields", async () => {
    const couponsRes = await fetch(
      `${h.baseUrl}/admin/import/apply/coupons`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${TOKEN}`,
        },
        body: JSON.stringify({
          "leak-apply.com": ["SECRETCODE-APPLY"],
          // Unknown fields would be parser-rejected, so add an obscure code value
          // and make sure it never echoes.
        }),
      },
    );
    const couponsBody = await couponsRes.json();
    const couponsRaw = JSON.stringify(couponsBody);

    const resultsRes = await fetch(
      `${h.baseUrl}/admin/import/apply/results`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${TOKEN}`,
        },
        body: JSON.stringify({
          results: [
            {
              domain: "leak-apply.com",
              code: "SECRETCODE-APPLY",
              success: true,
              savingsCents: 12345,
              finalTotalCents: 67890,
              testedAt: "2026-05-03T00:00:00.000Z",
              bonusUnknownField: "should-not-echo-apply",
            },
          ],
        }),
      },
    );
    const resultsBody = await resultsRes.json();
    const resultsRaw = JSON.stringify(resultsBody);

    for (const raw of [couponsRaw, resultsRaw]) {
      expect(raw).not.toContain(TOKEN);
      expect(raw).not.toContain("dbPath");
      expect(raw).not.toContain("authorization");
      expect(raw).not.toContain("Authorization");
      expect(raw).not.toContain("PATH");
      expect(raw).not.toContain("HOME");
      expect(raw).not.toContain("SECRETCODE-APPLY");
      expect(raw).not.toContain("12345");
      expect(raw).not.toContain("67890");
      expect(raw).not.toContain("bonusUnknownField");
      expect(raw).not.toContain("should-not-echo-apply");
    }

    expect(Object.keys(couponsBody).sort()).toEqual(
      ["codesImported", "domainsImported", "ok", "type"].sort(),
    );
    expect(Object.keys(resultsBody).sort()).toEqual(
      ["domainsReplaced", "ok", "recordsImported", "type"].sort(),
    );
  });
});
