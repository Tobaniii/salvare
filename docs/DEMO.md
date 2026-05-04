# Salvare Demo Guide

This is the canonical guide for demoing and evaluating Salvare as a local-first project. It walks through what Salvare is, what the demo shows, how to run it from a fresh checkout, and how to verify backend, admin, and extension behavior.

For the original short-form pitch script, see [`docs/DEMO_SCRIPT.md`](DEMO_SCRIPT.md).

---

## What Salvare is

Salvare is a local-first coupon testing tool. It combines:

- A **React + TypeScript engine** that picks the best coupon for a cart from a known candidate set.
- A **Chrome extension** that applies the same idea to real merchant checkouts by testing candidate codes one at a time.
- A **local Node + TypeScript backend** (SQLite-backed) that serves candidate codes, records results, and powers a small admin UI.

Everything runs on your machine. There is no hosted API, no third-party service, and no telemetry.

## What problem it solves

At checkout, shoppers either guess random promo codes or rely on third-party plugins that frequently fail silently. Salvare instead:

- Gathers known candidate codes from local seed data, admin-managed entries, and imported snapshots.
- Tests each candidate **directly on the live checkout**.
- Verifies coupon value by the **actual checkout final total**, not a claimed discount.
- Re-applies whichever code genuinely lowered the total — and reports nothing if none did.

## What the local-first demo shows

The demo is designed to show the full loop end-to-end on a developer machine:

- A local React checkout that mimics a real cart.
- A local backend serving candidate codes from SQLite.
- The Chrome extension running on the local checkout, picking the best code, and reporting the result.
- An admin page for inspecting and editing the candidate set.
- A backend health/status panel and an export/import flow with a `Preview → type IMPORT → Apply` gate.
- Smoke tests covering the backend, admin UI, and the local extension flow.

## What Salvare does not do yet

Salvare is a focused local-first MVP. Out of scope today:

- **No hosted API.** The backend is a local development server only.
- **No production auth.** The optional `SALVARE_ADMIN_TOKEN` is local hardening, not a production identity system.
- **No scraping.** Salvare does not crawl, scrape, or harvest coupon codes from any website.
- **No external coupon discovery.** Candidates come from local seeds, admin entries, or imported JSON only.
- **No broad real-store automation.** Only profiles with explicit selectors are supported (currently the local React checkout, a Shopify dev checkout, and a WooCommerce LocalWP test site).
- **No payments, accounts, or multi-user system.** There is no login, no billing, no per-user state.

Future direction is **trusted/allowed source ingestion** (e.g. importing curated JSON snapshots), not uncontrolled scraping.

---

## Running the demo from a fresh local setup

### 1. Install dependencies

```bash
npm install
# one-time, for smoke tests:
npx playwright install chromium
```

### 2. Initialize and bootstrap the local database

```bash
npm run db:bootstrap   # creates server/salvare.db and imports seed JSON
npm run db:verify      # read-only schema check; reports schema_meta version
```

`server/salvare.db` is local and gitignored. Bootstrap is idempotent for a fresh DB; rerun `npm run db:reset` if you want to wipe and re-seed from scratch.

### 3. Start the backend

```bash
npm run build:server
npm run start:server
# server listens on http://localhost:4123
```

### 4. Start the local React checkout

In a second terminal:

```bash
npm run dev
# Vite serves the local checkout demo
```

### 5. Build and load the Chrome extension

```bash
npm run build:extension
```

Then in Chrome:

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked** and select the `extension/` directory.

### 6. Run a local coupon test

1. Open the local React checkout (from step 4) in Chrome.
2. Click the Salvare extension icon.
3. Confirm the popup readiness check: store supported, coupon input found, apply button found, total detected.
4. Click **Find Best Coupon**.
5. Read the result: best code, final total, and savings. The checkout itself is left with the winning code applied.

### 7. Open the admin page

