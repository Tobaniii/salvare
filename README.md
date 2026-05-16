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
- **v0.26.0** — Source-ingestion policy and product principles ([`docs/SOURCE_POLICY.md`](docs/SOURCE_POLICY.md)): canonical reference for any future source-integration milestone, defining current state, core principles (sources suggest, checkout decides, lowest verified final total wins, affiliate metadata never overrides user outcome), allowed source types, prohibited behavior, guardrails, the ranking rule, a compliance note, and the v0.27–v0.31+ roadmap. Docs/version-only; no runtime, API, schema, admin UI, or extension behavior changes.
- **v0.27.0** — Coupon source/provenance data model foundation: additive `coupon_sources` and `coupon_code_sources` SQLite tables, `EXPECTED_SCHEMA_VERSION` raised from `1` to `2` (idempotent in-place upgrade, no destructive migration), default `seed`/`admin`/`import` source rows, validated source IDs (`^[a-z0-9][a-z0-9-]{0,63}$` — rejects URL-, path-, and secret-shaped values), pure helpers in [`server/db-sources.ts`](server/db-sources.ts), and new `db:verify` orphan checks. No backfill of provenance for existing `coupon_codes`. Export/import JSON shapes, admin UI, extension behavior, ranking, and runtime API responses are unchanged.
- **v0.28.0** — Provenance recording wired into the three local coupon-code writers: `importSeed` records `source_id = "seed"`, `POST /admin/coupons` (via `upsertCouponCodes`) records `"admin"`, and `importCouponsExport` (the `db:import` CLI and `POST /admin/import/apply/coupons`) records `"import"`. All recording happens atomically inside the existing per-writer transaction via `recordCouponCodeSource`, idempotent on `(store_id, code, source_id)`. Destructive per-store replaces also prune stale provenance for codes dropped on the same write. No external ingestion, no backfill, no public response or export/import JSON shape changes; extension behavior, ranking, admin UI, `/coupons`, and `db:verify` rules are unchanged.
- **v0.29.0** — Source cache + rate-limit foundation: additive `source_cache` and `source_fetch_log` SQLite tables (FK to `coupon_sources` ON DELETE RESTRICT), `EXPECTED_SCHEMA_VERSION` raised from `2` to `3` (idempotent in-place upgrade, no destructive migration), pure decision-only helpers in [`server/db-source-cache.ts`](server/db-source-cache.ts) (`recordSourceFetchAttempt`, `getLastSourceFetch`, `canFetchSourceNow`, `upsertSourceCacheEntry`, `getSourceCacheEntry`, `pruneExpiredSourceCache`, `getSourceCacheSummary`), and matching `db:verify` table/index/orphan checks. Cache rows store only a `body_sha256` hash and an allowlisted, size-bounded `metadata_json` blob — never raw HTML, raw response bodies, headers, cookies, tokens, env vars, or filesystem paths. No external fetcher, no scraping, no provider/API/feed adapters, no HTML adapters, no source endpoints, no source admin UI, and no extension changes. Public response shapes, export/import JSON shapes, ranking, and admin UI are unchanged.
- **v0.31.0** — Provider, API, and feed research and selection: nine candidate coupon source providers evaluated against Salvare's source policy. Awin Offers API selected as primary v0.32.0 prototype; FMTC as backup. Research doc, terms/safety checklist, and implementation preview in [`docs/SOURCE_PROVIDER_RESEARCH.md`](docs/SOURCE_PROVIDER_RESEARCH.md). No external integration, network fetching, API keys, schema changes, or extension changes.
- **v0.30.0** — Local-only source-adapter foundation: a small `SourceAdapter` interface (`id`, `sourceId`, `type`, `parse(input, ctx) → { ok, candidates, errors }`) plus pure JSON and HTML fixture adapters in [`server/source-adapters.ts`](server/source-adapters.ts) that turn deterministic local fixtures ([`server/fixtures/source-json-example.json`](server/fixtures/source-json-example.json), [`server/fixtures/source-html-example.html`](server/fixtures/source-html-example.html)) into normalized candidate codes. Adapters accept a caller-loaded string and perform no `fetch`, no `node:http` / `node:https` import, no `URL` networking, no filesystem reads, and no environment-variable reads; strict validation bounds `domain`, `code`, `label`, `expiresAt`, `sourceUrl`, and `confidence`, drops unknown unsafe fields (cookies, headers, tokens, env vars, DB paths, raw HTML, raw payloads), and emits redacted `{ index, reason }` errors that never echo payload values. No external fetcher, no scraping, no provider/API/feed integration, no source fetcher, no source endpoint, no source admin UI, no DB write path for adapter output, no schema change, and no extension/ranking/export-import shape changes.
- **v0.32.0** — First real-provider adapter spike (mocked, feature-flagged): Awin Offers API adapter in [`server/source-provider-awin.ts`](server/source-provider-awin.ts) with env reader [`server/source-provider-config.ts`](server/source-provider-config.ts). Disabled by default; requires `SALVARE_SOURCE_PROVIDER_ENABLED=true`, `SALVARE_SOURCE_PROVIDER=awin`, and a non-blank `SALVARE_AWIN_API_KEY` (fail-closed otherwise). Fetcher is injectable so all unit tests run against committed JSON fixtures with zero live HTTP. Voucher-only `promotionType` filter; affiliate/tracking fields stripped before any candidate is returned; the `awin` `coupon_sources` row is registered at runtime on first call (not seeded into bootstrap). On every attempt the adapter writes a `source_fetch_log` row, and on success it writes a `source_cache` row with body SHA-256 plus `{ offer_count, error_count }` only — no raw payload, no headers, no credentials. Cache-read short-circuit deferred to v0.33. No source endpoint, no source admin UI, no automatic import into `coupon_codes`, no extension/ranking/export-import changes, no schema change. Live activation outside local development still requires the §4 terms/safety checklist in [`docs/SOURCE_PROVIDER_RESEARCH.md`](docs/SOURCE_PROVIDER_RESEARCH.md).
- **v0.33.0** — Cache-read short-circuit for the mocked Awin provider adapter: a fresh `source_cache` row whose new `candidates_json` column round-trips per-row revalidation is returned as `{ outcome: "cache_hit", cacheHit: true, fetched: false }` and a single `cache_hit` row is appended to `source_fetch_log` — no fetcher invocation, no secrets, no raw payload. Stale, missing, corrupt, or tamper-evident cache rows fail safe and fall through to a fresh fetch. Schema bump `3 → 4` adds only the additive `source_cache.candidates_json TEXT` column via an idempotent in-place ALTER (no destructive migration). Provider remains disabled by default, env-gated, mocked-fetch-only in tests; no live calls, no automatic import, no source endpoint, no admin UI, no extension/ranking/export-import changes.
- **v0.34.0** — Admin-protected source-preview boundary at `POST /admin/source-preview/awin` ([`server/admin-source-preview-routes.ts`](server/admin-source-preview-routes.ts)) wrapping the v0.32/v0.33 mocked Awin adapter behind the existing admin-token auth surface. Preview-only by construction: zero writes to `coupon_codes` or `coupon_results`, no import/apply path, no ranking effects, and an allowlisted response that never echoes the API key, `Authorization`, raw provider payloads, env vars, the DB path, or affiliate/tracking fields. Invalid input returns a safe `400` without echoing the bad body. Disabled-by-default behavior is unchanged; live Awin activation still requires the §4 terms/safety checklist in [`docs/SOURCE_PROVIDER_RESEARCH.md`](docs/SOURCE_PROVIDER_RESEARCH.md). No admin UI, no automatic import/apply, no extension/`/coupons`/export/import/schema changes, no live HTTP in tests.
- **v0.35.0** — Admin UI control for the v0.34 source-preview route. [`server/admin.html`](server/admin.html) gains a minimal **Source preview** section (provider label `Awin`, domain input, single Preview button, status/candidates/errors containers) that POSTs to `/admin/source-preview/awin` using the existing `authHeaders()` helper. Rendering is allowlisted client-side (`sourceId`, `domain`, `code`, `label`, `expiresAt`, `confidence` plus `provider`/`cacheHit`/`fetched`/`candidateCount` summary) and uses `textContent` only — the admin token, `Authorization`, env var values, raw payloads, raw HTML, stack traces, and affiliate/tracking fields are never read off the response and cannot reach the DOM. Disabled / missing-key responses render plain English messages; the env var name `SALVARE_AWIN_API_KEY` may be mentioned, never its value. Still **preview only**: no Import or Apply button, no writes to `coupon_codes`/`coupon_results`, no extension/`/coupons`/export/import/ranking/schema changes, no live HTTP in tests. DOM behavior covered by [`server/admin-source-preview-client.test.ts`](server/admin-source-preview-client.test.ts) (happy-dom, mocked `fetch`); smoke checks assert control visibility only.
- **v0.38.0** — Source-aware **candidate test-order** (winner selection unchanged). New pure helper ([`server/candidate-order.ts`](server/candidate-order.ts)) and SELECT-only DB wrapper ([`server/db-candidate-order.ts`](server/db-candidate-order.ts)) reorder a domain's candidate codes using only an allowlist of provenance fields (`sourceId`, `sourceType`, `confidence`, `discoveredAt`) — affiliate/tracking/payout fields and `sourceUrl` are ignored even when smuggled into the helper input. The reorder is wired inside the `GET /coupons` handler before the existing history-based `rankCandidateCodes`, so past-result history continues to dominate; source order only seeds untested or history-tied codes. The `/coupons` response shape stays `{ domain, candidateCodes, source, updatedAt }` with `candidateCodes: string[]` and no new source metadata leaks into the response. Final winner selection still uses the lowest observed `finalTotalCents` (with the existing `savingsCents` tiebreaker) — proven by a unit test where source weighting puts a worse code first but the verified-checkout winner stays the same. No change to `/results`, `coupon_results` writes, export/import shapes, ranking semantics, DB schema, admin UI, or extension behavior.
- **v0.37.0** — Admin-only **source/provenance visibility** (read-only). New protected `GET /admin/source-summary?domain=…` ([`server/admin-source-summary-routes.ts`](server/admin-source-summary-routes.ts)) and bounded SELECT-only helper ([`server/db-source-summary.ts`](server/db-source-summary.ts)) aggregate `coupon_sources` + `coupon_code_sources` for a domain into a strict allowlist (`domain`, `storeId`, `codeCount`, `sourceCount`, `truncated`, `codes[].code`, per-claim `sourceId`/`sourceName`/`sourceType`/`discoveredAt`/`label`/`expiresAt`/`confidence`, per-source `sourceSummary` counts). Bounded at 500 codes with a `truncated` flag; unknown domains return a safe empty summary; invalid domains return safe 400 without echoing the payload. Admin UI gains a clearly-labelled **Stored source claims (provenance)** section (domain input + single Look-up button + read-only result tables — no edit/delete/import/apply controls). No writes to `coupon_codes`, `coupon_code_sources`, `coupon_results`, `source_cache`, `source_fetch_log`, or `coupon_sources`; no extension behavior change; no `/coupons` shape change; no export/import shape change; no ranking change; no DB schema change. `sourceUrl` is deliberately omitted from the response (not yet sanitizer-gated); API keys, `Authorization`, env vars, DB paths, raw payloads, raw HTML, stack traces, and affiliate/tracking fields are never read or rendered.
- **v0.41.0** — Awin parser **fixture hardening** (v0.41.0). Two new contract-style fixtures (`server/fixtures/awin-offers-realistic-contract.json`, `server/fixtures/awin-offers-edge-cases.json`) exercise the full realistic Awin Offers API field shape and edge cases: duplicate same-domain codes (deduped), same code on different domains (not a duplicate), null code, missing optional fields, field aliases (`voucherCode`, `validTo`, `description`, `type`), bare-hostname domain, unknown promotion type. New parser tests prove voucher/code offers parse correctly, non-code offers are silently dropped, affiliate/tracking/payout fields are stripped, and malformed rows produce safe per-row errors without leaking raw payloads. Both fixtures are explicitly contract-style; live Awin response validation remains pending. No behavior changes: no endpoints, no admin UI, no refresh/cache/import/extension/ranking/schema changes.
- **v0.46.0** — **Generic provider import history / audit trail**. New append-only `import_history` table (`EXPECTED_SCHEMA_VERSION 4 → 5`, created on next boot via `CREATE TABLE IF NOT EXISTS`; `db:bootstrap` never writes it) records one redacted row per **real** import attempt (passed auth + registry resolution). Columns are redacted by construction — no body/header/credential/token/URL/free-text columns: `provider_id` (always the registry-resolved descriptor value, never the client/path segment), nullable `source_id` (`REFERENCES coupon_sources(id)`; NULL for resolved-but-failed attempts), `domain`, `attempted_at`, `outcome` (`ok`/`empty`/`error`), the counter set, `error_code` (allowlisted short token — the same classifier the response builder uses, never a raw exception), `duration_ms`. Writer `recordProviderImportAttempt` ([`server/db-source-import.ts`](server/db-source-import.ts)) validates/allowlists every field (mirrors `recordSourceFetchAttempt`); called once per post-resolution branch (closure-throw, adapter-not-ok, success). Resolver-denied / unknown / not-user-exposed / capability-unsupported / invalid-body / unauthorized → **zero** rows. Existing import response bodies byte-identical to v0.45. `db-verify` gains the table, both indexes (`idx_import_history_provider_attempt`, `idx_import_history_source`), and an orphan check (NULL `source_id` allowed; non-NULL dangling fails). New read-only `GET /admin/import-history` ([`server/admin-import-history-routes.ts`](server/admin-import-history-routes.ts)) — auth-gated, no mutation verb, allowlisted projection, `attempted_at DESC` capped 500 + `truncated`, optional `provider` (registry-validated, unknown fails closed) / `from` / `to` (ISO) filters. Minimal read-only **Import history** admin UI section. No retention/pruning/export, no history mutation/delete, no import-behavior or response-shape change, no scraping/new providers, impact stays hidden.
- **v0.45.0** — **Generic provider preview/import routing**. The Awin-pinned routes become `POST /admin/source-preview/:providerId` and `POST /admin/source-import/:providerId`, resolving via a new registry `resolveProvider(providerId, purpose, deps)` and a generic `ProviderAdapter` contract ([`server/source-provider-types.ts`](server/source-provider-types.ts)) extracted from the identical Awin/Impact shapes (compile-time assignability; zero adapter behavior change). The `:providerId` segment is charset-validated (`^[a-z0-9-]{1,32}$`) before any echo — illegal/oversize → `HTTP 400 {ok:false,error:"invalid provider"}`, raw id never reflected. Resolver is fail-closed (never throws raw): `unknown_provider` / `not_user_exposed` / `capability_unsupported`, returned as the v0.44 disabled-envelope shape at HTTP 200 with no `disabled:true`. **impact remains unreachable on the user surface** — `userExposed:false` denies it for both preview and import; `importSupported:false` is an extra gate. The import route is fully decoupled from the old `AWIN_SOURCE_ID`/`AWIN_SOURCE_NAME` constants: the candidate filter and `importProviderCandidates` args use the resolved registry descriptor (`sourceId`/`displayName`/`sourceType`), never a constant or client value. `awin` response bodies stay byte-identical to v0.44; `source_fetch_log` still records each adapter's own `source_id` row. `server/index.ts` swaps the single injected `awinPreview` for a registry-driven resolver, keeping only the `awin` test-override seam. No new audit/history table, no multi-provider admin chrome, no impact exposure, no scraping/new providers, no automatic import/apply, no scheduler, no extension/`/coupons`/export/import/ranking/DB-schema changes, no live HTTP in tests.
- **v0.44.0** — Registry-backed **admin provider selector**. New protected read-only `GET /admin/source-providers` ([`server/admin-source-providers-routes.ts`](server/admin-source-providers-routes.ts)) filters the v0.43 registry to `userExposed === true` and returns an allowlisted `{ providers: [{ providerId, displayName, sourceId, sourceType, capabilities: { preview, importSupported, cacheSupported } }] }` — `userExposed` is the gate, never a returned field, and `featureEnabled` / `configured` stay only on `/admin/source-status`. The admin UI replaces the static `Provider: Awin` label with a registry-populated `<select>` + capability line that defaults to Awin, capability-gates the Import button on `importSupported`, builds `/admin/source-preview/<id>` and `/admin/source-import/<id>` only from a **hard client-side id allowlist** (`["awin"]`), and falls back to an embedded Awin-only list under 401 / network failure. **impact stays registry-internal** (`userExposed: false`) — absent from the endpoint, the selector, and the admin HTML source. Awin preview/import paths, bodies, the mandatory server-side `IMPORT` confirmation, and the `/admin/source-status` shape are byte-compatible with v0.43. No impact admin exposure/import, no generic public provider endpoint, no automatic import/apply, no scheduler, no source edit/delete/refresh UI, no extension/`/coupons`/export/import/ranking/schema changes, no live HTTP in tests.
- **v0.43.0** — Internal **provider registry** ([`server/source-provider-registry.ts`](server/source-provider-registry.ts)) centralises descriptor metadata, safe status accessors (`featureEnabled` / `configured` booleans only), capability flags (`preview` / `importSupported` / `cacheSupported`), a `userExposed` boolean, and typed preview factories for the two registered providers. **awin** stays fully user-exposed (admin preview, admin import, source-refresh CLI, and `/admin/source-status` byte-compatible with v0.42); **impact** is registered as `importSupported: false` + `userExposed: false`, keeping it out of admin URL allowlists, the source-refresh CLI provider allowlist, and the admin UI. `server/index.ts` now derives the default `awinPreview` closure and `providerStatus` callback from the registry. Unknown providers fail closed (`get() → null`, `statusFor() → { false, false }`). Registry metadata never carries API keys, account SIDs, `Authorization` / `Bearer`, env values, DB paths, raw payloads, raw HTML, affiliate / tracking / payout fields, or stack traces. No admin provider selector, no impact admin preview/import route, no automatic import/apply, no scheduler, no extension/`/coupons`/export/import/ranking/schema changes, no live HTTP in tests.
- **v0.42.0** — Second mocked **provider adapter spike** (impact.com Promotions API). New parallel adapter in [`server/source-provider-impact.ts`](server/source-provider-impact.ts) with independent env reader `readImpactConfig` in [`server/source-provider-config.ts`](server/source-provider-config.ts). Disabled by default; requires `SALVARE_IMPACT_ENABLED=true` plus a non-blank `SALVARE_IMPACT_API_KEY` (and optional `SALVARE_IMPACT_ACCOUNT_SID`) to activate — fail-closed otherwise. Fetcher is injectable so every unit test runs against committed JSON fixtures (`server/fixtures/impact-offers-{ok,edge-cases,malformed}.json`) with zero live HTTP. Promo-code-only `PromotionType` / `Type` filter; affiliate, tracking, deep-link, partner-id, advertiser-id, account-sid, payout, and commission-rate fields are stripped before any candidate is returned; the `impact` `coupon_sources` row is registered at runtime on first call (not seeded into bootstrap). On every attempt the adapter writes a `source_fetch_log` row, and on success it writes a `source_cache` row with body SHA-256 plus `{ offer_count, error_count }` only — no raw payload, no headers, no credentials. Cache-read short-circuit deferred to a future generic provider-registry milestone. The fixtures are explicitly **contract-style; live impact.com response validation remains pending**. No admin preview/import wiring, no source-refresh CLI wiring, no generic provider registry, no admin UI provider selector, no automatic import/apply, no extension/`/coupons`/export/import/ranking/schema changes, no scheduler, no live HTTP in tests, no scraping.
- **v0.40.0** — Read-only admin **source freshness / status dashboard**. New SELECT-only helper [`server/db-source-status.ts`](server/db-source-status.ts) and protected route [`server/admin-source-status-routes.ts`](server/admin-source-status-routes.ts) expose `GET /admin/source-status`, returning one row per `coupon_sources` row covering `enabled`, `providerFeatureEnabled`, `providerConfigured` (booleans only — no env values), `lastFetchAt`, `lastFetchOutcome`, `lastSafeError`, fresh/stale/total cache counts, `cachedCandidateCount`, `newestCacheAt`, and `nextAllowedFetchAt`. The handler does zero writes (no provider call, no fetcher, no importer, no refresh runner) and never returns API keys, the `Authorization` header, env values, cookies, the DB path, raw provider payloads, raw HTML, source URLs, `body_sha256`, `metadata_json`, candidate arrays, stack traces, or affiliate / tracking fields. A small **Source status** admin UI section adds a **Load status** button (intentionally not "Refresh source") that renders the response through `textContent`. No scheduler, no provider fetch, no source refresh, no import/apply/edit/delete controls, no extension behavior change, no `/coupons` shape change, no export/import shape change, no ranking change, no `coupon_results` writes, and no DB schema change.
- **v0.39.0** — Manual **source-refresh CLI** for the mocked, feature-flagged Awin provider. New local entrypoint [`server/source-refresh-cli.ts`](server/source-refresh-cli.ts) (runner in [`server/source-refresh.ts`](server/source-refresh.ts)) exposes the same preview-and-additive-import path as the v0.34/v0.36 admin routes, but from the shell: `npm run source:refresh -- --provider awin --domain <d>` is dry-run by default; `--import --confirm IMPORT` re-uses the v0.36 additive importer and writes `coupon_codes` plus `source_id="awin"` provenance idempotently. Unknown provider, invalid domain, disabled/missing config, and missing/wrong confirmation phrase all fail closed with non-zero exit and an allowlisted reason. Output is JSON built from the same allowlist as the admin routes — no API keys, env values, `Authorization`, cookies, DB paths, raw provider payloads, raw HTML, affiliate/tracking fields, or stack traces. The fetcher is injectable and tests run entirely against fixture JSON with zero live HTTP. No automatic refresh, no scheduler, no second provider, no extension/`/coupons`/export-import/winner-selection/`coupon_results`/schema changes.
- **v0.36.0** — Admin Awin **preview → confirm → import** flow. New protected `POST /admin/source-import/awin` ([`server/admin-source-import-routes.ts`](server/admin-source-import-routes.ts)) requires body `{ "domain", "confirm": "IMPORT" }` and re-derives candidates server-side via the same injectable Awin preview function (cache-preferred via v0.33) — client-posted candidate arrays are never trusted for DB writes. Writes are additive only through new [`server/db-source-import.ts`](server/db-source-import.ts): existing `coupon_codes` rows and non-Awin provenance are preserved, missing rows are `INSERT`ed, and `coupon_code_sources` gains `source_id="awin"` provenance idempotently. `coupon_results` is never read or written. Admin UI adds an **Import previewed candidates** button gated by the previous preview having candidates and an exact `IMPORT` confirmation phrase (server still validates). Response shape is allowlisted (`provider`, `domain`, `candidatesAccepted`, `codesImported`, `provenanceRecorded`, `rejected`, `errors`) and never echoes the API key, `Authorization`, env vars, the DB path, raw payloads, raw HTML, stack traces, or affiliate/tracking fields. No extension behavior change, no automatic test/apply, no ranking change, no `/coupons` shape change, no export/import JSON shape change, no DB schema change, no live HTTP in tests.

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

The full source-ingestion policy and product principles — including allowed source types, prohibited behavior, guardrails, the ranking rule (lowest verified final total wins; affiliate metadata never ranks a worse user outcome above a better one), and the near-term roadmap — live in [`docs/SOURCE_POLICY.md`](docs/SOURCE_POLICY.md). Any future source-ingestion or scraping-related work must review and comply with that document before implementation.
