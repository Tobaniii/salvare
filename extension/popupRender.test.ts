import { describe, it, expect } from "vitest";
import { SUPPORT_REASON } from "./profileDiagnostics";
import {
  renderProgressStatus,
  renderResultStatus,
  renderSupportStatus,
} from "./popupRender";

describe("renderSupportStatus", () => {
  it("renders the supported ready state with the smoke-required substrings", () => {
    const out = renderSupportStatus({
      supported: true,
      message: "Ready to test coupons.",
      reason: SUPPORT_REASON.Ready,
      profileId: "localhost-react-cart",
    });
    expect(out).toContain("Store supported");
    expect(out).toContain("Ready to test coupons.");
    expect(out).toContain("Profile: localhost-react-cart");
  });

  it("omits the profile line when profileId is missing", () => {
    const out = renderSupportStatus({
      supported: true,
      message: "Ready to test coupons.",
      reason: SUPPORT_REASON.Ready,
    });
    expect(out).toContain("Store supported");
    expect(out).toContain("Ready to test coupons.");
    expect(out).not.toContain("Profile:");
  });

  it("renders friendly text per unsupported reason", () => {
    expect(
      renderSupportStatus({
        supported: false,
        message: "ignored",
        reason: SUPPORT_REASON.HostnameUnrecognized,
      }),
    ).toBe("This store is not supported yet.");
    expect(
      renderSupportStatus({
        supported: false,
        message: "ignored",
        reason: SUPPORT_REASON.CouponInputMissing,
      }),
    ).toBe("Coupon box not found on this page.");
    expect(
      renderSupportStatus({
        supported: false,
        message: "ignored",
        reason: SUPPORT_REASON.ApplyButtonMissing,
      }),
    ).toBe("Apply button not found on this page.");
    expect(
      renderSupportStatus({
        supported: false,
        message: "ignored",
        reason: SUPPORT_REASON.TotalMissing,
      }),
    ).toBe("Order total not found on this page.");
    expect(
      renderSupportStatus({
        supported: false,
        message: "ignored",
        reason: SUPPORT_REASON.NoCandidateCodes,
      }),
    ).toBe("No coupon codes are saved for this store.");
  });

  it("falls back when reason is missing", () => {
    expect(
      renderSupportStatus({ supported: false, message: "ignored" }),
    ).toBe("Open a supported checkout page to use Salvare.");
  });
});

describe("renderResultStatus", () => {
  it("includes best code, final total, and savings", () => {
    const out = renderResultStatus({
      bestCode: "SAVE10",
      totalCents: 9000,
      savingsCents: 1000,
      codesTested: 3,
    });
    expect(out).toMatch(/^Best code: SAVE10\n/);
    expect(out).toContain("Final total: $90.00");
    expect(out).toContain("You saved: $10.00");
    expect(out).toContain("Codes tested: 3");
  });

  it("omits the codes-tested line when count is missing", () => {
    const out = renderResultStatus({
      bestCode: "SAVE10",
      totalCents: 9000,
      savingsCents: 1000,
    });
    expect(out).not.toContain("Codes tested");
  });

  it("omits the codes-tested line when count is zero", () => {
    const out = renderResultStatus({
      bestCode: "SAVE10",
      totalCents: 9000,
      savingsCents: 1000,
      codesTested: 0,
    });
    expect(out).not.toContain("Codes tested");
  });

  it("preserves the legacy three-line success pattern", () => {
    const out = renderResultStatus({
      bestCode: "TAKE15",
      totalCents: 8500,
      savingsCents: 1500,
      codesTested: 3,
    });
    expect(out).toMatch(
      /Best code: \S+\nFinal total: \$\d+\.\d{2}\nYou saved: \$\d+\.\d{2}/,
    );
  });
});

describe("renderResultStatus — v0.50.0 provenance + freshness (append-only)", () => {
  const base = { bestCode: "SAVE10", totalCents: 9000, savingsCents: 1000 };

  it("appends Source + Confidence + freshness AFTER the legacy lines", () => {
    const out = renderResultStatus({
      ...base,
      codesTested: 3,
      provenance: {
        sourceType: "seed",
        confidence: 100,
        discoveredAt: "2026-05-14T11:30:00.000Z",
      },
    });
    // Legacy contract still holds, anchored, unchanged.
    expect(out).toMatch(/^Best code: SAVE10\n/);
    expect(out).toMatch(
      /Best code: \S+\nFinal total: \$\d+\.\d{2}\nYou saved: \$\d+\.\d{2}/,
    );
    const lines = out.split("\n");
    expect(lines.slice(0, 4)).toEqual([
      "Best code: SAVE10",
      "Final total: $90.00",
      "You saved: $10.00",
      "Codes tested: 3",
    ]);
    expect(out).toContain("Source: seed");
    expect(out).toContain("Confidence: 100%");
    expect(out).toContain("Code found: 2026-05-14T11:30:00.000Z");
  });

  it("renders NO freshness line when the winner has no discoveredAt", () => {
    const out = renderResultStatus({
      ...base,
      provenance: { sourceType: "manual" },
    });
    expect(out).toContain("Source: manual");
    expect(out).not.toContain("Code found:");
    // Never invents/falls back to a response-level timestamp.
    expect(out).not.toMatch(/updated/i);
    expect(out).not.toContain("Confidence:");
  });

  it("degrades silently when provenance is absent (legacy output)", () => {
    const out = renderResultStatus({ ...base, codesTested: 2 });
    expect(out).toBe(
      "Best code: SAVE10\nFinal total: $90.00\nYou saved: $10.00\nCodes tested: 2",
    );
    expect(out).not.toContain("Source:");
  });

  it("appends the result-not-saved note when reportWarning is set", () => {
    const out = renderResultStatus({ ...base, reportWarning: true });
    expect(out).toContain("Note: result not saved");
    const lines = out.split("\n");
    expect(lines[lines.length - 1]).toBe(
      "Note: result not saved (backend offline?).",
    );
  });
});

describe("renderProgressStatus", () => {
  it("renders current of total without code when code is missing", () => {
    expect(renderProgressStatus({ current: 1, total: 3 })).toBe(
      "Testing 1 of 3...",
    );
  });

  it("includes the code line when a non-empty code is provided", () => {
    const out = renderProgressStatus({
      current: 2,
      total: 3,
      code: "SAVE10",
    });
    expect(out).toContain("Testing 2 of 3...");
    expect(out).toContain("Code: SAVE10");
  });

  it("trims whitespace-only codes and omits the code line", () => {
    const out = renderProgressStatus({
      current: 1,
      total: 2,
      code: "   ",
    });
    expect(out).toBe("Testing 1 of 2...");
  });

  it("falls back to a generic testing message when total is zero", () => {
    expect(renderProgressStatus({ current: 0, total: 0 })).toBe(
      "Testing coupons...",
    );
  });

  it("clamps current to at most total", () => {
    expect(renderProgressStatus({ current: 99, total: 3 })).toBe(
      "Testing 3 of 3...",
    );
  });

  it("floors fractional inputs", () => {
    expect(renderProgressStatus({ current: 1.7, total: 3.9 })).toBe(
      "Testing 1 of 3...",
    );
  });
});
