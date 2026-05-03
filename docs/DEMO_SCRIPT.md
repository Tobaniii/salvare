# Salvare Demo Script

## 1. 30-second overview

- Salvare is a Chrome extension and a small React + TypeScript engine that finds the best coupon for a shopping cart.
- Today, shoppers either type random codes at checkout or trust third-party plugins that guess. Most attempts fail silently.
- The MVP works on three controlled test checkouts. Candidate codes are seeded into a local SQLite database and reordered at runtime by the success/failure history reported by the extension. The local React checkout flow is covered end-to-end by Playwright smoke tests.

## 2. Demo flow

1. Open a supported checkout in Chrome.
2. Click the Salvare extension icon to open the popup.
3. Point out the readiness check: store supported, coupon input found, apply button found, total detected.
4. Click **Find Best Coupon**. Status switches to "Scanning checkout..." and then "Testing coupons...".
5. Read out the result: best code, final total, and savings — the checkout itself already has the winning code applied.

## 3. Test environments to mention

- Local React checkout — best code `TAKE15`, final total `$130.00`.
- Shopify dev checkout — best code `WELCOME10`, final total `$922.50`.
- WooCommerce LocalWP checkout — best code `TAKE20`, final total `€155.00`.

## 4. Technical explanation

- The popup sends a message to the content script running on the active tab.
- The content script resolves a store profile by hostname to pick the right selectors and behavior.
- Candidate codes come from the local backend at `localhost:4123` when running, or from a mock provider as a fallback.
- The extension applies each code, waits for the checkout to update, compares totals against the baseline, and reapplies the winner.
- After each tested code, the extension fires a best-effort `POST` to the backend's result history endpoint, which persists in SQLite.
- When the backend has prior result history for the store, it orders candidate codes by past performance so likely winners are tested first.
- The local React checkout flow shown above (popup readiness, Find Best Coupon, result reporting) is covered by `npm run test:smoke:extension` against an isolated in-memory backend.

## 5. Limitations

- Candidate codes are seed-driven; the backend is a local development server, not a hosted production API.
- There is no scraping or external coupon discovery — the extension only tests codes already known to the backend or to a profile.
- Store support depends on the selectors and keyword heuristics in each profile. Shopify and WooCommerce checkouts are exercised manually; only the local React demo flow is automated end-to-end.

## 6. Closing line

> Salvare verifies coupon codes directly on checkout instead of guessing.
