import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  fetchCandidateCodeResult,
  fetchCandidateCodes,
} from "./couponProvider";

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.reject(new Error("backend unavailable"))),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchCandidateCodes (mock fallback)", () => {
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

describe("fetchCandidateCodeResult (mock fallback)", () => {
  it("returns expected candidate codes for supported domains", async () => {
    const localhost = await fetchCandidateCodeResult("localhost");
    const shopify = await fetchCandidateCodeResult(
      "salvare-test-store.myshopify.com",
    );
    const woo = await fetchCandidateCodeResult("salvare-woo-test.local");

    expect(localhost.candidateCodes).toEqual([
      "SAVE10",
      "TAKE15",
      "FREESHIP",
    ]);
    expect(shopify.candidateCodes).toEqual([
      "WELCOME10",
      "SAVE15",
      "FREESHIP",
    ]);
    expect(woo.candidateCodes).toEqual(["WELCOME10", "TAKE20", "FREESHIP"]);
  });

  it("returns candidateCodes [] for an unsupported domain", async () => {
    const result = await fetchCandidateCodeResult("example.com");
    expect(result.candidateCodes).toEqual([]);
    expect(result.domain).toBe("example.com");
  });

  it("returns source equal to 'mock-profile'", async () => {
    const result = await fetchCandidateCodeResult("localhost");
    expect(result.source).toBe("mock-profile");
  });

  it("returns fetchedAt as a non-empty string", async () => {
    const result = await fetchCandidateCodeResult("localhost");
    expect(typeof result.fetchedAt).toBe("string");
    expect(result.fetchedAt.length).toBeGreaterThan(0);
  });
});

describe("fetchCandidateCodes — backend integration", () => {
  it("returns backend candidate codes when the backend succeeds", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              domain: "localhost",
              candidateCodes: ["BACKEND_ONLY"],
              source: "mock-backend",
              updatedAt: "2026-05-01T00:00:00.000Z",
            }),
        } as unknown as Response),
      ),
    );

    await expect(fetchCandidateCodes("localhost")).resolves.toEqual([
      "BACKEND_ONLY",
    ]);
  });

  it("returns [] when the backend reports an unsupported domain", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              domain: "example.com",
              candidateCodes: [],
              source: "none",
              updatedAt: "2026-05-01T00:00:00.000Z",
            }),
        } as unknown as Response),
      ),
    );

    await expect(fetchCandidateCodes("example.com")).resolves.toEqual([]);
  });

  it("falls back to mock candidate codes when the backend throws", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("network down"))),
    );

    await expect(fetchCandidateCodes("localhost")).resolves.toEqual([
      "SAVE10",
      "TAKE15",
      "FREESHIP",
    ]);
  });

  it("falls back to mock candidate codes when the backend response shape is invalid", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ wrong: "shape" }),
        } as unknown as Response),
      ),
    );

    await expect(fetchCandidateCodes("localhost")).resolves.toEqual([
      "SAVE10",
      "TAKE15",
      "FREESHIP",
    ]);
  });
});
