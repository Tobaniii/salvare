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

These match the candidate codes the v0.1.0 extension already tests via its mock provider. The seed currently lives in `server/coupons.ts` and is duplicated from `extension/storeProfiles.ts` on purpose; a later milestone will collapse the two sources once the extension is wired to the backend.

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
