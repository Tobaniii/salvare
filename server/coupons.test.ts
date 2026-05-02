import { describe, it, expect } from "vitest";
import { buildCouponResponse } from "./coupons";
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
