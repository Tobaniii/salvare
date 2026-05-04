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
