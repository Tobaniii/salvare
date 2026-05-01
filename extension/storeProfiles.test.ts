import { describe, it, expect } from "vitest";
import { getStoreProfileForDomain } from "./storeProfiles";

describe("getStoreProfileForDomain", () => {
  it("returns the localhost profile", () => {
    const profile = getStoreProfileForDomain("localhost");
    expect(profile).not.toBeNull();
    expect(profile?.domain).toBe("localhost");
    expect(profile?.candidateCodes).toHaveLength(3);
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
