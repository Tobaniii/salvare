# Salvare Coupon API — Design Notes

## 1. Purpose

This document describes the proposed shape of a future coupon API that Salvare's extension can consume to fetch candidate coupon codes for a given store. The API is not implemented today. The extension already exposes a stable seam in `extension/couponProvider.ts` that a real backend can replace without changing the rest of the extension.

## 2. Proposed endpoint

```
GET /coupons?domain=example.com
```

- Read-only, idempotent.
- Driven by a single `domain` query parameter, populated by the extension from the active tab's hostname.
- Returns the candidate codes the extension should test against the live checkout.

## 3. Example response

```json
{
  "domain": "example.com",
  "candidateCodes": ["WELCOME10", "SAVE15"],
  "source": "mock-backend",
  "updatedAt": "2026-05-01T00:00:00.000Z"
}
```

The `source` and `updatedAt` fields map directly onto the existing `CandidateCodeResult.source` and `CandidateCodeResult.fetchedAt` fields, so swapping the provider should not require reshaping data on the client.

When local result history exists for the requested domain, the local backend orders `candidateCodes` by historical performance: codes with at least one successful test first (highest average `savingsCents`, with most recent success as a tiebreaker), then codes with no history in their original seed order, then failure-only codes last. Result history only changes the order — codes are never added or removed by ranking.

## 4. Error / empty response

Unsupported domain — `200 OK`, uniform shape, empty `candidateCodes`:

```json
{
  "domain": "example.com",
  "candidateCodes": [],
  "source": "none",
  "updatedAt": "2026-05-01T00:00:00.000Z"
}
```

Server error — `500`, minimal body:

```json
{ "error": "internal" }
```

The client treats both empty and error responses the same way for now: no candidate codes, no testing.

## 5. Notes

- The current extension still uses mock/profile-based candidate codes from `extension/storeProfiles.ts`.
- No scraping is implemented and none is planned in this document.
- A future backend should return candidate codes only. The extension is responsible for verifying each code against the live checkout before reporting it as a winner.

## 6. Out of scope

Authentication, rate limiting, per-user state, and coupon discovery from external sources are not addressed here.
