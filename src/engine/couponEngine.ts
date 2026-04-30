import type {
  Cart,
  CartItem,
  Coupon,
  CouponEvaluationResult,
} from "../types/types";

export function itemTotalCents(item: CartItem): number {
  return item.priceCents * item.quantity;
}

export function getCartSubtotal(cart: Cart): number {
  return cart.items.reduce((sum, item) => sum + itemTotalCents(item), 0);
}

export function getEligibleItems(cart: Cart, coupon: Coupon): CartItem[] {
  return cart.items.filter((item) => {
    if (coupon.excludeSaleItems && item.onSale) return false;

    if (coupon.categories && coupon.categories.length > 0) {
      return coupon.categories.includes(item.category);
    }

    return true;
  });
}

export function getEligibleSubtotal(cart: Cart, coupon: Coupon): number {
  return getEligibleItems(cart, coupon).reduce(
    (sum, item) => sum + itemTotalCents(item),
    0,
  );
}

export function isCouponEligible(cart: Cart, coupon: Coupon): boolean {
  const eligibleSubtotal = getEligibleSubtotal(cart, coupon);

  if (coupon.type === "free_shipping") {
    return cart.shippingCents > 0;
  }

  if (eligibleSubtotal <= 0) {
    return false;
  }

  if (
    coupon.minSpendCents !== undefined &&
    eligibleSubtotal < coupon.minSpendCents
  ) {
    return false;
  }

  return true;
}

export function evaluateCoupon(
  cart: Cart,
  coupon: Coupon,
): CouponEvaluationResult {
  const subtotal = getCartSubtotal(cart);
  const eligibleSubtotal = getEligibleSubtotal(cart, coupon);
  const total = subtotal + cart.shippingCents;

  if (!isCouponEligible(cart, coupon)) {
    let reason = `Coupon ${coupon.code} is not eligible`;

    if (coupon.type === "free_shipping" && cart.shippingCents === 0) {
      reason = "Cart already has free shipping";
    } else if (eligibleSubtotal <= 0) {
      reason = "No items match this coupon's restrictions";
    } else if (
      coupon.minSpendCents !== undefined &&
      eligibleSubtotal < coupon.minSpendCents
    ) {
      reason = `Minimum spend of ${coupon.minSpendCents} cents not met. Eligible subtotal is ${eligibleSubtotal} cents.`;
    }

    return {
      coupon,
      eligible: false,
      savingsCents: 0,
      finalPriceCents: total,
      explanation: reason,
    };
  }

  let savings = 0;
  let explanation = "";

  switch (coupon.type) {
    case "percentage": {
      savings = Math.floor(eligibleSubtotal * coupon.value);

      if (coupon.maxDiscountCents !== undefined) {
        savings = Math.min(savings, coupon.maxDiscountCents);
      }

      const pct = Math.round(coupon.value * 100);
      explanation = `${coupon.code}: ${pct}% off saves ${savings} cents`;
      break;
    }

    case "fixed": {
      savings = Math.min(coupon.value, eligibleSubtotal);

      if (coupon.maxDiscountCents !== undefined) {
        savings = Math.min(savings, coupon.maxDiscountCents);
      }

      explanation = `${coupon.code}: saves ${savings} cents`;
      break;
    }

    case "free_shipping": {
      savings = cart.shippingCents;
      explanation = `${coupon.code}: free shipping saves ${savings} cents`;
      break;
    }
  }

  const finalPriceCents = Math.max(0, total - savings);

  return {
    coupon,
    eligible: true,
    savingsCents: savings,
    finalPriceCents,
    explanation,
  };
}

export function findBestCoupon(
  cart: Cart,
  coupons: Coupon[],
): CouponEvaluationResult | null {
  const eligibleResults = coupons
    .map((coupon) => evaluateCoupon(cart, coupon))
    .filter((result) => result.eligible);

  if (eligibleResults.length === 0) return null;

  return eligibleResults.reduce((best, current) =>
    current.finalPriceCents < best.finalPriceCents ? current : best,
  );
}

export const SUGGESTION_THRESHOLD_CENTS = 2000;

export interface UpsellSuggestion {
  coupon: Coupon;
  gapCents: number;
  potentialSavingsCents: number;
}

export function getUpsellSuggestions(
  cart: Cart,
  coupons: Coupon[],
  best: CouponEvaluationResult | null,
): UpsellSuggestion[] {
  const benchmark = best?.savingsCents ?? 0;

  const suggestions = coupons.flatMap<UpsellSuggestion>((coupon) => {
    if (coupon.minSpendCents === undefined) return [];

    const eligibleSubtotal = getEligibleSubtotal(cart, coupon);
    const gap = coupon.minSpendCents - eligibleSubtotal;
    if (gap <= 0 || gap > SUGGESTION_THRESHOLD_CENTS) return [];

    let simulatedSavings = 0;
    switch (coupon.type) {
      case "percentage":
        simulatedSavings = Math.floor(coupon.minSpendCents * coupon.value);
        break;
      case "fixed":
        simulatedSavings = coupon.value;
        break;
      case "free_shipping":
        simulatedSavings = cart.shippingCents;
        break;
    }

    if (coupon.maxDiscountCents !== undefined) {
      simulatedSavings = Math.min(simulatedSavings, coupon.maxDiscountCents);
    }

    if (simulatedSavings <= benchmark) return [];

    return [
      {
        coupon,
        gapCents: gap,
        potentialSavingsCents: simulatedSavings,
      },
    ];
  });

  return suggestions.sort(
    (a, b) => b.potentialSavingsCents - a.potentialSavingsCents,
  );
}
