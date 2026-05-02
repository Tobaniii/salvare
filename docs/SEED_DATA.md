# Salvare Backend Seed Data

## 1. Purpose

The local backend's mock coupon candidates live in [`server/coupons.seed.json`](../server/coupons.seed.json). This guide explains how to edit them. See [`docs/SERVER.md`](./SERVER.md) for how to run the backend itself.

## 2. File format

A single JSON object at the top level. Each key is a domain (matching `window.location.hostname` on the target checkout). Each value is an array of coupon code strings.

## 3. Example

```json
{
  "example-store.com": ["WELCOME10", "SAVE15"]
}
```

## 4. How to update seed data

1. Edit `server/coupons.seed.json`.
2. Run `npm run build:server`.
3. Restart `npm run start:server`.
4. Test the new entry with `curl`.

## 5. Example curl

```bash
curl "http://localhost:4123/coupons?domain=example-store.com"
```

```json
{
  "domain": "example-store.com",
  "candidateCodes": ["WELCOME10", "SAVE15"],
  "source": "mock-backend",
  "updatedAt": "2026-05-02T00:00:00.000Z"
}
```

## 6. Notes

- The extension still verifies every code directly on checkout; a code in the seed is a candidate, not a guarantee.
- No scraping or external coupon discovery is implemented.
- JSON changes require rebuilding (`npm run build:server`) and restarting the local server before they take effect.
