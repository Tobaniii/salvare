import { describe, it, expect } from "vitest";
import { SUPPORT_REASON } from "./profileDiagnostics";
import {
  messageForReason,
  POPUP_CONNECT_ERROR,
  POPUP_FALLBACK_UNSUPPORTED,
} from "./popupMessages";

describe("messageForReason", () => {
  it("returns the ready message for ready", () => {
    expect(messageForReason(SUPPORT_REASON.Ready)).toBe(
      "Ready to test coupons.",
    );
  });

  it("returns the hostname-not-supported message", () => {
    expect(messageForReason(SUPPORT_REASON.HostnameUnrecognized)).toBe(
      "This store is not supported yet.",
    );
  });

  it("returns the no-candidate-codes message", () => {
    expect(messageForReason(SUPPORT_REASON.NoCandidateCodes)).toBe(
      "No coupon codes are saved for this store.",
    );
  });

  it("returns the coupon-input-missing message", () => {
    expect(messageForReason(SUPPORT_REASON.CouponInputMissing)).toBe(
      "Coupon box not found on this page.",
    );
  });

  it("returns the apply-button-missing message", () => {
    expect(messageForReason(SUPPORT_REASON.ApplyButtonMissing)).toBe(
      "Apply button not found on this page.",
    );
  });

  it("returns the total-missing message", () => {
    expect(messageForReason(SUPPORT_REASON.TotalMissing)).toBe(
      "Order total not found on this page.",
    );
  });

  it("falls back when reason is undefined", () => {
    expect(messageForReason(undefined)).toBe(POPUP_FALLBACK_UNSUPPORTED);
  });

  it("falls back for unknown reason strings", () => {
    expect(messageForReason("totally_made_up")).toBe(
      POPUP_FALLBACK_UNSUPPORTED,
    );
  });

  it("never includes DB paths, env vars, headers, or tokens", () => {
    const allMessages = [
      ...Object.values(SUPPORT_REASON).map(messageForReason),
      POPUP_FALLBACK_UNSUPPORTED,
      POPUP_CONNECT_ERROR,
    ];
    for (const msg of allMessages) {
      expect(msg).not.toMatch(/SALVARE_/);
      expect(msg).not.toMatch(/Authorization/i);
      expect(msg).not.toMatch(/\/Users\//);
      expect(msg).not.toMatch(/salvare\.db/);
    }
  });
});
