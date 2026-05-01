# Salvare v0.2.0 Plan

v0.1.0 runs on Local React, Shopify dev, and WooCommerce LocalWP checkouts. The proposed API shape already lives in `docs/API_DESIGN.md`. This plan focuses on the wiring needed to move from a mock provider to a minimal backend without changing how the extension verifies coupons on checkout.

## 1. v0.2.0 objective

Replace the mock coupon provider with a minimal backend/API prototype. The extension's checkout-side verification flow stays unchanged.

## 2. Scope

- Minimal coupon API exposing a single read-only endpoint.
- Domain-based candidate code lookup, keyed by hostname.
- The extension calls candidate codes through the existing `couponProvider.ts` seam.
- Checkout-side verification (apply, wait, compare totals, reapply winner) stays in the extension.

## 3. Out of scope

- Scraping public coupon sites.
- Public coupon discovery.
- User accounts.
- Payments.
- Browser store publishing.

## 4. Proposed milestones

1. Create a simple backend route: `GET /coupons?domain=`.
2. Seed mock coupon data for localhost, Shopify dev store, and WooCommerce LocalWP.
3. Update `couponProvider.ts` to call the backend in development.
4. Add a fallback to the local mock provider when the backend is unavailable.
5. Add tests for provider behavior, covering both backend success and fallback paths.
6. Update `QA.md` to cover the backend-on and backend-off cases.

## 5. Risks

- **CORS and extension permissions.** Mitigation: keep the dev backend on a known origin and add it explicitly to the manifest's host permissions.
- **Backend availability.** Mitigation: keep the mock fallback so a missing backend never blocks a demo or QA run.
- **Keeping candidate-code data fresh.** Mitigation: a small manual seed/refresh script is enough at this stage; no auto-discovery.
- **Not slowing down checkout testing.** Mitigation: candidate fetch stays async and short, behind the existing provider seam, and runs once per session before the test loop.

## 6. Success criteria

- The extension gets candidate codes from the backend for the three test stores.
- The manual checkout smoke tests in `QA.md` still pass.
- Unsupported domains return empty candidate codes from the backend (and from the fallback).
- No scraping is added.
