# Salvare Coupon API — Local Server

A minimal Node + TypeScript prototype of the coupon API described in `docs/API_DESIGN.md`. This is the v0.2.0 milestone-1 backend. The Chrome extension is **not** wired to it yet; v0.1.0 still ships with the mock provider in `extension/couponProvider.ts`.

## Run it locally

```bash
npm run build:server   # bundles server/index.ts with esbuild
npm run start:server   # runs the bundled server on http://localhost:4123
```

Override the port with the `PORT` env var if 4123 is in use:

```bash
PORT=4200 npm run start:server
```

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

These match the candidate codes the v0.1.0 extension already tests via its mock provider. The seed lives in [`server/coupons.seed.json`](../server/coupons.seed.json); add or edit domains there without touching TypeScript. esbuild inlines the JSON during `npm run build:server`, so re-run that script (and restart the server) to pick up edits. The seed is duplicated from `extension/storeProfiles.ts` on purpose; a later milestone will collapse the two sources once the extension is wired to the backend.

## Admin page

A minimal local admin UI is served at:

```
http://localhost:4123/admin
```

The page lists every seeded domain and includes a small form to add or update a domain. Enter the domain, type the candidate codes comma-separated (e.g. `WELCOME10, SAVE15`), and click **Save**. The list refreshes after the server confirms the change. Local development only — there is no auth, and the page is served from `localhost`.

The page is `server/admin.html`, served as-is; it sits next to the bundled `server/index.js` so that the running server can read it from disk.

## Admin endpoints

Local-only endpoints for inspecting and updating the seeded coupon map at runtime. Useful in dev so you don't have to edit `server/coupons.seed.json` and rebuild the bundle to test new domains.

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

The server trims whitespace and removes duplicate codes before saving. The change is written back to `server/coupons.seed.json` (atomic temp + rename) so it survives restarts. Validation rules:

- `domain` must be a non-empty string.
- `candidateCodes` must be an array of non-empty strings.

Invalid input → `400 { "error": "..." }`. The endpoints have no auth and bind to localhost only; they are intended for local dev use.

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

Local-only endpoints for recording and reading coupon test outcomes. The extension is **not** wired to these yet; v0.4.0 milestone 1 only adds the backend surface.

Result history persists to `server/coupon-results.json` (`{ "results": [...] }` envelope).

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
