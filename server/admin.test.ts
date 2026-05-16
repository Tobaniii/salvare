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

  it("includes the data export section and buttons", () => {
    const html = getAdminHtml();
    expect(html).toContain("Data export");
    expect(html).toContain('id="export-coupons-btn"');
    expect(html).toContain('id="export-results-btn"');
    expect(html).toContain("/admin/export/coupons");
    expect(html).toContain("/admin/export/results");
    expect(html).toContain("salvare-coupons-export.json");
    expect(html).toContain("salvare-results-export.json");
  });

  it("includes the import section with file inputs, preview/apply buttons, and IMPORT confirmation controls", () => {
    const html = getAdminHtml();
    expect(html).toContain("Import data");
    expect(html).toContain('id="import-coupons-file"');
    expect(html).toContain('id="import-coupons-preview"');
    expect(html).toContain('id="import-coupons-confirm"');
    expect(html).toContain('id="import-coupons-apply"');
    expect(html).toContain('id="import-results-file"');
    expect(html).toContain('id="import-results-preview"');
    expect(html).toContain('id="import-results-confirm"');
    expect(html).toContain('id="import-results-apply"');
    expect(html).toContain("/admin/import/preview/coupons");
    expect(html).toContain("/admin/import/preview/results");
    expect(html).toContain("/admin/import/apply/coupons");
    expect(html).toContain("/admin/import/apply/results");
    expect(html).toContain("Type <strong>IMPORT</strong>");
  });

  it("does not include reset UI", () => {
    const html = getAdminHtml();
    expect(html).not.toContain('id="admin-reset"');
    expect(html).not.toContain("/admin/reset");
  });

  it("includes the source preview section, provider selector, domain input, preview button, status, candidates, and errors containers", () => {
    const html = getAdminHtml();
    expect(html).toContain("Source preview");
    expect(html).toContain('id="source-preview-provider"');
    expect(html).toContain('id="source-preview-capabilities"');
    expect(html).toContain("nothing is saved on");
    expect(html).toContain('id="source-preview-domain"');
    expect(html).toContain('id="source-preview-btn"');
    expect(html).toContain('id="source-preview-status"');
    expect(html).toContain('id="source-preview-candidates"');
    expect(html).toContain('id="source-preview-errors"');
    expect(html).toContain("/admin/source-providers");
    expect(html).toContain("/admin/source-preview/");
  });

  it("source preview provider selector is registry-backed and exposes only the Awin id (no impact literal)", () => {
    const html = getAdminHtml();
    // The client allowlist must be exactly ["awin"] in v0.44.
    expect(html).toContain('ALLOWED_PROVIDER_IDS = ["awin"]');
    // No impact identifiers anywhere in the admin shell or its inline client.
    expect(html).not.toContain("impact");
    expect(html).not.toContain("Impact");
    expect(html).not.toContain("/admin/source-preview/impact");
    expect(html).not.toContain("/admin/source-import/impact");
  });

  it("embedded provider fallback only contains Awin with full capabilities", () => {
    const html = getAdminHtml();
    expect(html).toContain("FALLBACK_PROVIDERS");
    // Fallback capabilities must match the registry awin metadata.
    expect(html).toMatch(
      /FALLBACK_PROVIDERS[\s\S]*providerId:\s*"awin"[\s\S]*importSupported:\s*true/,
    );
  });

  it("does not include any source-preview import/apply controls or coupon-write routes for preview", () => {
    const html = getAdminHtml();
    expect(html).not.toContain("source-preview-apply");
    expect(html).not.toContain("source-preview-import");
    expect(html).not.toContain("/admin/source-preview/apply");
    expect(html).not.toContain("/admin/source-preview/import");
  });

  it("includes the source import controls and caption clarifying no auto-test/auto-apply", () => {
    const html = getAdminHtml();
    expect(html).toContain('id="source-import-confirm"');
    expect(html).toContain('id="source-import-btn"');
    expect(html).toContain("Import previewed candidates");
    expect(html).toContain("/admin/source-import/");
    expect(html).toContain("not");
    expect(html).toContain("auto-tested or auto-applied");
  });

  it("includes the read-only source provenance (stored claims) section with domain input, lookup button, and results container", () => {
    const html = getAdminHtml();
    expect(html).toContain("Stored source claims");
    expect(html).toContain('id="source-summary-domain"');
    expect(html).toContain('id="source-summary-btn"');
    expect(html).toContain('id="source-summary-status"');
    expect(html).toContain('id="source-summary-results"');
    expect(html).toContain("/admin/source-summary");
    expect(html).toContain("Read-only");
  });

  it("does not include any source-summary write/edit/delete controls", () => {
    const html = getAdminHtml();
    expect(html).not.toContain("source-summary-delete");
    expect(html).not.toContain("source-summary-edit");
    expect(html).not.toContain("source-summary-import");
    expect(html).not.toContain("source-summary-apply");
  });

  it("includes the read-only source status section with Load status button and result containers", () => {
    const html = getAdminHtml();
    expect(html).toContain("Source status");
    expect(html).toContain('id="source-status-btn"');
    expect(html).toContain('id="source-status-status"');
    expect(html).toContain('id="source-status-results"');
    expect(html).toContain("Load status");
    expect(html).toContain("/admin/source-status");
    expect(html).toContain("Read-only");
  });

  it("does not include any source-status refresh / import / write controls", () => {
    const html = getAdminHtml();
    expect(html).not.toContain("source-status-refresh");
    expect(html).not.toContain("source-status-import");
    expect(html).not.toContain("source-status-apply");
    expect(html).not.toContain("source-status-delete");
    expect(html).not.toContain("source-status-edit");
    expect(html).not.toContain("Refresh source");
  });
});
