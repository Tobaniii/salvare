import { describe, it, expect, beforeEach } from "vitest";
import {
  buildCouponResponse,
  deleteCoupons,
  getSeedData,
  resetSeedForTests,
  setPersistForTests,
  upsertCoupons,
  validateAdminBody,
  validateDomainParam,
} from "./coupons";
import seedData from "./coupons.seed.json";

describe("buildCouponResponse", () => {
  it("returns seeded codes for localhost", () => {
    const result = buildCouponResponse("localhost");
    expect(result.candidateCodes).toEqual(["SAVE10", "TAKE15", "FREESHIP"]);
    expect(result.source).toBe("mock-backend");
    expect(result.domain).toBe("localhost");
  });

  it("returns seeded codes for the Shopify test store", () => {
    const result = buildCouponResponse("salvare-test-store.myshopify.com");
    expect(result.candidateCodes).toEqual([
      "WELCOME10",
      "SAVE15",
      "FREESHIP",
    ]);
    expect(result.source).toBe("mock-backend");
  });

  it("returns seeded codes for the WooCommerce test store", () => {
    const result = buildCouponResponse("salvare-woo-test.local");
    expect(result.candidateCodes).toEqual(["WELCOME10", "TAKE20", "FREESHIP"]);
    expect(result.source).toBe("mock-backend");
  });

  it("returns empty codes and 'none' source for an unsupported domain", () => {
    const result = buildCouponResponse("example.com");
    expect(result.candidateCodes).toEqual([]);
    expect(result.source).toBe("none");
    expect(result.domain).toBe("example.com");
  });

  it("returns updatedAt as a non-empty string", () => {
    const result = buildCouponResponse("localhost");
    expect(typeof result.updatedAt).toBe("string");
    expect(result.updatedAt.length).toBeGreaterThan(0);
  });
});

describe("coupons.seed.json validation", () => {
  const seed = seedData as unknown;

  it("is a non-null plain object", () => {
    expect(typeof seed).toBe("object");
    expect(seed).not.toBeNull();
    expect(Array.isArray(seed)).toBe(false);
  });

  it("has only non-empty string domain keys", () => {
    const keys = Object.keys(seed as Record<string, unknown>);
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      expect(typeof key).toBe("string");
      expect(key.length).toBeGreaterThan(0);
    }
  });

  it("maps each domain to an array", () => {
    for (const value of Object.values(seed as Record<string, unknown>)) {
      expect(Array.isArray(value)).toBe(true);
    }
  });

  it("contains only non-empty string coupon codes", () => {
    for (const value of Object.values(seed as Record<string, unknown>)) {
      expect(Array.isArray(value)).toBe(true);
      for (const code of value as unknown[]) {
        expect(typeof code).toBe("string");
        expect((code as string).length).toBeGreaterThan(0);
      }
    }
  });
});

describe("admin pure logic", () => {
  beforeEach(() => {
    setPersistForTests(() => {});
    resetSeedForTests();
  });

  it("getSeedData returns the bundled seed map", () => {
    const seed = getSeedData();
    expect(seed.localhost).toEqual(["SAVE10", "TAKE15", "FREESHIP"]);
    expect(seed["salvare-test-store.myshopify.com"]).toEqual([
      "WELCOME10",
      "SAVE15",
      "FREESHIP",
    ]);
    expect(seed["salvare-woo-test.local"]).toEqual([
      "WELCOME10",
      "TAKE20",
      "FREESHIP",
    ]);
  });

  it("upsertCoupons adds a new domain", () => {
    const result = upsertCoupons("example.com", ["NEW10"]);
    expect(result).toEqual({
      domain: "example.com",
      candidateCodes: ["NEW10"],
    });
    expect(getSeedData()["example.com"]).toEqual(["NEW10"]);
  });

  it("upsertCoupons updates an existing domain", () => {
    const result = upsertCoupons("localhost", ["NEW_CODE"]);
    expect(result.candidateCodes).toEqual(["NEW_CODE"]);
    expect(getSeedData().localhost).toEqual(["NEW_CODE"]);
  });

  it("upsertCoupons trims and dedupes codes", () => {
    const result = upsertCoupons("dedupe.example.com", [
      " A ",
      "A",
      "B",
      "B",
      " C",
    ]);
    expect(result.candidateCodes).toEqual(["A", "B", "C"]);
  });

  it("validateAdminBody rejects non-object bodies", () => {
    expect(validateAdminBody(null)).toMatchObject({ ok: false });
    expect(validateAdminBody("not an object")).toMatchObject({ ok: false });
    expect(validateAdminBody([])).toMatchObject({ ok: false });
  });

  it("validateAdminBody rejects invalid domain", () => {
    expect(
      validateAdminBody({ domain: "", candidateCodes: ["A"] }),
    ).toMatchObject({ ok: false });
    expect(
      validateAdminBody({ domain: "   ", candidateCodes: ["A"] }),
    ).toMatchObject({ ok: false });
    expect(
      validateAdminBody({ domain: 42, candidateCodes: ["A"] }),
    ).toMatchObject({ ok: false });
  });

  it("validateAdminBody rejects invalid candidateCodes", () => {
    expect(
      validateAdminBody({ domain: "x.com", candidateCodes: "A" }),
    ).toMatchObject({ ok: false });
    expect(
      validateAdminBody({ domain: "x.com", candidateCodes: [""] }),
    ).toMatchObject({ ok: false });
    expect(
      validateAdminBody({ domain: "x.com", candidateCodes: [42] }),
    ).toMatchObject({ ok: false });
  });

  it("validateAdminBody accepts a valid body", () => {
    const result = validateAdminBody({
      domain: " example.com ",
      candidateCodes: ["A", "B"],
    });
    expect(result).toEqual({
      ok: true,
      domain: "example.com",
      candidateCodes: ["A", "B"],
    });
  });
});

describe("admin delete", () => {
  beforeEach(() => {
    setPersistForTests(() => {});
    resetSeedForTests();
  });

  it("deletes an existing domain", () => {
    const result = deleteCoupons("localhost");
    expect(result).toEqual({ deleted: true, domain: "localhost" });
    expect(getSeedData().localhost).toBeUndefined();
  });

  it("returns deleted: false for a missing domain", () => {
    const result = deleteCoupons("nonexistent.com");
    expect(result).toEqual({ deleted: false, domain: "nonexistent.com" });
    expect(getSeedData().localhost).toEqual(["SAVE10", "TAKE15", "FREESHIP"]);
  });

  it("trims whitespace before deleting", () => {
    const result = deleteCoupons("  localhost  ");
    expect(result).toEqual({ deleted: true, domain: "localhost" });
    expect(getSeedData().localhost).toBeUndefined();
  });

  it("validateDomainParam rejects missing/empty values", () => {
    expect(validateDomainParam(null)).toMatchObject({ ok: false });
    expect(validateDomainParam(undefined)).toMatchObject({ ok: false });
    expect(validateDomainParam("")).toMatchObject({ ok: false });
    expect(validateDomainParam("   ")).toMatchObject({ ok: false });
  });

  it("validateDomainParam accepts and trims a valid domain", () => {
    expect(validateDomainParam("x.com")).toEqual({ ok: true, domain: "x.com" });
    expect(validateDomainParam("  example.com  ")).toEqual({
      ok: true,
      domain: "example.com",
    });
  });
});
