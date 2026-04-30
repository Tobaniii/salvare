import { evaluateCoupon, findBestCoupon } from "./couponEngine";
import type { Cart, Coupon } from "../types/types";

const cart: Cart = {
  shippingCents: 500,
  items: [
    {
      id: "1",
      name: "Shoes",
      category: "shoes",
      priceCents: 10000,
      quantity: 1,
      onSale: false,
    },
    {
      id: "2",
      name: "Sale Hoodie",
      category: "clothing",
      priceCents: 6000,
      quantity: 1,
      onSale: true,
    },
    {
      id: "3",
      name: "Socks",
      category: "accessories",
      priceCents: 2000,
      quantity: 1,
      onSale: false,
    },
  ],
};

const coupons: Coupon[] = [
  {
    code: "SAVE25",
    type: "percentage",
    value: 0.25,
  },
  {
    code: "SAVE50",
    type: "fixed",
    value: 5000,
    minSpendCents: 15000,
  },
  {
    code: "SHOES30",
    type: "percentage",
    value: 0.3,
    categories: ["shoes"],
  },
  {
    code: "NOSALE20",
    type: "percentage",
    value: 0.2,
    excludeSaleItems: true,
  },
  {
    code: "FREESHIP",
    type: "free_shipping",
    value: 0,
  },
  {
  code: "TAKE20",
  type: "fixed",
  value: 2000,
  minSpendCents: 15000,
},
];

console.log("All coupon results:");
for (const coupon of coupons) {
  console.log(evaluateCoupon(cart, coupon));
}

console.log("Best coupon:");
console.log(findBestCoupon(cart, coupons));