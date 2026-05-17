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

// Sentinels smuggled into a real coupon_code_sources row to prove the
// allowlisted provenance builder cannot leak unsafe columns even when they
// are populated in the DB.
const SMUGGLED_URL = "https://evil.example/aff?pid=SMUGGLED_PUBLISHER";
const SMUGGLED_LABEL = "SMUGGLED_LABEL_clickThroughUrl_commissionRate";

const ALLOWED_PROVENANCE_KEYS = new Set([
  "code",
  "sourceType",
  "discoveredAt",
  "confidence",
]);

describe("GET /coupons — source-aware order + additive provenance (v0.50.0)", () => {
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
      // Smuggled unsafe fields on a real provenance row.
      label: SMUGGLED_LABEL,
      sourceUrl: SMUGGLED_URL,
    });
    h = await startHarness(db);
    dbRef = db;
  });
  afterAll(async () => stopHarness(h));

  it("adds candidateProvenance to the response keys (additive, no break)", async () => {
    const res = await fetch(`${h.baseUrl}/coupons?domain=shop.example`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(
      ["candidateCodes", "candidateProvenance", "domain", "source", "updatedAt"].sort(),
    );
    expect(typeof body.domain).toBe("string");
    expect(typeof body.source).toBe("string");
    expect(typeof body.updatedAt).toBe("string");
    expect(Array.isArray(body.candidateCodes)).toBe(true);
    for (const code of body.candidateCodes) {
      expect(typeof code).toBe("string");
    }
  });

  it("keeps candidateCodes byte-identical and in the same ranked order", async () => {
    const res = await fetch(`${h.baseUrl}/coupons?domain=shop.example`);
    const body = await res.json();
    // Same pre-change ranked order: C (seed+admin, fresh, conf=100) first,
    // B (admin+awin) before plain admin A/D. All untested -> source order.
    expect(body.candidateCodes).toEqual(["C", "B", "A", "D"]);
    expect(new Set(body.candidateCodes)).toEqual(new Set(["A", "B", "C", "D"]));
    expect(body.candidateCodes).toHaveLength(4);
  });

  it("source-weighted code appears before plain admin-only codes", async () => {
    const res = await fetch(`${h.baseUrl}/coupons?domain=shop.example`);
    const body = await res.json();
    const codes: string[] = body.candidateCodes;
    expect(codes[0]).toBe("C");
    expect(codes.indexOf("B")).toBeLessThan(codes.indexOf("A"));
    expect(codes.indexOf("B")).toBeLessThan(codes.indexOf("D"));
  });

  it("candidateProvenance is allowlist-only and aligned 1:1 with candidateCodes", async () => {
    const res = await fetch(`${h.baseUrl}/coupons?domain=shop.example`);
    const body = await res.json();
    const prov = body.candidateProvenance as Array<Record<string, unknown>>;
    expect(Array.isArray(prov)).toBe(true);
    // One entry per code, in candidateCodes order.
    expect(prov.map((p) => p.code)).toEqual(body.candidateCodes);
    for (const entry of prov) {
      for (const key of Object.keys(entry)) {
        expect(ALLOWED_PROVENANCE_KEYS.has(key)).toBe(true);
      }
      expect(typeof entry.code).toBe("string");
      expect(typeof entry.sourceType).toBe("string");
      expect((entry.sourceType as string).length).toBeGreaterThan(0);
      if ("confidence" in entry) {
        expect(typeof entry.confidence).toBe("number");
        expect(entry.confidence as number).toBeGreaterThanOrEqual(0);
        expect(entry.confidence as number).toBeLessThanOrEqual(100);
      }
      if ("discoveredAt" in entry) {
        expect(typeof entry.discoveredAt).toBe("string");
      }
    }
  });

  it("surfaces the allowlisted confidence for the seed-claimed code C", async () => {
    const res = await fetch(`${h.baseUrl}/coupons?domain=shop.example`);
    const body = await res.json();
    const cEntry = (
      body.candidateProvenance as Array<Record<string, unknown>>
    ).find((p) => p.code === "C");
    expect(cEntry).toBeDefined();
    expect(cEntry?.confidence).toBe(100);
    expect(cEntry?.discoveredAt).toBe("2026-05-14T11:30:00.000Z");
  });

  it("never leaks sourceId/sourceUrl/affiliate/raw fields, even when smuggled into a source row", async () => {
    const raw = await (
      await fetch(`${h.baseUrl}/coupons?domain=shop.example`)
    ).text();
    // Forbidden field names / secrets stay banned in the raw payload.
    expect(raw).not.toContain("sourceId");
    expect(raw).not.toContain("sourceName");
    expect(raw).not.toContain("source_id");
    expect(raw).not.toContain("sourceUrl");
    expect(raw).not.toContain("source_url");
    expect(raw).not.toContain("label");
    expect(raw).not.toContain("expiresAt");
    expect(raw).not.toContain("expires_at");
    expect(raw).not.toContain("clickThroughUrl");
    expect(raw).not.toContain("trackingUrl");
    expect(raw).not.toContain("commissionRate");
    expect(raw).not.toContain("publisherId");
    expect(raw.toLowerCase()).not.toContain("authorization");
    expect(raw.toLowerCase()).not.toContain("bearer");
    expect(raw).not.toContain("SALVARE_AWIN_API_KEY");
    expect(raw).not.toContain("PATH");
    expect(raw).not.toContain("HOME");
    // The actual smuggled values never appear.
    expect(raw).not.toContain(SMUGGLED_URL);
    expect(raw).not.toContain(SMUGGLED_LABEL);
    expect(raw).not.toContain("SMUGGLED_PUBLISHER");
  });

  it("the request does not write to coupon_results, coupon_codes, or provenance tables", async () => {
    const snapshot = () => ({
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
    });
    const before = snapshot();
    await fetch(`${h.baseUrl}/coupons?domain=shop.example`);
    await fetch(`${h.baseUrl}/coupons?domain=shop.example`);
    await fetch(`${h.baseUrl}/coupons?domain=shop.example`);
    expect(snapshot()).toEqual(before);
  });
});

