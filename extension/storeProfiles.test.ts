import { describe, it, expect } from "vitest";
import {
  fetchCandidateCodes,
  getStoreProfileForDomain,
} from "./storeProfiles";

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

describe("fetchCandidateCodes", () => {
  it("returns candidate codes for localhost", async () => {
    await expect(fetchCandidateCodes("localhost")).resolves.toEqual([
      "SAVE10",
      "TAKE15",
      "FREESHIP",
    ]);
  });

  it("returns candidate codes for Shopify", async () => {
    await expect(
      fetchCandidateCodes("salvare-test-store.myshopify.com"),
    ).resolves.toEqual(["WELCOME10", "SAVE15", "FREESHIP"]);
  });

  it("returns candidate codes for WooCommerce", async () => {
    await expect(
      fetchCandidateCodes("salvare-woo-test.local"),
    ).resolves.toEqual(["WELCOME10", "TAKE20", "FREESHIP"]);
  });

  it("returns [] for an unsupported domain", async () => {
    await expect(fetchCandidateCodes("example.com")).resolves.toEqual([]);
  });
});
