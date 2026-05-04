# Salvare

Salvare is a local-first coupon engine. It tests known candidate coupon codes directly against a real checkout and keeps whichever code produces the lowest verified final total. The project ships as a Chrome extension that runs on supported merchant checkouts, plus a small local Node + TypeScript backend, a SQLite store, an admin UI, and a local React demo checkout used for development and portfolio review.

The product thesis is simple: coupon claims are unreliable, so Salvare does not trust them. Every candidate code is applied on the live checkout, the order total is re-read after the discount settles, and only codes that strictly lower the baseline total are counted as wins. Whatever code yields the lowest verified final total is the code the user keeps. Discount banners, "savings" rows, and advertised percentages are not used as proof of value — the checkout's grand total is.

Today's scope is deliberately narrow and local. Candidate codes come from three sources Salvare already controls: hand-curated seed JSON, admin-managed entries persisted in SQLite, and previously exported snapshots imported back through the admin UI. The Chrome extension supports the local React checkout out of the box and ships profiles for a Shopify development checkout and a WooCommerce LocalWP test site. A backend, an admin page, an unprotected `GET /health` readiness endpoint, optional bearer-token hardening, export/import/backup/reset/verify CLIs, and Playwright smoke suites round out the local toolchain.

Salvare is intentionally **not** a hosted SaaS, **not** a multi-user product, **not** a production-auth system, and **not** a scraper. There is no external coupon discovery, no third-party API, no real-store automation by default, and no telemetry. Future direction is trusted/allowed source ingestion with provenance — API/feed adapters first, and allowlisted HTML adapters only later if permitted — never uncontrolled scraping.

For a full local-first walkthrough — fresh setup, demo flow, admin/health/export-import, smoke tests, and troubleshooting — see [`docs/DEMO.md`](docs/DEMO.md). For the layered verification surface and which commands mutate state, see [`docs/TESTING.md`](docs/TESTING.md).

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

### At a glance

```
                       ┌──────────────────────────┐
                       │  Chrome extension        │
                       │  popup + content script  │
                       └────────────┬─────────────┘
                                    │ HTTP (localhost:4123)
                                    ▼
   ┌────────────────────┐   ┌──────────────────────────┐   ┌───────────────────┐
   │  Local React       │◀──│  Local Node + TS server  │──▶│  SQLite           │
   │  demo checkout     │   │  /coupons /results       │   │  server/salvare.db │
   │  (Vite, :5173)     │   │  /admin/* /health        │   │  (gitignored)     │
   └────────────────────┘   └────────────┬─────────────┘   └───────────────────┘
                                         │
                              ┌──────────┴──────────┐
                              ▼                     ▼
                    ┌──────────────────┐   ┌────────────────────────┐
                    │  Admin UI        │   │  Local CLIs            │
                    │  /admin (HTML)   │   │  db:init / db:bootstrap│
                    │  status panel,   │   │  db:backup / db:export │
                    │  preview→IMPORT  │   │  db:import / db:reset  │
                    │  →apply gate     │   │  db:verify             │
                    └──────────────────┘   │  profiles:verify       │
                                           └────────────────────────┘

   Smoke coverage: Playwright suites under smoke/ exercise the backend,
   the admin UI, and the extension on the local React checkout — each with
   isolated in-memory or temporary SQLite state.
```

Everything in the diagram runs on the developer's machine. There is no hosted API, no third-party service, and no telemetry.

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

## Demo story

A full reviewer-friendly walkthrough lives in [`docs/DEMO.md`](docs/DEMO.md). The condensed loop:

1. Start the local backend (`npm run start:server`) and the local React checkout (`npm run dev`).
2. Load the unpacked extension into Chrome and open the local checkout tab.
3. Click the Salvare popup, confirm the readiness check, then click **Find Best Coupon** — the extension tests each known candidate code, applies the winner, and reports the final total and savings.
4. Open `http://localhost:4123/admin` to inspect candidate codes, view the backend status panel sourced from `GET /health`, and edit seeded entries.
5. Use the export, preview-gated import, backup, reset, and verify CLIs (and matching `verify:*` aliases) to manage the local SQLite store and confirm schema, profile, and smoke health without hitting any external service.

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

## Verification

Salvare groups its checks into `verify:*` script aliases so you can pick the right level of confidence without memorizing every underlying command. None of the aliases mutate `server/salvare.db`.

```bash
npm run verify:build       # tsc -b + build:server + build:extension
npm run verify:unit        # vitest, single run
npm run verify:data        # db:verify + profiles:verify (read-only)
npm run verify:smoke       # backend + admin Playwright smoke
npm run verify:extension   # extension smoke (binds port 4123)
npm run verify:local       # build + unit + data + backend smoke
```

`verify:local` deliberately omits extension smoke because the extension suite binds port 4123 and conflicts with a running `npm run start:server`. Run `npm run verify:extension` separately when 4123 is free. `db:init`, `db:bootstrap`, and `db:reset` are intentionally excluded from every `verify:*` alias because they mutate or delete local DB state.

For the full guide — what each layer covers, what mutates state, prerequisites, and common failures — see [`docs/TESTING.md`](docs/TESTING.md).

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

## Milestone status

