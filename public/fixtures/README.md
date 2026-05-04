# Salvare local checkout fixtures

These static HTML pages are deterministic local test fixtures used by Salvare's
extension selector and profile-diagnostic tests. They exist purely to exercise
alternate and degraded checkout DOM shapes against the `localhost` store
profile without using any external website.

Pages here are served by Vite from `public/fixtures/*.html` at
`http://localhost:5173/fixtures/<name>.html`.

Variants:

- `alt-coupon.html` — alternate coupon input attributes (`name="discount_code"`,
  `placeholder="Promo code"`).
- `alt-apply.html` — alternate apply button text (`Redeem`).
- `missing-input.html` — apply button + total only.
- `missing-button.html` — coupon input + total only.
- `missing-total.html` — coupon input + apply button only.

These pages have no real coupon-application logic. They are intended for the
content script's support detection and for unit/jsdom tests of
`extension/checkoutScan.ts`.
