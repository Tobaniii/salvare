import { describe, it, expect } from "vitest";
import {
  APPLY_BUTTON_KEYWORDS,
  COUPON_INPUT_KEYWORDS,
  buttonAttrsMatchApplyKeywords,
  inputAttrsMatchCouponKeywords,
} from "./selectors";

describe("inputAttrsMatchCouponKeywords", () => {
  it("matches an input named 'coupon_code'", () => {
    expect(
      inputAttrsMatchCouponKeywords({ name: "coupon_code" }),
    ).toBe(true);
  });

  it("matches via id, placeholder, or aria-label", () => {
    expect(inputAttrsMatchCouponKeywords({ id: "promoField" })).toBe(true);
    expect(
      inputAttrsMatchCouponKeywords({ placeholder: "Enter discount" }),
    ).toBe(true);
    expect(
      inputAttrsMatchCouponKeywords({ ariaLabel: "Voucher code" }),
    ).toBe(true);
  });

  it("ignores unrelated inputs", () => {
    expect(
      inputAttrsMatchCouponKeywords({
        name: "email",
        placeholder: "you@example.com",
      }),
    ).toBe(false);
  });

  it("treats null/undefined attrs as absent", () => {
    expect(
      inputAttrsMatchCouponKeywords({
        name: null,
        id: undefined,
        placeholder: null,
      }),
    ).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(
      inputAttrsMatchCouponKeywords({ placeholder: "PROMO CODE" }),
    ).toBe(true);
  });
});

describe("buttonAttrsMatchApplyKeywords", () => {
  it("matches a button labelled 'Apply'", () => {
    expect(
      buttonAttrsMatchApplyKeywords({ innerText: "Apply" }),
    ).toBe(true);
  });

  it("matches 'Redeem' and 'Use code' phrasing", () => {
    expect(
      buttonAttrsMatchApplyKeywords({ innerText: "Redeem" }),
    ).toBe(true);
    expect(
      buttonAttrsMatchApplyKeywords({ ariaLabel: "Use code" }),
    ).toBe(true);
  });

  it("ignores unrelated buttons", () => {
    expect(
      buttonAttrsMatchApplyKeywords({ innerText: "Continue to shipping" }),
    ).toBe(false);
  });
});

describe("keyword lists", () => {
  it("are non-empty and lower-case", () => {
    expect(COUPON_INPUT_KEYWORDS.length).toBeGreaterThan(0);
    for (const keyword of COUPON_INPUT_KEYWORDS) {
      expect(keyword).toBe(keyword.toLowerCase());
    }
    expect(APPLY_BUTTON_KEYWORDS.length).toBeGreaterThan(0);
    for (const keyword of APPLY_BUTTON_KEYWORDS) {
      expect(keyword).toBe(keyword.toLowerCase());
    }
  });
});
