import { useState } from "react";
import type { Cart, Coupon, CouponEvaluationResult } from "./types/types";
import {
  evaluateCoupon,
  getCartSubtotal,
  getUpsellSuggestions,
} from "./engine/couponEngine";
import "./App.css";

const initialCart: Cart = {
  items: [
    {
      id: "1",
      name: "T-Shirt",
      category: "apparel",
      priceCents: 2500,
      quantity: 2,
    },
    {
      id: "2",
      name: "Coffee Mug",
      category: "home",
      priceCents: 1200,
      quantity: 1,
    },
    {
      id: "3",
      name: "Sneakers",
      category: "apparel",
      priceCents: 7500,
      quantity: 1,
      onSale: true,
    },
  ],
  shippingCents: 800,
};

const initialCoupons: Coupon[] = [
  {
    code: "SAVE10",
    type: "percentage",
    value: 0.1,
  },
  {
    code: "APPAREL25",
    type: "percentage",
    value: 0.25,
    categories: ["apparel"],
    excludeSaleItems: true,
  },
  {
    code: "TAKE15",
    type: "fixed",
    value: 1500,
    minSpendCents: 5000,
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

function formatDollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function App() {
  const [cart] = useState<Cart>(initialCart);
  const [coupons] = useState<Coupon[]>(initialCoupons);
  const [eligibleResults, setEligibleResults] = useState<
    CouponEvaluationResult[]
  >([]);
  const [checked, setChecked] = useState(false);

  const subtotal = getCartSubtotal(cart);
  const total = subtotal + cart.shippingCents;

  const best = eligibleResults[0] ?? null;
  const others = eligibleResults.slice(1);
  const suggestions = checked 
  ? getUpsellSuggestions(cart, coupons, best) 
  : [];

  const handleFindBest = () => {
    const sorted = coupons
      .map((coupon) => evaluateCoupon(cart, coupon))
      .filter((r) => r.eligible)
      .sort((a, b) => b.savingsCents - a.savingsCents);
    setEligibleResults(sorted);
    setChecked(true);
  };

  return (
    <main className="salvare">
      <header>
        <h1>Salvare</h1>
        <p className="tagline">Find the best coupon for your cart</p>
      </header>

      <section className="panel">
        <h2>Cart</h2>
        <ul className="list">
          {cart.items.map((item) => (
            <li key={item.id}>
              <span>
                {item.name}
                {item.onSale ? " (sale)" : ""} × {item.quantity}
              </span>
              <span>{formatDollars(item.priceCents * item.quantity)}</span>
            </li>
          ))}
        </ul>
        <div className="totals">
          <div>
            <span>Subtotal</span>
            <span>{formatDollars(subtotal)}</span>
          </div>
          <div>
            <span>Shipping</span>
            <span>{formatDollars(cart.shippingCents)}</span>
          </div>
          <div className="grand">
            <span>Total</span>
            <span>{formatDollars(total)}</span>
          </div>
        </div>
      </section>

      <section className="panel">
        <h2>Coupons</h2>
        <ul className="list">
          {coupons.map((coupon) => (
            <li key={coupon.code}>
              <span className="code">{coupon.code}</span>
              <span className="meta">
                {coupon.type === "percentage" &&
                  `${Math.round(coupon.value * 100)}% off`}
                {coupon.type === "fixed" &&
                  `${formatDollars(coupon.value)} off`}
                {coupon.type === "free_shipping" && "Free shipping"}
                {coupon.minSpendCents
                  ? ` · min ${formatDollars(coupon.minSpendCents)}`
                  : ""}
                {coupon.categories ? ` · ${coupon.categories.join(", ")}` : ""}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <button type="button" className="primary" onClick={handleFindBest}>
        Find Best Coupon
      </button>

      {checked && (
        <section className="panel result">
          <h2>Result</h2>
          {best ? (
            <>
              <div className="totals">
                <div>
                  <span>Best coupon</span>
                  <span className="code">{best.coupon.code}</span>
                </div>
                <div>
                  <span>Savings</span>
                  <span>{formatDollars(best.savingsCents)}</span>
                </div>
                <div className="grand">
                  <span>Final price</span>
                  <span>{formatDollars(best.finalPriceCents)}</span>
                </div>
              </div>
              <p className="explanation">
                {best.coupon.code} saves {formatDollars(best.savingsCents)}
              </p>

              {others.length > 0 && (
                <div className="compared">
                  <h3>Compared with</h3>
                  <ul className="list">
                    {others.map((r) => (
                      <li key={r.coupon.code}>
                        <span className="code">{r.coupon.code}</span>
                        <span>{formatDollars(r.savingsCents)} off</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {suggestions.length > 0 && (
                <div className="suggestions">
                  <h3>Almost there</h3>
                  <ul className="list">
                    {suggestions.map((s) => (
                      <li key={s.coupon.code}>
                        Add {formatDollars(s.gapCents)} more to unlock{" "}
                        <span className="code">{s.coupon.code}</span> and save{" "}
                        {formatDollars(s.potentialSavingsCents)} instead of{" "}
                        {formatDollars(best.savingsCents)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          ) : (
            <p>No eligible coupons for this cart.</p>
          )}
        </section>
      )}
    </main>
  );
}

export default App;
