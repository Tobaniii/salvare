// Pure user-facing message helpers for the popup. Maps v0.17 diagnostic reason
// codes to short, friendly strings. Kept free of DOM access so the mapping is
// trivially unit-testable and reusable.

import { SUPPORT_REASON, type SupportReason } from "./profileDiagnostics";

export const POPUP_FALLBACK_UNSUPPORTED =
  "Open a supported checkout page to use Salvare.";

export const POPUP_CONNECT_ERROR = "Could not connect to page.";

const REASON_MESSAGES: Record<SupportReason, string> = {
  [SUPPORT_REASON.Ready]: "Ready to test coupons.",
  [SUPPORT_REASON.HostnameUnrecognized]: "This store is not supported yet.",
  [SUPPORT_REASON.NoCandidateCodes]:
    "No coupon codes are saved for this store.",
  [SUPPORT_REASON.CouponInputMissing]: "Coupon box not found on this page.",
  [SUPPORT_REASON.ApplyButtonMissing]: "Apply button not found on this page.",
  [SUPPORT_REASON.TotalMissing]: "Order total not found on this page.",
};

export function messageForReason(reason: string | undefined): string {
  if (!reason) return POPUP_FALLBACK_UNSUPPORTED;
  if (reason in REASON_MESSAGES) {
    return REASON_MESSAGES[reason as SupportReason];
  }
  return POPUP_FALLBACK_UNSUPPORTED;
}
