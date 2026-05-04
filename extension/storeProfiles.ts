export interface StoreSelectors {
  couponInput?: string;
  applyButton?: string;
  subtotal?: string;
  total?: string;
}

export interface StoreProfile {
  id: string;
  domain: string;
  candidateCodes: string[];
  selectors?: StoreSelectors;
}

const STORE_PROFILES: StoreProfile[] = [
  {
    id: "localhost-react-cart",
    domain: "localhost",
    candidateCodes: ["SAVE10", "TAKE15", "FREESHIP"],
  },
  {
    id: "wonderbly-com",
    domain: "www.wonderbly.com",
    candidateCodes: ["WELCOME10", "SAVE15", "FREESHIP"],
  },
  {
    id: "shopify-test-store",
    domain: "salvare-test-store.myshopify.com",
    candidateCodes: ["WELCOME10", "SAVE15", "FREESHIP"],
    selectors: {
      couponInput:
        "input[name='discount'], input[placeholder*='Discount'], input[aria-label*='Discount']",
      applyButton: "button[type='submit'], button",
      subtotal: ".total-line--subtotal .total-line__price",
      total:
        "[data-checkout-payment-due-target], .payment-due__price, .total-line__price",
    },
  },
  {
    id: "woo-test-local",
    domain: "salvare-woo-test.local",
    candidateCodes: ["WELCOME10", "TAKE20", "FREESHIP"],
    selectors: {
      couponInput:
        "input[name='coupon_code'], #coupon_code, input[placeholder*='coupon' i], input[aria-label*='coupon' i]",
      applyButton:
        "button[name='apply_coupon'], input[name='apply_coupon'], button[value='Apply coupon'], input[value='Apply coupon'], button[type='submit'][name='apply_coupon']",
      subtotal: ".cart-subtotal .woocommerce-Price-amount",
      total: ".order-total .woocommerce-Price-amount",
    },
  },
];

export function getStoreProfileForDomain(
  domain: string,
): StoreProfile | null {
  return STORE_PROFILES.find((profile) => profile.domain === domain) ?? null;
}
