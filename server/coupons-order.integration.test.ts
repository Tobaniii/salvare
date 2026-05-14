import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createSalvareServer } from "./index";
import { openDatabase, type Db } from "./db";
import { upsertCouponCodes } from "./db-coupons";
import { importProviderCandidates } from "./db-source-import";
import { recordCouponCodeSource, BUILTIN_SOURCE_IDS } from "./db-sources";

interface Harness {
  baseUrl: string;
  server: Server;
  db: Db;
}

async function startHarness(db: Db): Promise<Harness> {
  const server = createSalvareServer({ db, adminToken: null });
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

describe("GET /coupons — source-aware test ordering (v0.38.0)", () => {
  let h: Harness;
  let dbRef!: Db;
  beforeAll(async () => {
    const db = openDatabase(":memory:");
    upsertCouponCodes(db, "shop.example", ["A", "B", "C", "D"]);
    importProviderCandidates(db, {
      sourceId: "awin",
      sourceName: "Awin",
      sourceType: "api",
      domain: "shop.example",
      candidates: [{ domain: "shop.example", code: "B", label: "10% off" }],
    });
    const storeId = (
      db
        .prepare(`SELECT id FROM stores WHERE domain = ?`)
        .get("shop.example") as { id: number }
    ).id;
    recordCouponCodeSource(db, {
      storeId,
      code: "C",
      sourceId: BUILTIN_SOURCE_IDS.seed,
      discoveredAt: "2026-05-14T11:30:00.000Z",
      confidence: 100,
    });
    h = await startHarness(db);
    dbRef = db;
  });
  afterAll(async () => stopHarness(h));

  it("returns the same response keys as before (no shape change)", async () => {
    const res = await fetch(`${h.baseUrl}/coupons?domain=shop.example`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(
      ["candidateCodes", "domain", "source", "updatedAt"].sort(),
    );
    expect(typeof body.domain).toBe("string");
    expect(typeof body.source).toBe("string");
    expect(typeof body.updatedAt).toBe("string");
    expect(Array.isArray(body.candidateCodes)).toBe(true);
    for (const code of body.candidateCodes) {
      expect(typeof code).toBe("string");
    }
  });

  it("returns the same set of codes regardless of source weighting", async () => {
    const res = await fetch(`${h.baseUrl}/coupons?domain=shop.example`);
    const body = await res.json();
    expect(new Set(body.candidateCodes)).toEqual(new Set(["A", "B", "C", "D"]));
    expect(body.candidateCodes).toHaveLength(4);
  });

  it("does not include source metadata, sourceUrl, or affiliate fields in the response", async () => {
    const raw = await (
      await fetch(`${h.baseUrl}/coupons?domain=shop.example`)
    ).text();
    expect(raw).not.toContain("sourceId");
    expect(raw).not.toContain("sourceName");
    expect(raw).not.toContain("sourceType");
    expect(raw).not.toContain("sourceUrl");
    expect(raw).not.toContain("confidence");
    expect(raw).not.toContain("discoveredAt");
    expect(raw).not.toContain("clickThroughUrl");
    expect(raw).not.toContain("trackingUrl");
    expect(raw).not.toContain("commissionRate");
    expect(raw).not.toContain("publisherId");
    expect(raw.toLowerCase()).not.toContain("authorization");
    expect(raw.toLowerCase()).not.toContain("bearer");
    expect(raw).not.toContain("SALVARE_AWIN_API_KEY");
    expect(raw).not.toContain("PATH");
    expect(raw).not.toContain("HOME");
  });

  it("the request does not write to coupon_results, coupon_codes, or provenance tables", async () => {
    const before = {
      coupons: (
        dbRef
          .prepare("SELECT COUNT(*) AS n FROM coupon_codes")
          .get() as { n: number }
      ).n,
      results: (
        dbRef
          .prepare("SELECT COUNT(*) AS n FROM coupon_results")
          .get() as { n: number }
      ).n,
      codeSources: (
        dbRef
          .prepare("SELECT COUNT(*) AS n FROM coupon_code_sources")
          .get() as { n: number }
      ).n,
    };
    await fetch(`${h.baseUrl}/coupons?domain=shop.example`);
    await fetch(`${h.baseUrl}/coupons?domain=shop.example`);
    await fetch(`${h.baseUrl}/coupons?domain=shop.example`);
    const after = {
      coupons: (
        dbRef
          .prepare("SELECT COUNT(*) AS n FROM coupon_codes")
          .get() as { n: number }
      ).n,
      results: (
        dbRef
          .prepare("SELECT COUNT(*) AS n FROM coupon_results")
          .get() as { n: number }
      ).n,
      codeSources: (
        dbRef
          .prepare("SELECT COUNT(*) AS n FROM coupon_code_sources")
          .get() as { n: number }
      ).n,
    };
    expect(after).toEqual(before);
  });

  it("source-weighted code (multi-source-claimed or high-confidence/fresh) appears before plain admin-only codes among untested rows", async () => {
    const res = await fetch(`${h.baseUrl}/coupons?domain=shop.example`);
    const body = await res.json();
    const codes: string[] = body.candidateCodes;
    // C (seed + admin, fresh, confidence=100) outscores everyone, B (admin
    // + awin) outscores plain admin (A, D). All four are untested so the
    // history-based ranker uses input order — i.e., source order — as the
    // tie-break across the all-"none" bucket.
    expect(codes[0]).toBe("C");
    expect(codes.indexOf("B")).toBeLessThan(codes.indexOf("A"));
    expect(codes.indexOf("B")).toBeLessThan(codes.indexOf("D"));
  });
});

describe("GET /coupons — domain with no source metadata keeps stable input order", () => {
  let h: Harness;
  beforeAll(async () => {
    const db = openDatabase(":memory:");
    upsertCouponCodes(db, "noclaims.example", ["FIRST", "SECOND", "THIRD"]);
    h = await startHarness(db);
  });
  afterAll(async () => stopHarness(h));

  it("returns admin-only codes in DB-insertion order (no source signal)", async () => {
    const res = await fetch(
      `${h.baseUrl}/coupons?domain=noclaims.example`,
    );
    const body = await res.json();
    expect(body.candidateCodes).toEqual(["FIRST", "SECOND", "THIRD"]);
  });
});
