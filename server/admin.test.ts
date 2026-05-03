import { describe, it, expect } from "vitest";
import { getAdminHtml, parseCommaSeparatedCodes } from "./admin";

describe("parseCommaSeparatedCodes", () => {
  it("splits, trims, and drops empty entries", () => {
    expect(parseCommaSeparatedCodes("A, B,C ,, D ")).toEqual([
      "A",
      "B",
      "C",
      "D",
    ]);
  });

  it("returns [] for an empty input", () => {
    expect(parseCommaSeparatedCodes("")).toEqual([]);
  });

  it("preserves duplicates (dedupe happens server-side)", () => {
    expect(parseCommaSeparatedCodes("A,A,B")).toEqual(["A", "A", "B"]);
  });
});

describe("getAdminHtml", () => {
  it("returns a non-empty HTML page with the expected markers", () => {
    const html = getAdminHtml();
    expect(html.length).toBeGreaterThan(0);
    expect(html).toContain('id="admin-form"');
    expect(html).toContain('id="domains"');
  });

  it("includes the backend status panel markers", () => {
    const html = getAdminHtml();
    expect(html).toContain('id="health-panel"');
    expect(html).toContain('id="health-service"');
    expect(html).toContain('id="health-version"');
    expect(html).toContain('id="health-schema"');
    expect(html).toContain('id="health-coupons"');
    expect(html).toContain('id="health-results"');
    expect(html).toContain('id="health-token"');
    expect(html).toContain("Backend status");
  });
});
