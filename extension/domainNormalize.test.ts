import { describe, it, expect } from "vitest";
import { normalizeLookupDomain } from "./domainNormalize";

describe("normalizeLookupDomain (extension)", () => {
  it("lowercases and trims", () => {
    expect(normalizeLookupDomain("  Example.COM  ")).toBe("example.com");
  });

  it("strips a single leading www.", () => {
    expect(normalizeLookupDomain("www.example.com")).toBe("example.com");
    expect(normalizeLookupDomain("WWW.Example.com")).toBe("example.com");
  });

  it("strips only ONE leading www. and only the exact prefix", () => {
    expect(normalizeLookupDomain("www.www.example.com")).toBe(
      "www.example.com",
    );
    expect(normalizeLookupDomain("wwww.example.com")).toBe(
      "wwww.example.com",
    );
  });

  it("maps the www-prefixed wonderbly host to the canonical profile key", () => {
    // Profile literal is canonicalized to "wonderbly.com"; a real visit to
    // www.wonderbly.com must normalize to the same key.
    expect(normalizeLookupDomain("www.wonderbly.com")).toBe("wonderbly.com");
    expect(normalizeLookupDomain("wonderbly.com")).toBe("wonderbly.com");
  });

  it("leaves the other profile hosts unchanged", () => {
    for (const host of [
      "localhost",
      "salvare-test-store.myshopify.com",
      "salvare-woo-test.local",
    ]) {
      expect(normalizeLookupDomain(host)).toBe(host);
    }
  });
});
