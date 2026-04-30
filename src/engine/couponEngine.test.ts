import { describe, it, expect } from "vitest";
import {
  findBestCoupon,
  evaluateCoupon,
  getUpsellSuggestions,
} from "./couponEngine";
import type { Cart, Coupon } from "../types/types";

const cart: Cart = {
  items: [
    { id: "1", name: "T-Shirt", category: "apparel", priceCents: 2500, quantity: 2 },
    { id: "2", name: "Coffee Mug", category: "home", priceCents: 1200, quantity: 1 },
  ],
  shippingCents: 800,
};

const coupons: Coupon[] = [
  { code: "SAVE10", type: "percentage", value: 0.1 },
  { code: "TAKE15", type: "fixed", value: 1500, minSpendCents: 5000 },
];

describe("findBestCoupon", () => {
  it("returns the best coupon", () => {
    const result = findBestCoupon(cart, coupons);
    expect(result?.coupon.code).toBe("TAKE15");
  });

  it("returns null when no coupons are eligible", () => {
    const badCoupons: Coupon[] = [
      { code: "BIG", type: "fixed", value: 10000, minSpendCents: 999999 },
    ];

    const result = findBestCoupon(cart, badCoupons);
    expect(result).toBeNull();
  });

  it("chooses the better of percentage vs fixed", () => {
    const testCoupons: Coupon[] = [
      { code: "SAVE10", type: "percentage", value: 0.1 },
      { code: "TAKE5", type: "fixed", value: 500 },
    ];

    const result = findBestCoupon(cart, testCoupons);
    expect(result?.coupon.code).toBe("SAVE10");
  });

  it("prefers free shipping when it gives higher savings", () => {
  const testCoupons: Coupon[] = [
    { code: "SAVE10", type: "percentage", value: 0.1 },
    { code: "FREESHIP", type: "free_shipping", value: 0 },
  ];

  const result = findBestCoupon(cart, testCoupons);

  expect(result?.coupon.code).toBe("FREESHIP");
    });

  it("respects category restrictions", () => {
    const testCoupons: Coupon[] = [
      { code: "SHOES30", type: "percentage", value: 0.3, categories: ["shoes"] },
    ];

    const result = findBestCoupon(cart, testCoupons);
    expect(result).toBeNull();
  });

  it("excludes sale items correctly", () => {
    const cartWithSale: Cart = {
      items: [
        {
          id: "1",
          name: "Sneakers",
          category: "apparel",
          priceCents: 10000,
          quantity: 1,
          onSale: true,
        },
      ],
      shippingCents: 0,
    };

    const testCoupons: Coupon[] = [
      { code: "NOSALE", type: "percentage", value: 0.2, excludeSaleItems: true },
    ];

    const result = findBestCoupon(cartWithSale, testCoupons);
    expect(result).toBeNull();
  });
  });

    describe("evaluateCoupon", () => {
  it("applies percentage discount correctly", () => {
    const coupon: Coupon = { code: "SAVE10", type: "percentage", value: 0.1 };

    const result = evaluateCoupon(cart, coupon);

    expect(result.savingsCents).toBe(620);
  });

  it("fails when min spend not met", () => {
    const coupon: Coupon = {
      code: "BIG",
      type: "fixed",
      value: 1000,
      minSpendCents: 999999,
    };

    const result = evaluateCoupon(cart, coupon);

    expect(result.eligible).toBe(false);
  });
    });

describe("getUpsellSuggestions", () => {
  it("suggests better coupon when close to threshold", () => {
    const testCoupons: Coupon[] = [
      { code: "TAKE15", type: "fixed", value: 1500, minSpendCents: 5000 },
      { code: "TAKE20", type: "fixed", value: 2000, minSpendCents: 7000 },
    ];

    const best = evaluateCoupon(cart, testCoupons[0]);
    const suggestions = getUpsellSuggestions(cart, testCoupons, best);

    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions[0].coupon.code).toBe("TAKE20");
  });
});