describe("GET /coupons — admin-only codes carry manual provenance, order stable", () => {
  let h: Harness;
  beforeAll(async () => {
    const db = openDatabase(":memory:");
    upsertCouponCodes(db, "noclaims.example", ["FIRST", "SECOND", "THIRD"]);
    h = await startHarness(db);
  });
  afterAll(async () => stopHarness(h));

  it("returns admin-only codes in DB-insertion order", async () => {
    const res = await fetch(`${h.baseUrl}/coupons?domain=noclaims.example`);
    const body = await res.json();
    expect(body.candidateCodes).toEqual(["FIRST", "SECOND", "THIRD"]);
  });

  it("each code has exactly one manual (admin) provenance entry", async () => {
    const res = await fetch(`${h.baseUrl}/coupons?domain=noclaims.example`);
    const body = await res.json();
    const prov = body.candidateProvenance as Array<Record<string, unknown>>;
    expect(prov.map((p) => p.code)).toEqual(["FIRST", "SECOND", "THIRD"]);
    for (const entry of prov) {
      expect(entry.sourceType).toBe("manual");
      for (const key of Object.keys(entry)) {
        expect(ALLOWED_PROVENANCE_KEYS.has(key)).toBe(true);
      }
    }
  });
});

describe("GET /coupons — absent-field path (no codes, no provenance)", () => {
  let h: Harness;
  beforeAll(async () => {
    const db = openDatabase(":memory:");
    h = await startHarness(db);
  });
  afterAll(async () => stopHarness(h));

  it("omits candidateProvenance entirely for an unknown domain (4-key shape)", async () => {
    const res = await fetch(`${h.baseUrl}/coupons?domain=never-seeded.example`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(
      ["candidateCodes", "domain", "source", "updatedAt"].sort(),
    );
    expect(body).not.toHaveProperty("candidateProvenance");
    expect(body.candidateCodes).toEqual([]);
    expect(body.source).toBe("none");
  });
});

describe("GET /coupons — inbound domain normalization (v0.50.0)", () => {
  let h: Harness;
  beforeAll(async () => {
    const db = openDatabase(":memory:");
    upsertCouponCodes(db, "shop.example", ["N1", "N2"]);
    h = await startHarness(db);
  });
  afterAll(async () => stopHarness(h));

  it("resolves www. / case / whitespace variants to the canonical store", async () => {
    const canonical = await (
      await fetch(`${h.baseUrl}/coupons?domain=shop.example`)
    ).json();
    expect(canonical.candidateCodes).toEqual(["N1", "N2"]);

    for (const variant of [
      "WWW.SHOP.EXAMPLE",
      "www.shop.example",
      "  Shop.Example  ",
    ]) {
      const res = await fetch(
        `${h.baseUrl}/coupons?domain=${encodeURIComponent(variant)}`,
      );
      const body = await res.json();
      expect(body.candidateCodes).toEqual(["N1", "N2"]);
      expect(body.domain).toBe("shop.example");
    }
  });
});
