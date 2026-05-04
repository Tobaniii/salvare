import { describe, it, expect } from "vitest";
import {
  deriveSupportReason,
  SUPPORT_REASON,
  type SupportDiagnosticInput,
} from "./profileDiagnostics";

const ALL_GOOD: SupportDiagnosticInput = {
  profileMatched: true,
  candidateCodeCount: 3,
  couponInputFound: true,
  applyButtonFound: true,
  totalDetected: true,
};

describe("deriveSupportReason", () => {
  it("returns ready when all signals are positive", () => {
    expect(deriveSupportReason(ALL_GOOD)).toBe(SUPPORT_REASON.Ready);
  });

  it("returns hostname_unrecognized when profile is missing", () => {
    expect(
      deriveSupportReason({ ...ALL_GOOD, profileMatched: false }),
    ).toBe(SUPPORT_REASON.HostnameUnrecognized);
  });

  it("returns no_candidate_codes when candidate list is empty", () => {
    expect(
      deriveSupportReason({ ...ALL_GOOD, candidateCodeCount: 0 }),
    ).toBe(SUPPORT_REASON.NoCandidateCodes);
  });

  it("returns coupon_input_missing when input not found", () => {
    expect(
      deriveSupportReason({ ...ALL_GOOD, couponInputFound: false }),
    ).toBe(SUPPORT_REASON.CouponInputMissing);
  });

  it("returns apply_button_missing when button not found", () => {
    expect(
      deriveSupportReason({ ...ALL_GOOD, applyButtonFound: false }),
    ).toBe(SUPPORT_REASON.ApplyButtonMissing);
  });

  it("returns total_missing when total not detected", () => {
    expect(
      deriveSupportReason({ ...ALL_GOOD, totalDetected: false }),
    ).toBe(SUPPORT_REASON.TotalMissing);
  });

  it("prefers hostname_unrecognized over later failures", () => {
    expect(
      deriveSupportReason({
        profileMatched: false,
        candidateCodeCount: 0,
        couponInputFound: false,
        applyButtonFound: false,
        totalDetected: false,
      }),
    ).toBe(SUPPORT_REASON.HostnameUnrecognized);
  });

  it("does not include codes, paths, env, or header values", () => {
    const reason = deriveSupportReason({
      ...ALL_GOOD,
      couponInputFound: false,
    });
    expect(reason).toBe(SUPPORT_REASON.CouponInputMissing);
    expect(reason).not.toContain("/");
    expect(reason).not.toContain("SALVARE_");
    expect(reason).not.toContain("Authorization");
  });
});
