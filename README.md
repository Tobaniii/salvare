# Salvare

Salvare is a React + TypeScript app and a companion Chrome extension that finds the best coupon for a shopping cart. The web app demonstrates the underlying engine on a local test checkout; the extension applies the same idea to real merchant checkouts by testing candidate codes and keeping the one that actually lowers the total.

## Demo

[Watch the Salvare demo](docs/assets/salvare-demo.mov)

## Preview

![App Screenshot](./src/assets/screenshot.png)

## Features

### React app
- Cart and coupon simulation in state.
- Coupon engine supporting percentage, fixed, and free-shipping types, with minimum spend, category filtering, sale exclusions, and per-coupon discount caps.
- Best-coupon selection, side-by-side comparison of other eligible coupons, and upsell suggestions when a small additional spend would unlock a better deal.
- Business logic covered by Vitest unit tests.

### Chrome extension
- Popup-triggered coupon testing on the active tab.
- Popup readiness check on open for supported stores.
- Detects coupon input, apply button, and checkout total before testing.
- Shows a friendly message on unsupported or restricted pages.
- Store profiles match by hostname and supply selectors for the coupon input, apply button, subtotal, and total.
- Coupon-section expander for checkouts where the coupon area is collapsed (e.g. WooCommerce "Add coupons").
- Search-form guard so apply attempts cannot click site-search submit buttons or submit search forms.
- Total detection with a blacklist filter so discount, savings, and subtotal rows are not mistaken for the order total.
- Baseline comparison: a code is only counted as successful if it strictly lowers the original total. The popup reports the best code, the final total, and the savings.
- Reports each tested coupon outcome to the local backend (best-effort, fire-and-forget).

## Supported and tested environments

- Local React checkout (the included Vite app).
- Shopify development checkout via a `*.myshopify.com` profile.
- WooCommerce checkout running on a LocalWP site (`salvare-woo-test.local` profile).

## Local development backend

A small prototype backend lives in `server/` and runs on `http://localhost:4123`. It is local-only — no hosted API, no scraping, no third-party calls.

- Candidate-code provider: `couponProvider.ts` calls `GET /coupons?domain=…` first and falls back to mock/profile candidate codes when the backend is unreachable, slow, or returns an unexpected shape. When local result history exists, the backend orders the returned codes by past performance — successful codes first, then no-history codes in seed order, then failure-only codes; ranking never adds or removes codes.
- Admin page: open `http://localhost:4123/admin` to view, add, update, or delete seeded domains. Backed by `GET/POST/DELETE /admin/coupons`.
- Result history: the extension fires a best-effort `POST /results` after each tested coupon. `GET /results?domain=…` returns the recorded outcomes.
- Seed data is editable in [`server/coupons.seed.json`](server/coupons.seed.json); result history persists to [`server/coupon-results.json`](server/coupon-results.json).
- No auth. The endpoints are intended for local development only.

See [`docs/SERVER.md`](docs/SERVER.md), [`docs/SEED_DATA.md`](docs/SEED_DATA.md), and [`docs/API_DESIGN.md`](docs/API_DESIGN.md) for details.

## Run the React app

```bash
npm install
npm run dev      # start the local checkout demo
npm test         # run Vitest unit tests
```

## Build and load the Chrome extension

```bash
npm run build:extension
```

Then in Chrome:

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Click **Load unpacked** and select the `extension/` directory.
4. Open a supported checkout, click the Salvare popup, then **Find Best Coupon**.

## How the coupon testing flow works

1. The popup sends `SALVARE_FIND_BEST_COUPON` to the active tab's content script.
2. The content script resolves a store profile by `window.location.hostname`. If no profile matches, the popup shows that the store is not supported yet.
3. The content script reads the baseline order total.
4. If the coupon area is collapsed, the expander clicks the matching toggle (for example, "Add coupons") and waits for the checkout to settle.
5. For each candidate code in the profile:
   - Remove any already-applied discount.
   - Clear the coupon input.
   - Apply the code via the input's nearest valid Apply button.
   - Wait for a discount-applied or rejected signal, plus a checkout-idle window.
   - Re-scan the total.
6. Keep only codes that strictly beat the baseline total.
7. Re-apply the winning code so the user lands on a checkout already showing the best price. The popup displays the best code, final total, and savings.

## Backend/API readiness

A local development backend prototype lives in `server/`. The extension's `couponProvider.ts` calls `http://localhost:4123/coupons` first and falls back to mock candidate codes when the backend is unreachable, slow, or returns an unexpected shape. Everything is local — there is no hosted API, no scraping, and no third-party calls.

## Current limitations

- Candidate coupon codes are seeded by hand in [`server/coupons.seed.json`](server/coupons.seed.json) and `extension/storeProfiles.ts`. The backend is local-only and there is no hosted coupon API or automated coupon discovery.
- Store support depends on the selectors and keyword heuristics in the profile and content script. A new merchant generally needs a new profile entry, and possibly tuned selectors, before testing works reliably.
- Result reporting and admin endpoints have no auth; they are intended for local development only.
