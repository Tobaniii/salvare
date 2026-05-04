// @vitest-environment happy-dom

// End-to-end-ish unit tests that compose the pure DOM scan with the pure
// reason-mapper. They confirm that each fixture produces the expected
// SUPPORT_REASON code without going through the chrome.* APIs or the network.

import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { scanCheckoutDom } from "./checkoutScan";
import {
  deriveSupportReason,
  SUPPORT_REASON,
  type SupportReason,
} from "./profileDiagnostics";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = resolve(TEST_DIR, "..", "public", "fixtures");

function loadFixture(name: string): Document {
  const html = readFileSync(resolve(FIXTURES_DIR, name), "utf8");
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  document.body.innerHTML = bodyMatch ? bodyMatch[1] : html;
  return document;
}

function reasonFor(name: string, candidateCodeCount = 3): SupportReason {
  const doc = loadFixture(name);
  const scan = scanCheckoutDom({ root: doc, view: window });
  return deriveSupportReason({
    profileMatched: true,
    candidateCodeCount,
    couponInputFound: scan.couponInputCount > 0,
    applyButtonFound: scan.applyButtonCount > 0,
    totalDetected: scan.totalText !== null,
  });
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("scan + deriveSupportReason against local fixtures", () => {
  it("alt-coupon.html → Ready", () => {
    expect(reasonFor("alt-coupon.html")).toBe(SUPPORT_REASON.Ready);
  });

  it("alt-apply.html → Ready", () => {
    expect(reasonFor("alt-apply.html")).toBe(SUPPORT_REASON.Ready);
  });

  it("missing-input.html → coupon_input_missing", () => {
    expect(reasonFor("missing-input.html")).toBe(
      SUPPORT_REASON.CouponInputMissing,
    );
  });

  it("missing-button.html → apply_button_missing", () => {
    expect(reasonFor("missing-button.html")).toBe(
      SUPPORT_REASON.ApplyButtonMissing,
    );
  });

  it("missing-total.html → total_missing", () => {
    expect(reasonFor("missing-total.html")).toBe(SUPPORT_REASON.TotalMissing);
  });

  it("no-candidate-codes path is independent of DOM shape", () => {
    expect(reasonFor("alt-coupon.html", 0)).toBe(
      SUPPORT_REASON.NoCandidateCodes,
    );
  });

  it("hostname_unrecognized short-circuits before any DOM scan", () => {
    const reason = deriveSupportReason({
      profileMatched: false,
      candidateCodeCount: 0,
      couponInputFound: false,
      applyButtonFound: false,
      totalDetected: false,
    });
    expect(reason).toBe(SUPPORT_REASON.HostnameUnrecognized);
  });
});
