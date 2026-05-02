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
});
