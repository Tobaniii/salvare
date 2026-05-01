# Salvare Demo Script

## 1. 30-second overview

- Salvare is a Chrome extension and a small React + TypeScript engine that finds the best coupon for a shopping cart.
- Today, shoppers either type random codes at checkout or trust third-party plugins that guess. Most attempts fail silently.
- The MVP works on three controlled test checkouts. Candidate codes are still mock/profile-based.

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
- Candidate codes come from a mock coupon provider that the extension treats as a backend seam.
- The extension applies each code, waits for the checkout to update, compares totals against the baseline, and reapplies the winner.

## 5. Limitations

- Candidate codes are still mock/profile-based.
- There is no backend coupon discovery yet.
- Store support depends on the selectors and keyword heuristics in each profile.

## 6. Closing line

> Salvare verifies coupon codes directly on checkout instead of guessing.
