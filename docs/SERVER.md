# Salvare Coupon API — Local Server

A small Node + TypeScript backend implementing the coupon API described in `docs/API_DESIGN.md`. The Chrome extension is wired to it via `extension/couponProvider.ts` (`backend-with-fallback` mode by default) and `extension/resultReporter.ts`. Local development only — there is no hosted API, no scraping, and no external coupon discovery.

Runtime persistence is SQLite at `server/salvare.db`. The two JSON files in `server/` are bootstrap-only sources used to populate a fresh database — see [Local database / reset](#local-database--reset) below.

## Run it locally

```bash
npm run build:server   # bundles server/main.ts → server/server.js with esbuild
npm run start:server   # runs the bundled server on http://localhost:4123
```

Note: the entry point is [`server/main.ts`](../server/main.ts) (process bootstrap — opens the DB, runs bootstrap, reads `SALVARE_ADMIN_TOKEN`, listens). [`server/index.ts`](../server/index.ts) is a pure library that exports `createSalvareServer` and never auto-runs, so smoke harnesses and tests can import the factory without spawning a second listener.

Override the port with the `PORT` env var if 4123 is in use:

```bash
PORT=4200 npm run start:server
```

### Environment variables

| Variable               | Default                | Effect                                                                                  |
|------------------------|------------------------|-----------------------------------------------------------------------------------------|
| `PORT`                 | `4123`                 | TCP port to bind. Must be a positive integer in `[1, 65535]`; invalid values exit 1.    |
| `SALVARE_DB_PATH`      | `server/salvare.db`    | SQLite database path. Trimmed; empty/whitespace falls back to the default.              |
| `SALVARE_ADMIN_TOKEN`  | (unset, auth disabled) | Required `Authorization: Bearer <token>` for admin/destructive endpoints when set.      |
| `NODE_ENV`             | `development`          | Informational only; not currently used to gate behavior.                                |

Failure modes:

- Invalid `PORT` (e.g. `PORT=abc`) → `Salvare backend: invalid configuration — PORT must be a positive integer between 1 and 65535 (got 'abc')` and exit 1.
- DB open error (e.g. unreadable path) → `Salvare backend: failed to open database at <path>: <reason>` and exit 1.
- Port already in use at listen time → `Salvare backend: port <n> is already in use. Stop any other process on this port and retry.` and exit 1.

The admin token value is **never** logged. The startup line only prints `Admin auth: ENABLED` or `Admin auth: DISABLED`.

### Startup diagnostics

On every start the server prints a concise human-readable block before listening:

```
Salvare backend starting...
Port: 4123
Database: server/salvare.db
Schema: initialized
Admin auth: DISABLED
Coupon data: present
Result history: present
Listening: http://localhost:4123
```

If JSON bootstrap imported any rows on this start (typically the first run on a fresh DB), an extra line summarises the import counts, e.g. `Bootstrap: imported 3 store(s), 9 code(s), 7 result(s) from JSON.`. Token values, coupon codes, and result rows are not printed — only counts and presence flags.

### Health endpoint

`GET /health` is a **local readiness/diagnostic endpoint, not a public monitoring API.** It is unprotected — it returns the same coarse-status JSON whether or not `SALVARE_ADMIN_TOKEN` is set, so a local script or a `curl` from the same machine can verify the server is up without needing the token.

```bash
curl http://localhost:4123/health
```

```json
{
  "ok": true,
  "service": "salvare-backend",
  "version": "0.9.0",
  "database": {
    "schemaInitialized": true,
    "hasCoupons": true,
    "hasResults": true
  },
  "auth": {
    "adminTokenConfigured": false
  }
}
```

The response is intentionally coarse. It **never** includes the admin token value, the database path, coupon codes, result records, request headers, or an environment dump — only the service name, version, three schema/data booleans, and one `adminTokenConfigured` boolean.

If the database status check throws (e.g. the DB file becomes unreadable mid-run), the endpoint returns `500` with a fixed body and does not leak the underlying error to the client:

```json
{ "ok": false, "service": "salvare-backend", "error": "health check failed" }
```

The raw error is logged server-side as `Salvare health check failed: …`. The version string is sourced from a single `SALVARE_VERSION` constant in [`server/health.ts`](../server/health.ts) — bump it there per milestone.

## Smoke tests

Browser-driven smoke tests live in [`smoke/`](../smoke/) and cover the local backend, the admin page UI, and the Chrome extension on the local React checkout. They use Playwright and isolated in-memory or temporary SQLite databases per test — `server/salvare.db` is never opened or modified. Any temporary on-disk DB used by smoke runs lives at `smoke/salvare.db` and is gitignored — do not commit it.

Three suites:

- `smoke/*.smoke.ts` — backend + admin UI (no extension, no Vite).
- `smoke/extension/*.smoke.ts` — Chrome extension end-to-end on the local React checkout (see [Extension smoke tests](#extension-smoke-tests) below).

One-time setup (downloads the Chromium browser binary used by Playwright):

```bash
npx playwright install chromium
```

Run the suites:

```bash
npm run test:smoke              # backend + admin UI only (fast)
npm run test:smoke:extension    # Chrome extension on the local React checkout
npm run test:smoke:all          # both smoke projects
npm run test:all                # unit tests + all smoke
```

What the smoke suite covers:

- `smoke/admin.smoke.ts` — opens `GET /admin` in Chromium with no token configured, verifies seeded domains render, exercises the add/update/delete flows through the form and Delete button, and cross-checks `GET /coupons` after the UI changes.
- `smoke/api.smoke.ts` — `GET /coupons`, `POST /results` (success + failure), then re-fetches `GET /coupons` and `GET /admin/coupon-stats` to verify ranking and stats reflect reported results.
- `smoke/auth.smoke.ts` — boots the same server with `SALVARE_ADMIN_TOKEN` configured and verifies that browser navigation to `/admin` returns 401, protected admin endpoints reject without/accept with `Authorization: Bearer …`, and the unprotected endpoints (`GET /coupons`, `POST /results`) stay open.

Each test starts its own server on `127.0.0.1` with an OS-assigned port via the `createSalvareServer` factory in [`server/index.ts`](../server/index.ts), so smoke runs do not collide with a developer's running `npm run start:server` and do not touch the developer's local database.

### Extension smoke tests

Extension smoke tests live in [`smoke/extension/`](../smoke/extension/). They drive the unpacked Salvare Chrome extension in Playwright Chromium against the local React demo at `http://localhost:5173`. **No external sites are automated** in this milestone — Shopify and WooCommerce profiles are exercised manually for now.

Run:

```bash
npm run test:smoke:extension
```

This script chains `npm run build:extension` (so the extension bundle is fresh), `npm run build:extension-harness` (isolated Salvare server bundle), and then `playwright test --project=extension`. Combine with the backend/admin suite via `npm run test:smoke:all`.

What the suite covers:

- **`smoke/extension/extension.smoke.ts`** — supported flow: opens `http://localhost:5173` in a Playwright tab with the Salvare extension loaded, opens the popup at `chrome-extension://<id>/popup.html`, asserts it shows the readiness block, clicks **Find Best Coupon**, asserts the popup reports a winning code (one of `SAVE10` / `TAKE15` / `FREESHIP`), asserts the React app's grand-total now matches the popup's reported final total, and asserts the harness backend received at least one successful result report. Plus an unsupported-page test that navigates to a `data:text/html,…` URL (which the extension's `<all_urls>` content-script filter does not match), so the popup's `sendMessage` returns no responder and the popup surfaces the `UNSUPPORTED_FALLBACK` message ("Open a supported checkout page to use Salvare.").

How the suite isolates state:

- A fresh Chromium **persistent context** with a temp `userDataDir` is created per test via `chromium.launchPersistentContext` (loaded with the unpacked `extension/` directory) and removed on teardown — no cross-test browser state leaks.
- The Salvare backend is spawned as a subprocess by Playwright's `globalSetup` ([`smoke/extension/global-setup.ts`](../smoke/extension/global-setup.ts) + the bundled [`smoke/extension-server-harness.ts`](../smoke/extension-server-harness.ts)). It opens `:memory:` SQLite, pre-seeded with the localhost coupon list, and binds on **port 4123 across all interfaces** so the extension's `http://localhost:4123` requests reach it whether `localhost` resolves to IPv4 or IPv6. The developer's `server/salvare.db` is never opened. The harness is killed on test teardown.
- Playwright's `webServer` config also spawns Vite (`npm run dev`) for the React demo at `http://localhost:5173`.
- If port 4123 is already in use (e.g. a developer's `npm run start:server` is running), `globalSetup` exits up-front with a clear message asking them to stop the existing server. The probe binds without a host argument so it sees both IPv4 and IPv6 listeners. The harness does not auto-kill any existing process.

How the popup is driven without a clickable toolbar icon:

- The popup is opened in a regular tab via its `chrome-extension://` URL.
- Before `popup.js` runs, the test injects an `addInitScript` that wraps `chrome.tabs.query` so the popup's "active tab" lookup resolves to the checkout tab (matched by URL prefix) instead of the popup tab itself. The popup script is otherwise unchanged; the rewrite is purely test-side.

About the no-op background service worker:

- [`extension/background.ts`](../extension/background.ts) exists **only** so Playwright can discover the extension's runtime ID via `context.serviceWorkers()`. It logs one line on activation (so the bundled file is non-empty — Chromium's headless mode rejects 0-byte service workers) and registers no listeners. No message handlers, no storage, no network access. The popup, content script, and result reporter are unaffected. If you ever add real background behavior, update the comment at the top of `background.ts` and this section.
- The smoke suite uses Chromium's **new headless mode** (`--headless=new`) since classic headless does not load extensions. Set `SALVARE_SMOKE_HEADED=1` to run with a visible window if a host environment misbehaves with new headless.

One-time browser install (same as the backend smoke suite):

```bash
npx playwright install chromium
```

## Optional admin token

By default the local server has no auth — fine for single-user local dev on `localhost`. To require a bearer token on admin and destructive endpoints, start the server with `SALVARE_ADMIN_TOKEN`:

```bash
SALVARE_ADMIN_TOKEN=$(openssl rand -hex 32) npm run start:server
```

The startup log line will read `Salvare admin auth: ENABLED`. The server never logs the token value itself — only whether auth is enabled or disabled. With auth enabled, protected endpoints reject requests without a matching `Authorization: Bearer <token>` header with `401 { "error": "unauthorized" }`.

**Protected** (require `Authorization: Bearer <token>` when the env var is set):

- `GET /admin/coupons`
- `POST /admin/coupons`
- `DELETE /admin/coupons`
- `GET /admin/coupon-stats`
- `DELETE /results`

**Unprotected** (open even when the env var is set, so the unmodified extension keeps working, the admin page can load and prompt for a token, and local read access is preserved):

- `GET /admin` — returns the static admin shell. The page itself prompts for the token and uses it for the protected admin endpoints. See [Using the admin UI in token mode](#using-the-admin-ui-in-token-mode) below.
- `GET /coupons`
- `POST /results`
- `GET /results`

`OPTIONS` preflight requests are unprotected and continue to return `204` regardless of token state, so browser CORS handshakes succeed.

Example:

```bash
TOKEN="$SALVARE_ADMIN_TOKEN"
curl -H "Authorization: Bearer $TOKEN" http://localhost:4123/admin/coupons
curl -X POST http://localhost:4123/admin/coupons \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"domain":"example.com","candidateCodes":["WELCOME10"]}'
```

### Using the admin UI in token mode

`GET /admin` is unprotected so the static admin shell can load in a browser even when token auth is on. The shell renders an "Admin token required or invalid" banner and an **Admin token** bar at the top of the page until a valid token is provided.

1. Open `http://localhost:4123/admin` in a browser.
2. Paste the token into the **Admin token** input (rendered as a password field) and click **Save**. The token is stored in `localStorage` under the key `salvareAdminToken`. The input is cleared after Save and the stored value is never displayed back; the token-status line just reads "Token saved (stored locally in this browser)." after a save or page reload.
3. The page reloads the coupon data using `Authorization: Bearer <token>` and the unauthorized banner disappears. Subsequent reloads pick up the stored token automatically.
4. Click **Clear** to remove the token from storage; the page returns to the unauthorized state.

If the token is wrong, the page surfaces the unauthorized banner instead of crashing. The form-submit and Delete handlers also surface "Save failed: unauthorized." / "Delete failed: unauthorized." in the status line if the protected endpoint returns 401.

The `localStorage` token is plaintext on disk and readable by any script with access to the same origin in the same browser profile. Same threat model as everything else on this local-only page; acceptable for local hardening, not key custody. Clear the token (or close the browser profile) when you're done.

This is **local hardening** — useful on a shared dev machine, or to prevent accidental admin writes from a curl typo. It is **not** production auth: there is no rate limiting, no token rotation, no TLS termination, the public read endpoints stay open, and `POST /results` deliberately stays open so the extension keeps reporting without token wiring.

## Local database / reset

Salvare stores all runtime data — coupon seed/admin entries and reported result history — in a single SQLite file at `server/salvare.db`. This file is **local runtime data and is gitignored; do not commit it.** The same applies to SQLite's sidecar files (`-journal`, `-wal`, `-shm`).

Bootstrap sources (kept in the repo for fresh dev environments):

- [`server/coupons.seed.json`](../server/coupons.seed.json) — bootstrap seed for `stores` + `coupon_codes`.
- [`server/coupon-results.json`](../server/coupon-results.json) — bootstrap seed for `coupon_results`.

After bootstrap, admin edits (`POST/DELETE /admin/coupons`) and reported results (`POST /results`) persist in `server/salvare.db`, not in the JSON files.

### First-time setup on a fresh checkout

```bash
npm run db:init        # builds and runs server/db-init.js — creates tables in server/salvare.db
npm run db:bootstrap   # imports both JSON files into the new database
npm run start:server
```

You can also skip `db:init` and just start the server: `openDatabase` ensures the schema, and `bootstrapIfEmpty` / `bootstrapResultsIfEmpty` import the JSON files automatically when the corresponding tables are empty.

### Reset local data

To wipe all local runtime data and start over from the bootstrap JSON files:

```bash
rm -f server/salvare.db server/salvare.db-journal server/salvare.db-wal server/salvare.db-shm
npm run db:init
npm run db:bootstrap
```

Note: re-running `npm run db:bootstrap` against an already-populated database **adds** new domains/codes from the seed JSON via `INSERT OR IGNORE` (existing rows are not removed or rewritten) and **clears + reimports** the entire `coupon_results` table from the result-history JSON. If you want a true reset, delete the DB file first.

## Endpoint

```
GET /coupons?domain=<hostname>
```

### Supported domain example

```bash
curl 'http://localhost:4123/coupons?domain=localhost'
```

```json
{
  "domain": "localhost",
  "candidateCodes": ["SAVE10", "TAKE15", "FREESHIP"],
  "source": "mock-backend",
  "updatedAt": "2026-05-01T00:00:00.000Z"
}
```

### Unsupported domain example

```bash
curl 'http://localhost:4123/coupons?domain=example.com'
```

```json
{
  "domain": "example.com",
  "candidateCodes": [],
  "source": "none",
  "updatedAt": "2026-05-01T00:00:00.000Z"
}
```

### Errors

- Missing `domain` query parameter → `400 { "error": "missing domain" }`.
- Any other path or method → `404 { "error": "not found" }`.

## Seeded domains

- `localhost`
- `salvare-test-store.myshopify.com`
- `salvare-woo-test.local`

These match the candidate codes the extension tests via its mock provider. The bootstrap seed lives in [`server/coupons.seed.json`](../server/coupons.seed.json) and is imported into SQLite on first run. After bootstrap, runtime reads come from SQLite (`server/salvare.db`) and runtime edits should go through the admin UI / `POST /admin/coupons` — they land directly in the database. To add a new bootstrap entry for fresh dev environments, edit the JSON and either delete `server/salvare.db` (next start re-bootstraps) or run `npm run db:bootstrap` (adds new domains/codes via `INSERT OR IGNORE`; does not remove or rename existing rows). The seed is duplicated from `extension/storeProfiles.ts` on purpose; a later milestone will collapse the two sources.

When local result history exists for the requested domain, the backend orders `candidateCodes` returned by `GET /coupons` by historical performance: codes with at least one successful test rank first (highest average `savingsCents`, with most recent success as a tiebreaker), then codes with no history in seed order, then failure-only codes. The response shape is unchanged; ranking only reorders existing seed/admin codes and never adds or removes them.

## Admin page

A minimal local admin UI is served at:

```
http://localhost:4123/admin
```

The page lists every seeded domain and includes a small form to add or update a domain. Enter the domain, type the candidate codes comma-separated (e.g. `WELCOME10, SAVE15`), and click **Save**. The list refreshes after the server confirms the change. Local development only — there is no auth, and the page is served from `localhost`.

Each domain section now shows per-code stats — current rank, success count, failure count, average savings, and the last successful test date — sourced from `GET /admin/coupon-stats?domain=…`. If the stats fetch fails for a single domain, the page still renders that domain with "Stats unavailable." instead of breaking the whole list.

The page is `server/admin.html`, served as-is; it sits next to the bundled `server/index.js` so that the running server can read it from disk.

## Admin endpoints

Local-only endpoints for inspecting and updating the coupon map at runtime. Edits go directly into SQLite (`server/salvare.db`) and survive restarts; the bootstrap JSON file is not touched.

### List all seeded coupons

```bash
curl http://localhost:4123/admin/coupons
```

```json
{
  "coupons": {
    "localhost": ["SAVE10", "TAKE15", "FREESHIP"],
    "salvare-test-store.myshopify.com": ["WELCOME10", "SAVE15", "FREESHIP"],
    "salvare-woo-test.local": ["WELCOME10", "TAKE20", "FREESHIP"]
  },
  "updatedAt": "2026-05-02T00:00:00.000Z"
}
```

### Add or update a domain

```bash
curl -X POST http://localhost:4123/admin/coupons \
  -H 'Content-Type: application/json' \
  -d '{"domain":"example.com","candidateCodes":["WELCOME10","SAVE15"]}'
```

```json
{
  "domain": "example.com",
  "candidateCodes": ["WELCOME10", "SAVE15"]
}
```

The server trims whitespace and removes duplicate codes before saving. The change is written to `server/salvare.db` (a single SQLite transaction that upserts the store row, deletes existing codes for the domain, then inserts the new code list) so it survives restarts. The bootstrap JSON file is not modified. Validation rules:

- `domain` must be a non-empty string.
- `candidateCodes` must be an array of non-empty strings.

Invalid input → `400 { "error": "..." }`. The endpoints have no auth and bind to localhost only; they are intended for local dev use.

### Per-code stats for a domain

```bash
curl 'http://localhost:4123/admin/coupon-stats?domain=salvare-woo-test.local'
```

```json
{
  "domain": "salvare-woo-test.local",
  "codes": [
    {
      "code": "TAKE20",
      "rank": 1,
      "successCount": 4,
      "failureCount": 1,
      "averageSavingsCents": 2000,
      "lastSuccessAt": "2026-05-02T00:00:00.000Z"
    }
  ]
}
```

Codes are returned in the same ranked order as `GET /coupons?domain=…`. History for codes that are no longer in the seed/admin candidate list is excluded. `averageSavingsCents` and `lastSuccessAt` are `null` when the code has no successful results.

Missing or empty `domain` query parameter → `400 { "error": "missing domain" }`.

### Delete a domain

```bash
curl -X DELETE 'http://localhost:4123/admin/coupons?domain=example.com'
```

```json
{
  "deleted": true,
  "domain": "example.com"
}
```

- Missing or empty `domain` query parameter → `400 { "error": "missing domain" }`.
- Domain not in the seed map → `404 { "error": "domain not seeded", "domain": "..." }`.

## Coupon result history

Local-only endpoints for recording and reading coupon test outcomes. The extension reports results via `extension/resultReporter.ts` (best-effort, fire-and-forget).

Result history persists in SQLite (`server/salvare.db`). [`server/coupon-results.json`](../server/coupon-results.json) (`{ "results": [...] }` envelope) is a bootstrap-only source — its contents are imported once into SQLite on first run, and runtime writes do not modify it.

### Record a result

```bash
curl -X POST http://localhost:4123/results \
  -H 'Content-Type: application/json' \
  -d '{
    "domain": "example.com",
    "code": "WELCOME10",
    "success": true,
    "savingsCents": 1500,
    "finalTotalCents": 8500
  }'
```

Successful response (the stored record with a server-stamped `testedAt`):

```json
{
  "domain": "example.com",
  "code": "WELCOME10",
  "success": true,
  "savingsCents": 1500,
  "finalTotalCents": 8500,
  "testedAt": "2026-05-02T00:00:00.000Z"
}
```

Validation rules:

- `domain` and `code` must be non-empty strings.
- `success` must be a boolean.
- `savingsCents` and `finalTotalCents` must be non-negative integers.

Invalid input → `400 { "error": "..." }`.

### Read history for a domain

```bash
curl 'http://localhost:4123/results?domain=example.com'
```

```json
{
  "domain": "example.com",
  "results": [
    {
      "code": "WELCOME10",
      "success": true,
      "savingsCents": 1500,
      "finalTotalCents": 8500,
      "testedAt": "2026-05-02T00:00:00.000Z"
    }
  ]
}
```

Missing or empty `domain` query parameter → `400 { "error": "missing domain" }`.

### Clear history for a domain

```bash
curl -X DELETE 'http://localhost:4123/results?domain=example.com'
```

```json
{
  "domain": "example.com",
  "deletedCount": 3
}
```

- Idempotent: calling on a domain with no records returns `deletedCount: 0` and `200`.
- Other domains' records are left untouched.
- Missing or empty `domain` query parameter → `400 { "error": "missing domain" }`.

## CORS for local development

The server allows result-reporting POSTs (and other API calls) from a small allowlist of local development origins. When the request `Origin` header matches the allowlist, the server echoes it back in `Access-Control-Allow-Origin` and includes the methods and headers needed for the extension's `fetch` calls.

Allowed origins:

- `http://localhost`
- `http://localhost:5173`
- `http://salvare-woo-test.local`
- `https://salvare-test-store.myshopify.com`

`OPTIONS` preflight requests respond `204` with the same headers when the origin is allowed, and `204` without CORS headers (browser blocks the follow-up) for unknown origins. Other allowlist entries can be added in `server/cors.ts`.

## Provider modes

The extension's `couponProvider.ts` supports two explicit modes:

- `mock` — skips the local backend entirely and returns mock/profile candidate codes. Use this when you want to avoid the local-network permission prompt or when running offline.
- `backend-with-fallback` — tries `http://localhost:4123/coupons` first and falls back to mock candidate codes when the backend is unreachable, slow, or returns an unexpected shape.

The current default is `backend-with-fallback`. Switching to `mock` skips the localhost call and avoids the Chrome permission prompt described below.

## Chrome permission prompt

When the content script first contacts `http://localhost:4123` from a checkout page, Chrome may show a permission prompt because the page is reaching out to a local service.

- Click **Allow** during local development testing.
- The prompt is expected — it is the browser asking whether the checkout page may talk to your local backend.
- If the backend is stopped or the request is blocked, Salvare automatically falls back to the mock/profile-based candidate codes, so the extension keeps working.
