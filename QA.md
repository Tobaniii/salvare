# Salvare QA — v0.1.0

A manual smoke test checklist for the Chrome extension before tagging a release.

## 1. Prerequisites

- Run `npm run build:extension`.
- Open `chrome://extensions` and reload the Salvare extension.
- Make sure the following test environments are available:
  - Local React checkout (`npm run dev`).
  - Shopify dev checkout at `salvare-test-store.myshopify.com`.
  - WooCommerce LocalWP checkout at `salvare-woo-test.local`.

## 2. Supported checkout smoke tests

For each environment, open the checkout, click the Salvare popup, then **Find Best Coupon**.

- Localhost checkout — expected: best code `TAKE15`, final total `$130.00`.
- Shopify dev checkout — expected: best code `WELCOME10`, final total `$922.50`.
- WooCommerce LocalWP checkout — expected: best code `TAKE20`, final total `€155.00`.

## 3. Popup readiness check

- On a supported checkout, opening the popup should report: store supported, coupon input found, apply button found, total detected.
- On an unsupported or restricted page (e.g. `chrome://extensions`, a non-checkout site), the popup should show the friendly fallback: `Open a supported checkout page to use Salvare.`

## 4. Regression notes

- The extension must not auto-run coupon testing on page load.
- The extension must not navigate away from the WooCommerce checkout (no redirect to `/?s=` or any search results page).
- The extension must not produce Chrome extension errors when the popup is opened on unsupported or restricted pages.
