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

A small Node + TypeScript backend lives in `server/` and runs on `http://localhost:4123`. It is a local development server — no hosted API, no scraping, no third-party calls.

- Candidate-code provider: `couponProvider.ts` calls `GET /coupons?domain=…` first and falls back to mock/profile candidate codes when the backend is unreachable, slow, or returns an unexpected shape. When local result history exists, the backend orders the returned codes by past performance — successful codes first, then no-history codes in seed order, then failure-only codes; ranking never adds or removes codes.
- Admin page: open `http://localhost:4123/admin` to view, add, update, or delete seeded domains, download a JSON export of coupons or result history, and import a previously exported JSON file via a forced **Preview → type IMPORT → Apply** gate. Backed by `GET/POST/DELETE /admin/coupons`, `GET /admin/export/{coupons,results}`, read-only `POST /admin/import/preview/{coupons,results}`, and protected `POST /admin/import/apply/{coupons,results}`. Reset remains CLI-only via `npm run db:reset`; `npm run db:import` is still available for terminal workflows.
- Result history: the extension fires a best-effort `POST /results` after each tested coupon. `GET /results?domain=…` returns the recorded outcomes.
- Runtime persistence is SQLite at `server/salvare.db` (local, gitignored — do not commit). [`server/coupons.seed.json`](server/coupons.seed.json) and [`server/coupon-results.json`](server/coupon-results.json) are bootstrap-only sources used to populate a fresh database via `npm run db:bootstrap`. After bootstrap, admin edits and reported results live in SQLite.
- Optional local hardening: setting `SALVARE_ADMIN_TOKEN` requires `Authorization: Bearer <token>` on admin and destructive endpoints. The admin page itself prompts for the token and stores it in `localStorage`. `GET /coupons`, `POST /results`, and `GET /results` stay open so the unmodified extension keeps working. This is local hardening, not production auth.
- Local readiness check: `curl http://localhost:4123/health` returns a small JSON object with service/version and coarse DB/auth booleans. Unprotected, never includes the token value, DB path, or any coupon/result data.
- The endpoints are intended for local development only. See [`docs/SERVER.md`](docs/SERVER.md) for the supported environment variables (`PORT`, `SALVARE_DB_PATH`, `SALVARE_ADMIN_TOKEN`, `NODE_ENV`) and the startup-diagnostics block.

See [`docs/SERVER.md`](docs/SERVER.md), [`docs/SEED_DATA.md`](docs/SEED_DATA.md), and [`docs/API_DESIGN.md`](docs/API_DESIGN.md) for details.

## Architecture

### Components

- React demo app — local checkout for showcasing the engine ([src/App.tsx](src/App.tsx), [src/engine/couponEngine.ts](src/engine/couponEngine.ts)).
- Chrome extension popup — readiness check and Find Best Coupon button ([extension/popup.ts](extension/popup.ts), [extension/popup.html](extension/popup.html)).
- Content script — runs on checkouts, finds inputs, applies and verifies codes ([extension/contentScript.ts](extension/contentScript.ts)).
- Store profiles — per-domain selectors and behavior ([extension/storeProfiles.ts](extension/storeProfiles.ts)).
- Coupon provider — backend-with-fallback or mock seam ([extension/couponProvider.ts](extension/couponProvider.ts)).
- Result reporter — best-effort fire-and-forget POST ([extension/resultReporter.ts](extension/resultReporter.ts)).
- Local backend server — `GET/POST/DELETE` for coupons and results ([server/index.ts](server/index.ts)).
- Admin page — local UI for managing seeded coupon codes ([server/admin.html](server/admin.html)).
- Runtime database — local SQLite store for coupon seeds, admin edits, and result history (`server/salvare.db`, gitignored — do not commit).
- Bootstrap seed data — JSON of candidate codes per domain, imported into SQLite on first run ([server/coupons.seed.json](server/coupons.seed.json)).
- Bootstrap result history — JSON of tested coupon outcomes, imported into SQLite on first run ([server/coupon-results.json](server/coupon-results.json)).
- Ranking helper — orders candidate codes by past performance ([server/ranking.ts](server/ranking.ts)).

### How a coupon test runs

1. The user clicks **Find Best Coupon** in the popup.
2. The popup sends a message to the content script on the active tab.
3. The content script resolves a store profile by hostname and asks the coupon provider for candidate codes.
4. The coupon provider calls the local backend first and falls back to mock/profile codes when the backend is unreachable, slow, or returns an unexpected shape.
5. The backend returns seed/admin candidate codes, ordered by local result history when available.
6. The content script applies each code on checkout, compares totals against the baseline, and reapplies the winner.
7. After each tested code, the extension fires a best-effort `POST` to the backend's result history.
8. Future runs use that history to re-rank candidate codes for the same domain.

### Boundaries

- The backend is local development only; there is no hosted API.
- No scraping or external coupon discovery is implemented.
- The extension verifies every code directly on checkout — candidates are tested, not trusted.

## Run the React app

```bash
npm install
npm run dev          # start the local checkout demo
npm test             # run Vitest unit tests
npm run test:smoke              # backend/admin Playwright smoke tests
npm run test:smoke:extension    # Chrome extension smoke on the local React checkout
npm run test:smoke:all          # backend/admin + extension smoke
npm run test:all                # unit tests + all smoke tests
# one-time: npx playwright install chromium
```

Smoke tests cover the local backend and the admin page UI in Chromium with an isolated in-memory database; the Chrome extension is not covered. See [`docs/SERVER.md`](docs/SERVER.md) for details.

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

A local development backend lives in `server/`. The extension's `couponProvider.ts` calls `http://localhost:4123/coupons` first and falls back to mock candidate codes when the backend is unreachable, slow, or returns an unexpected shape. Everything is local — there is no hosted API, no scraping, and no third-party calls.

## Milestone status

- **v0.6.0** — Runtime persistence moved to SQLite (`server/salvare.db`); JSON files in `server/` are now bootstrap-only sources.
- **v0.7.0** — Optional `SALVARE_ADMIN_TOKEN` protection for admin and destructive endpoints; the extension's read/report endpoints stay open.
- **v0.7.1** — Backend and admin-page Playwright smoke tests with isolated in-memory databases.
- **v0.7.2** — Admin UI prompts for and stores the admin token in `localStorage` so the page works in token mode.
- **v0.8.0** — Chrome extension Playwright smoke tests covering the local React checkout flow (popup readiness → Find Best Coupon → result reporting). Shopify and WooCommerce profiles are still exercised manually.
- **v0.9.0** — Startup configuration diagnostics and an unprotected `GET /health` readiness endpoint exposing coarse service/database/auth status.
- **v0.10.0** — Admin page displays a backend status panel sourced from `GET /health` (service, version, schema/coupon/result presence, admin-token-configured flag).

## Current limitations

- Candidate coupon codes are seeded by hand in [`server/coupons.seed.json`](server/coupons.seed.json) (imported into SQLite once on first run) and `extension/storeProfiles.ts`. After bootstrap, runtime additions/edits go through the admin UI and persist in `server/salvare.db`. The backend is local-only and there is no hosted coupon API or automated coupon discovery.
- Store support depends on the selectors and keyword heuristics in the profile and content script. A new merchant generally needs a new profile entry, and possibly tuned selectors, before testing works reliably.
- Result reporting and admin endpoints have no auth; they are intended for local development only.
