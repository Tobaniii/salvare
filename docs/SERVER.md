# Salvare Coupon API — Local Server

A minimal Node + TypeScript prototype of the coupon API described in `docs/API_DESIGN.md`. The Chrome extension is wired to it via `extension/couponProvider.ts` (`backend-with-fallback` mode by default) and `extension/resultReporter.ts`.

Runtime persistence is SQLite at `server/salvare.db`. The two JSON files in `server/` are bootstrap-only sources used to populate a fresh database — see [Local database / reset](#local-database--reset) below.

## Run it locally

```bash
npm run build:server   # bundles server/index.ts with esbuild
npm run start:server   # runs the bundled server on http://localhost:4123
```

Override the port with the `PORT` env var if 4123 is in use:

```bash
PORT=4200 npm run start:server
```

## Optional admin token

By default the local server has no auth — fine for single-user local dev on `localhost`. To require a bearer token on admin and destructive endpoints, start the server with `SALVARE_ADMIN_TOKEN`:

```bash
SALVARE_ADMIN_TOKEN=$(openssl rand -hex 32) npm run start:server
```

The startup log line will read `Salvare admin auth: ENABLED`. The server never logs the token value itself — only whether auth is enabled or disabled. With auth enabled, protected endpoints reject requests without a matching `Authorization: Bearer <token>` header with `401 { "error": "unauthorized" }`.

**Protected** (require `Authorization: Bearer <token>` when the env var is set):

- `GET /admin`
- `GET /admin/coupons`
- `POST /admin/coupons`
- `DELETE /admin/coupons`
- `GET /admin/coupon-stats`
- `DELETE /results`

**Unprotected** (open even when the env var is set, so the unmodified extension keeps working and local read access is preserved):

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

**Browser access to `/admin` with the token enabled.** Plain navigation in a browser cannot send an `Authorization` header, so opening `http://localhost:4123/admin` directly will return `401 { "error": "unauthorized" }`. To use the admin UI with the token enabled, fetch the page with curl/HTTPie (`curl -H "Authorization: Bearer $TOKEN" http://localhost:4123/admin`), use a browser extension that injects the header, or unset `SALVARE_ADMIN_TOKEN` while you use the UI. Adding a login form to the admin page is out of scope for this milestone.

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