Navigate to [http://localhost:4123/admin](http://localhost:4123/admin) to:

- View, add, update, and delete candidate codes per domain.
- Download JSON exports of coupons and result history.
- Import a previously exported JSON via the **Preview → type IMPORT → Apply** gate.

If `SALVARE_ADMIN_TOKEN` is set, the admin page prompts for the token and stores it in `localStorage`.

### 8. Show the backend health/status panel

The admin page renders a status panel sourced from `GET /health`. You can also hit it directly:

```bash
curl http://localhost:4123/health
```

The response is a small JSON object with service/version and coarse DB and auth booleans. It never includes the token value, the DB path, or any coupon/result data.

### 9. Show the export/import workflow

1. On the admin page, click **Export coupons** and **Export results** to download JSON snapshots.
2. Click **Import**, choose one of the downloaded files.
3. Review the **Preview** — added/updated/skipped counts.
4. Type `IMPORT` in the confirmation field.
5. Click **Apply**. The admin page refreshes to show the imported state.

`npm run db:import` remains available for terminal workflows.

### 10. Run smoke tests

```bash
npm test                       # Vitest unit tests
npm run test:smoke             # backend + admin Playwright smoke tests
npm run test:smoke:extension   # Chrome extension smoke on the local React checkout
npm run test:smoke:all         # both Playwright suites
npm run test:all               # unit + all smoke
```

Smoke tests use isolated databases and never touch your real `server/salvare.db`.

---

## Verifying backend, admin, and extension behavior

| Surface | How to verify |
|---|---|
| Backend up | `curl http://localhost:4123/health` returns `{ service, version, db: { ... }, auth: { ... } }`. |
| Schema correct | `npm run db:verify` reports the current `schema_meta` version with no errors. |
| Coupons endpoint | `curl 'http://localhost:4123/coupons?domain=localhost'` returns candidate codes (ranked by past results when history exists). |
| Admin UI | Open `http://localhost:4123/admin`, confirm the status panel and the coupon list render. |
| Admin token mode | Start the server with `SALVARE_ADMIN_TOKEN=secret`. Calls to `/admin/*` and destructive endpoints require `Authorization: Bearer secret`; the admin page prompts for it. |
| Export | Click **Export coupons** / **Export results**, or `curl` `/admin/export/coupons` and `/admin/export/results` with the token. |
| Import | Use the admin **Preview → type IMPORT → Apply** flow, or call `/admin/import/preview/*` and `/admin/import/apply/*`. |
| Extension popup | On a supported checkout, the popup shows readiness; **Find Best Coupon** reports a winning code, final total, and savings, or reports no improvement. |
| Result reporting | After a test, `GET /results?domain=<host>` includes the new outcomes. |
| Smoke coverage | `npm run test:smoke:all` passes locally. |

---

## Troubleshooting

### Port 4123 already in use
Stop the other process, or run with `PORT=4200 npm run start:server`. The extension's `couponProvider.ts` is hard-coded to `4123`, so changing the port disables backend integration for the extension.

### Playwright Chromium not installed
First-time smoke runs require `npx playwright install chromium`. If `npm run test:smoke` errors with a missing-browser message, run that command and retry.

### `server/salvare.db` is local and gitignored
This is intentional. Do not commit it. If `git status` shows it, your `.gitignore` is missing the entry — restore it instead of committing the DB.

### `smoke/salvare.db` is local and gitignored
Smoke harnesses write isolated SQLite files under `smoke/`. They are gitignored by design and may be deleted between runs. Do not commit them.

### Admin token mode blocks protected admin endpoints
If `SALVARE_ADMIN_TOKEN` is set, every `/admin/*` and destructive call needs `Authorization: Bearer <token>`. The admin page prompts for it; for `curl`, pass `-H "Authorization: Bearer $SALVARE_ADMIN_TOKEN"`. Read endpoints (`GET /coupons`, `GET /results`, `POST /results`, `GET /health`) stay open.

### Extension smoke tests need port 4123 free
`npm run test:smoke:extension` boots its own harness on `4123`. Stop any running `npm run start:server` first, or the harness will fail to bind.

### Generated build files appearing in `git status`
Files like `server/server.js`, `server/db-*-cli.js`, `extension/*.js`, and `smoke/extension-server-harness.js` are esbuild outputs. Confirm `.gitignore` covers them; do not commit build artifacts.

---

## Accuracy notes

- Salvare gathers and tests **known** local, admin-managed, and imported candidate codes. It does not invent or discover new codes.
- Salvare verifies coupon value by the **actual checkout final total** after applying each code, not by trusting any claimed discount.
- Salvare does not currently discover coupons from external websites and does not scrape merchants.
- The intended future direction is ingestion from **trusted, allowed sources** (curated snapshots, partner feeds), not uncontrolled scraping.
