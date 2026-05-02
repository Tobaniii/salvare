# Salvare Backend Seed Data

## 1. Purpose

[`server/coupons.seed.json`](../server/coupons.seed.json) is **bootstrap-only** seed data for the local backend. Its contents are imported once into SQLite (`server/salvare.db`) on a fresh database; after that, the database is the runtime source of truth and routine admin edits should go through the admin UI or `POST /admin/coupons`. See [`docs/SERVER.md`](./SERVER.md) for how to run the backend, and the **Local database / reset** section there for the reset workflow.

`server/salvare.db` is local runtime data and is gitignored — do not commit it. The JSON file is committed and acts as a portable, reviewable snapshot of the candidate codes a fresh dev environment should start with.

## 2. File format

A single JSON object at the top level. Each key is a domain (matching `window.location.hostname` on the target checkout). Each value is an array of coupon code strings.

## 3. Example

```json
{
  "example-store.com": ["WELCOME10", "SAVE15"]
}
```

## 4. How to update seed data

For a runtime addition or edit on a running server, use the admin UI (`http://localhost:4123/admin`) or `POST /admin/coupons` — the change lands directly in `server/salvare.db` and survives restarts. Editing the JSON for that case is unnecessary.

To change the bootstrap seed (what a brand-new dev environment will see):

1. Edit `server/coupons.seed.json`.
2. Apply the change to your local database with **one** of:
   - `rm -f server/salvare.db && npm run db:init && npm run db:bootstrap` — full reset; the new seed is the only seed.
   - `npm run db:bootstrap` — adds new domains/codes via `INSERT OR IGNORE`. Existing rows in `stores` / `coupon_codes` are **not** removed or rewritten, so renames and removals require the full reset above.
3. Restart the server if it is running (`npm run start:server`).
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
- JSON edits affect runtime behavior only after a `db:bootstrap` (or DB reset). On a server with an existing database, runtime admin edits are the normal path.
