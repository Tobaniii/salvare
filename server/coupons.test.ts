import { describe, it, expect } from "vitest";
import { buildCouponResponse } from "./coupons";

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
