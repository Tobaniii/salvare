import { describe, it, expect } from "vitest";
import { getStoreProfileForDomain } from "./storeProfiles";

describe("getStoreProfileForDomain", () => {
  it("returns the localhost profile", () => {
    const profile = getStoreProfileForDomain("localhost");
    expect(profile).not.toBeNull();
    expect(profile?.id).toBe("localhost-react-cart");
    expect(profile?.domain).toBe("localhost");
    expect(profile?.candidateCodes).toHaveLength(3);
  });

  it("exposes a stable id for every profile", () => {
    const ids = [
      "localhost",
      "www.wonderbly.com",
      "salvare-test-store.myshopify.com",
      "salvare-woo-test.local",
    ].map((d) => getStoreProfileForDomain(d)?.id);
    for (const id of ids) {
      expect(typeof id).toBe("string");
      expect(id?.length).toBeGreaterThan(0);
    }
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("returns the Shopify profile with selectors", () => {
    const profile = getStoreProfileForDomain(
      "salvare-test-store.myshopify.com",
    );
    expect(profile).not.toBeNull();
    expect(profile?.domain).toBe("salvare-test-store.myshopify.com");
    expect(profile?.selectors?.couponInput).toBeTruthy();
  });

  it("returns the WooCommerce profile with selectors", () => {
    const profile = getStoreProfileForDomain("salvare-woo-test.local");
    expect(profile).not.toBeNull();
    expect(profile?.domain).toBe("salvare-woo-test.local");
    expect(profile?.selectors?.applyButton).toBeTruthy();
  });

  it("returns null for an unsupported domain", () => {
    expect(getStoreProfileForDomain("example.com")).toBeNull();
  });
});

describe("getStoreProfileForDomain — v0.50.0 normalization regression", () => {
  // The 4 known hosts must resolve to exactly the same profile ids as
  // before normalization landed (no profile match changes).
  const EXPECTED: Array<[string, string]> = [
    ["localhost", "localhost-react-cart"],
    ["www.wonderbly.com", "wonderbly-com"],
    ["salvare-test-store.myshopify.com", "shopify-test-store"],
    ["salvare-woo-test.local", "woo-test-local"],
  ];

  it("resolves the 4 known hosts to unchanged profile ids", () => {
    for (const [host, id] of EXPECTED) {
      expect(getStoreProfileForDomain(host)?.id).toBe(id);
    }
  });

  it("resolves www. / case / whitespace variants to the same profile", () => {
    expect(getStoreProfileForDomain("WWW.WONDERBLY.COM")?.id).toBe(
      "wonderbly-com",
    );
    expect(getStoreProfileForDomain("wonderbly.com")?.id).toBe(
      "wonderbly-com",
    );
    expect(
      getStoreProfileForDomain("www.salvare-test-store.myshopify.com")?.id,
    ).toBe("shopify-test-store");
    expect(getStoreProfileForDomain("  localhost  ")?.id).toBe(
      "localhost-react-cart",
    );
  });

  it("stores the wonderbly profile under its canonical (www-free) domain", () => {
    expect(getStoreProfileForDomain("wonderbly.com")?.domain).toBe(
      "wonderbly.com",
    );
  });

  it("does not over-collapse distinct hosts", () => {
    expect(getStoreProfileForDomain("example.com")).toBeNull();
    expect(getStoreProfileForDomain("not-a-store.example")).toBeNull();
    const a = getStoreProfileForDomain("salvare-test-store.myshopify.com")?.id;
    const b = getStoreProfileForDomain("salvare-woo-test.local")?.id;
    expect(a).not.toBe(b);
  });
});
