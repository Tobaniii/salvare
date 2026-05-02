import { describe, it, expect } from "vitest";
import {
  buildCouponResponse,
  validateAdminBody,
  validateDomainParam,
} from "./coupons";
import seedData from "./coupons.seed.json";

describe("buildCouponResponse", () => {
  it("returns mock-backend source when codes are present", () => {
    const result = buildCouponResponse("localhost", [
      "SAVE10",
      "TAKE15",
      "FREESHIP",
    ]);
    expect(result.candidateCodes).toEqual(["SAVE10", "TAKE15", "FREESHIP"]);
    expect(result.source).toBe("mock-backend");
    expect(result.domain).toBe("localhost");
  });

  it("returns the codes verbatim and the right domain", () => {
    const result = buildCouponResponse("salvare-test-store.myshopify.com", [
      "WELCOME10",
      "SAVE15",
      "FREESHIP",
    ]);
    expect(result.candidateCodes).toEqual([
      "WELCOME10",
      "SAVE15",
      "FREESHIP",
    ]);
    expect(result.source).toBe("mock-backend");
    expect(result.domain).toBe("salvare-test-store.myshopify.com");
  });

  it("returns 'none' source for an empty codes array", () => {
    const result = buildCouponResponse("example.com", []);
    expect(result.candidateCodes).toEqual([]);
    expect(result.source).toBe("none");
    expect(result.domain).toBe("example.com");
  });

  it("returns updatedAt as a non-empty string", () => {
    const result = buildCouponResponse("localhost", ["A"]);
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

describe("validateAdminBody", () => {
  it("rejects non-object bodies", () => {
    expect(validateAdminBody(null)).toMatchObject({ ok: false });
    expect(validateAdminBody("not an object")).toMatchObject({ ok: false });
    expect(validateAdminBody([])).toMatchObject({ ok: false });
  });

  it("rejects invalid domain", () => {
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

  it("rejects invalid candidateCodes", () => {
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

  it("accepts a valid body and trims domain", () => {
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

describe("validateDomainParam", () => {
  it("rejects missing/empty values", () => {
    expect(validateDomainParam(null)).toMatchObject({ ok: false });
    expect(validateDomainParam(undefined)).toMatchObject({ ok: false });
    expect(validateDomainParam("")).toMatchObject({ ok: false });
    expect(validateDomainParam("   ")).toMatchObject({ ok: false });
  });

  it("accepts and trims a valid domain", () => {
    expect(validateDomainParam("x.com")).toEqual({
      ok: true,
      domain: "x.com",
    });
    expect(validateDomainParam("  example.com  ")).toEqual({
      ok: true,
      domain: "example.com",
    });
  });
});
