# Salvare

Salvare is a React + TypeScript app and a companion Chrome extension that finds the best coupon for a shopping cart. The web app demonstrates the underlying engine on a local test checkout; the extension applies the same idea to real merchant checkouts by testing candidate codes and keeping the one that actually lowers the total.

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
- Store profiles match by hostname and supply selectors for the coupon input, apply button, subtotal, and total.
- Coupon-section expander for checkouts where the coupon area is collapsed (e.g. WooCommerce "Add coupons").
- Search-form guard so apply attempts cannot click site-search submit buttons or submit search forms.
- Total detection with a blacklist filter so discount, savings, and subtotal rows are not mistaken for the order total.
- Baseline comparison: a code is only counted as successful if it strictly lowers the original total. The popup reports the best code, the final total, and the savings.

## Supported and tested environments

- Local React checkout (the included Vite app).
- Shopify development checkout via a `*.myshopify.com` profile.
- WooCommerce checkout running on a LocalWP site (`salvare-woo-test.local` profile).

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

## Current limitations

- Candidate coupon codes are hardcoded per store profile in `extension/storeProfiles.ts`.
- There is no backend or API for coupon discovery; the extension only tests the codes the profile already knows about.
- Store support depends on the selectors and keyword heuristics in the profile and content script. A new merchant generally needs a new profile entry, and possibly tuned selectors, before testing works reliably.
