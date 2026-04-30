export interface CartItem {
  id: string;
  name: string;
  category: string;
  priceCents: number;
  quantity: number;
  onSale?: boolean;

}

export interface Cart {
  items: CartItem[];
  shippingCents: number;
}

export type CouponType =
  | "percentage"
  | "fixed"
  | "free_shipping";

export interface Coupon {
  code: string;
  type: CouponType;

  // percentage = 0.25 for 25%
  // fixed = amount in cents
  value: number;

  minSpendCents?: number;

  // optional: restrict to categories
  categories?: string[];

  // optional: exclude sale items
  excludeSaleItems?: boolean;
  
  maxDiscountCents?: number;
}

export interface CouponEvaluationResult {
  coupon: Coupon;
  eligible: boolean;
  savingsCents: number;
  finalPriceCents: number;
  explanation: string;
}