- **v0.6.0** — Runtime persistence moved to SQLite (`server/salvare.db`); JSON files in `server/` are now bootstrap-only sources.
- **v0.7.0** — Optional `SALVARE_ADMIN_TOKEN` protection for admin and destructive endpoints; the extension's read/report endpoints stay open.
- **v0.7.1** — Backend and admin-page Playwright smoke tests with isolated in-memory databases.
- **v0.7.2** — Admin UI prompts for and stores the admin token in `localStorage` so the page works in token mode.
- **v0.8.0** — Chrome extension Playwright smoke tests covering the local React checkout flow (popup readiness → Find Best Coupon → result reporting). Shopify and WooCommerce profiles are still exercised manually.
- **v0.9.0** — Startup configuration diagnostics and an unprotected `GET /health` readiness endpoint exposing coarse service/database/auth status.
- **v0.10.0** — Admin page displays a backend status panel sourced from `GET /health` (service, version, schema/coupon/result presence, admin-token-configured flag).
- **v0.11.0** — Local DB maintenance CLIs: `db:backup`, `db:export`, `db:reset`, `db:import`.
- **v0.12.0** — Protected admin export endpoints and admin export download buttons.
- **v0.13.0** — Protected admin import preview endpoints (read-only diff).
- **v0.14.0** — Protected admin import apply endpoints and browser import UI with `Preview → type IMPORT → Apply` gate.
- **v0.15.0** — Admin/export/import route handlers extracted out of `server/index.ts`.
- **v0.16.0** — `schema_meta` versioning and read-only `db:verify` CLI.
- **v0.17.0** — Profile diagnostics and selector helpers for extension support detection.
- **v0.18.0** — Polished extension popup messages using diagnostic reasons.
- **v0.19.0** — Demo/portfolio documentation (`docs/DEMO.md`); no runtime changes.
- **v0.20.0** — Local-first beta release checkpoint: SQLite persistence, admin UI, smoke-tested Chrome extension, import/export/backup/reset CLIs, profile diagnostics, and polished popup messaging. No scraping or external coupon discovery.
- **v0.21.0** — Extension popup shows live "Testing N of M…" progress while coupons are being tried. Additive `SALVARE_COUPON_PROGRESS` broadcast with per-run id; final response shape unchanged.
- **v0.22.0** — Local deterministic checkout fixtures (`public/fixtures/*.html`) covering alternate coupon input, alternate apply button text, and missing input/button/total. Pure DOM scan helpers extracted into `extension/checkoutScan.ts` and unit-tested under `happy-dom`; one minimal alt-coupon support-check smoke added.
- **v0.23.0** — Profile verification helpers and `npm run profiles:verify` CLI for structural, uniqueness, selector-sanity, and local-fixture compatibility checks. Read-only; no changes to profile runtime data, popup wording, content-script behavior, backend API, admin UI, or SQLite schema.
- **v0.24.0** — Verification ergonomics: `verify:build`, `verify:unit`, `verify:data`, `verify:smoke`, `verify:extension`, and `verify:local` script aliases plus a dedicated [`docs/TESTING.md`](docs/TESTING.md) guide. Optional GitHub Actions workflow (`.github/workflows/ci.yml`) runs unit tests, type checks, server/extension builds, and `profiles:verify` only — no browser smoke, no port-4123 service, no secrets. No runtime changes.
- **v0.25.0** — Portfolio release-candidate polish: rewritten README opening explaining the product thesis, current scope, and explicit non-goals; an at-a-glance architecture diagram; a condensed demo story; a refined limitations section paired with a trusted/allowed source ingestion future-direction roadmap; `SALVARE_VERSION` and `package.json` bumped to `0.25.0`. No runtime, API, schema, admin UI, or extension behavior changes.

## Limitations and future direction

### Current limitations

- Candidate coupon codes are seeded by hand in [`server/coupons.seed.json`](server/coupons.seed.json) (imported into SQLite once on first run) and `extension/storeProfiles.ts`. After bootstrap, runtime additions/edits go through the admin UI and persist in `server/salvare.db`. The backend is local-only and there is no hosted coupon API or automated coupon discovery.
- Store support depends on the selectors and keyword heuristics in the profile and content script. A new merchant generally needs a new profile entry, and possibly tuned selectors, before testing works reliably.
- The optional `SALVARE_ADMIN_TOKEN` is local hardening for a single-user developer machine. It is not production auth: there is no rate limiting, no token rotation, no TLS termination, and the public read endpoints stay open so the unmodified extension keeps working.
- There is no multi-user system, no accounts, no payments, and no telemetry. Salvare is a single-user local tool by design.

### Future direction

Future Salvare work focuses on **trusted, allowed source ingestion with explicit provenance** — never uncontrolled scraping. The intended order is:

1. **Source provenance metadata.** Every imported candidate code carries the source it came from, when it was ingested, and under what permission, so reviewers can audit and revoke a source.
2. **API and feed adapters first.** Ingest from sources that publish coupons through a documented API or feed (partner programs, merchant-published JSON, allowlisted RSS/Atom). These are the lowest-risk surfaces and stay well clear of merchant terms-of-service issues.
3. **Allowlisted HTML adapters only later, only if permitted.** If a source explicitly permits structured extraction, a narrowly scoped HTML adapter may be added under the same provenance and review gate. Adapters are opt-in per source and never enabled by default.

Out-of-scope direction (explicitly not planned): broad scraping, harvesting from arbitrary merchant pages, hosted SaaS, multi-user accounts, real-store automation by default, or any flow that submits orders on a user's behalf.
