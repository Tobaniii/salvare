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
