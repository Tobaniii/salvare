import { describe, it, expect } from "vitest";
import { normalizeLookupDomain } from "./domain-normalize";

describe("normalizeLookupDomain (server)", () => {
  it("lowercases and trims", () => {
    expect(normalizeLookupDomain("  Example.COM  ")).toBe("example.com");
  });

  it("strips a single leading www.", () => {
    expect(normalizeLookupDomain("www.example.com")).toBe("example.com");
    expect(normalizeLookupDomain("WWW.Example.com")).toBe("example.com");
    expect(normalizeLookupDomain("  www.example.com ")).toBe("example.com");
  });

  it("strips only ONE leading www. and only the exact prefix", () => {
    expect(normalizeLookupDomain("www.www.example.com")).toBe(
      "www.example.com",
    );
    // "wwww." does not start with the exact "www." token boundary
    expect(normalizeLookupDomain("wwww.example.com")).toBe(
      "wwww.example.com",
    );
  });

  it("does not touch a non-leading www", () => {
    expect(normalizeLookupDomain("shop.www.example.com")).toBe(
      "shop.www.example.com",
    );
  });

  it("leaves canonical hosts unchanged", () => {
    for (const host of [
      "localhost",
      "wonderbly.com",
      "salvare-test-store.myshopify.com",
      "salvare-woo-test.local",
    ]) {
      expect(normalizeLookupDomain(host)).toBe(host);
    }
  });

  it("does not over-collapse distinct hosts", () => {
    const a = normalizeLookupDomain("a.example.com");
    const b = normalizeLookupDomain("b.example.com");
    expect(a).not.toBe(b);
    expect(normalizeLookupDomain("example.com")).not.toBe(
      normalizeLookupDomain("example.org"),
    );
  });
});
