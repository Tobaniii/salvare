import { describe, it, expect } from "vitest";
import { resolveMerchantAlias } from "./merchant-alias";

// Mirrors domain-normalize.parity.test.ts CASES (already-normalized inputs)
// plus the 4 store-profile domains and generic merchant-shaped hosts.
const CASES = [
  "localhost",
  "wonderbly.com",
  "salvare-test-store.myshopify.com",
  "salvare-woo-test.local",
  "example.com",
  "example.org",
  "a.example.com",
  "b.example.com",
  "shop.www.example.com",
  "",
];

describe("resolveMerchantAlias — shipped EMPTY (v0.51.0 no-op)", () => {
  it("is the identity function for every domain (byte-identical to v0.50)", () => {
    for (const input of CASES) {
      expect(resolveMerchantAlias(input)).toBe(input);
    }
  });

  it("never bleeds one merchant's key onto another (distinct in -> distinct out)", () => {
    const outputs = CASES.map((c) => resolveMerchantAlias(c));
    expect(new Set(outputs).size).toBe(new Set(CASES).size);
    expect(outputs).toEqual(CASES);
  });

  it("is idempotent: resolve(resolve(x)) === resolve(x)", () => {
    for (const input of CASES) {
      expect(resolveMerchantAlias(resolveMerchantAlias(input))).toBe(
        resolveMerchantAlias(input),
      );
    }
  });
});

describe("merchant-alias resolver contract (reference double)", () => {
  // Documents the exact `map[domain] ?? domain` semantics the shipped
  // resolver uses — explicit listed-key unify, unlisted identity, zero
  // cross-merchant bleed — without exposing the (intentionally empty)
  // in-code constant. The shipped resolver is this with an empty map.
  function reference(
    map: Readonly<Record<string, string>>,
    domain: string,
  ): string {
    return map[domain] ?? domain;
  }

  it("an explicitly listed domain unifies to its canonical target", () => {
    const map = { "uk.acme.example": "acme.example" } as const;
    expect(reference(map, "uk.acme.example")).toBe("acme.example");
  });

  it("an UNLISTED domain returns itself unchanged (no bleed)", () => {
    const map = { "uk.acme.example": "acme.example" } as const;
    expect(reference(map, "uk.beta.example")).toBe("uk.beta.example");
    expect(reference(map, "acme.example")).toBe("acme.example");
  });

  it("the shipped resolver equals the reference with an empty map", () => {
    for (const input of CASES) {
      expect(resolveMerchantAlias(input)).toBe(reference({}, input));
    }
  });
});
