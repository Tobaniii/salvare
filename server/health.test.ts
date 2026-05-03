import { describe, it, expect } from "vitest";
import { openDatabase } from "./db";
import { upsertCouponCodes } from "./db-coupons";
import { appendResultRecord } from "./db-results";
import {
  buildHealthFailureResponse,
  buildHealthResponse,
  SALVARE_SERVICE_NAME,
  SALVARE_VERSION,
} from "./health";

function freshDb() {
  return openDatabase(":memory:");
}

describe("buildHealthResponse", () => {
  it("returns the documented shape on an empty DB with auth disabled", () => {
    const body = buildHealthResponse({
      db: freshDb(),
      adminTokenConfigured: false,
    });
    expect(body).toEqual({
      ok: true,
      service: SALVARE_SERVICE_NAME,
      version: SALVARE_VERSION,
      database: {
        schemaInitialized: true,
        hasCoupons: false,
        hasResults: false,
      },
      auth: { adminTokenConfigured: false },
    });
  });

  it("reflects coupon and result presence", () => {
    const db = freshDb();
    upsertCouponCodes(db, "smoke.test", ["A1"]);
    appendResultRecord(db, {
      domain: "smoke.test",
      code: "A1",
      success: true,
      savingsCents: 100,
      finalTotalCents: 900,
    });
    const body = buildHealthResponse({ db, adminTokenConfigured: false });
    expect(body.database).toEqual({
      schemaInitialized: true,
      hasCoupons: true,
      hasResults: true,
    });
  });

  it("reflects adminTokenConfigured: true without referencing the value", () => {
    const body = buildHealthResponse({
      db: freshDb(),
      adminTokenConfigured: true,
    });
    expect(body.auth).toEqual({ adminTokenConfigured: true });
  });

  it("never includes coupon codes, result records, paths, or token-shaped data", () => {
    const db = freshDb();
    upsertCouponCodes(db, "redact.test", ["LEAK-CODE-XYZ"]);
    appendResultRecord(db, {
      domain: "redact.test",
      code: "LEAK-CODE-XYZ",
      success: true,
      savingsCents: 100,
      finalTotalCents: 900,
    });
    const json = JSON.stringify(
      buildHealthResponse({ db, adminTokenConfigured: true }),
    );
    expect(json).not.toContain("LEAK-CODE-XYZ");
    expect(json).not.toContain("redact.test");
    expect(json).not.toMatch(/Bearer/i);
    expect(json).not.toContain("salvare.db");
    expect(json).not.toContain("savingsCents");
    expect(json).not.toContain("testedAt");
  });

  it("uses an injected version when provided", () => {
    const body = buildHealthResponse({
      db: freshDb(),
      adminTokenConfigured: false,
      version: "9.9.9-test",
    });
    expect(body.version).toBe("9.9.9-test");
  });
});

describe("buildHealthFailureResponse", () => {
  it("returns the documented failure envelope", () => {
    expect(buildHealthFailureResponse()).toEqual({
      ok: false,
      service: SALVARE_SERVICE_NAME,
      error: "health check failed",
    });
  });
});
