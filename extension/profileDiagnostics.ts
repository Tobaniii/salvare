// Pure helpers that derive structured "why supported / why not" reason codes
// for the popup → content-script support check. Keeps existing user-facing
// `message` strings unchanged; the reason code is an additive diagnostic.

export const SUPPORT_REASON = {
  Ready: "ready",
  HostnameUnrecognized: "hostname_unrecognized",
  NoCandidateCodes: "no_candidate_codes",
  CouponInputMissing: "coupon_input_missing",
  ApplyButtonMissing: "apply_button_missing",
  TotalMissing: "total_missing",
} as const;

export type SupportReason =
  (typeof SUPPORT_REASON)[keyof typeof SUPPORT_REASON];

export interface SupportDiagnosticInput {
  profileMatched: boolean;
  candidateCodeCount: number;
  couponInputFound: boolean;
  applyButtonFound: boolean;
  totalDetected: boolean;
}

export function deriveSupportReason(
  input: SupportDiagnosticInput,
): SupportReason {
  if (!input.profileMatched) return SUPPORT_REASON.HostnameUnrecognized;
  if (input.candidateCodeCount <= 0) return SUPPORT_REASON.NoCandidateCodes;
  if (!input.couponInputFound) return SUPPORT_REASON.CouponInputMissing;
  if (!input.applyButtonFound) return SUPPORT_REASON.ApplyButtonMissing;
  if (!input.totalDetected) return SUPPORT_REASON.TotalMissing;
  return SUPPORT_REASON.Ready;
}
