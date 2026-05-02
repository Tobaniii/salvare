# Salvare Database Plan — v0.6.0

Today's backend persistence is JSON files (`server/coupons.seed.json` and `server/coupon-results.json`). This plan describes the move to a single local SQLite database without changing the HTTP API or the extension. It is design-only — no code or dependencies are added in this milestone.

## 1. Why SQLite, why now

- Two JSON files already coexist (seed + result history) and a third would be a stretch. Concurrent writes from the admin page and the extension can race.
- SQLite gives transactions, indexed queries on `domain` / `code` / `tested_at`, and easy cleanup — without a daemon. One file, no service.
- It fits a local development backend. There is still no hosted API.

## 2. Why the extension stays untouched

The extension only sees HTTP endpoints. We freeze the API surface — `/coupons`, `/admin/coupons`, `/admin/coupon-stats`, `/results` — and validate that response shapes, ranking rules, status codes, and CORS behavior are identical after the swap. No popup, content script, `couponProvider`, or `resultReporter` changes.

## 3. Current JSON data sources

- [`server/coupons.seed.json`](../server/coupons.seed.json) — seed/admin candidate codes per domain.
- [`server/coupon-results.json`](../server/coupon-results.json) — coupon test outcomes captured by the extension.

## 4. Proposed schema

Single SQLite database file: `server/salvare.db` (added to `.gitignore`). Three tables.

### `stores`

| Column       | Type    | Notes                            |
|--------------|---------|----------------------------------|
| `id`         | INTEGER | PRIMARY KEY                      |
| `domain`     | TEXT    | NOT NULL UNIQUE                  |
| `created_at` | TEXT    | NOT NULL (ISO-8601)              |
| `updated_at` | TEXT    | NOT NULL (ISO-8601)              |

### `coupon_codes`

| Column       | Type    | Notes                                         |
|--------------|---------|-----------------------------------------------|
| `id`         | INTEGER | PRIMARY KEY                                   |
| `store_id`   | INTEGER | NOT NULL REFERENCES `stores`(`id`) ON DELETE CASCADE |
| `code`       | TEXT    | NOT NULL                                      |
| `created_at` | TEXT    | NOT NULL                                      |
| `updated_at` | TEXT    | NOT NULL                                      |

UNIQUE(`store_id`, `code`).

### `coupon_results`

| Column              | Type    | Notes                                         |
|---------------------|---------|-----------------------------------------------|
| `id`                | INTEGER | PRIMARY KEY                                   |
| `store_id`          | INTEGER | NOT NULL REFERENCES `stores`(`id`) ON DELETE CASCADE |
| `code`              | TEXT    | NOT NULL                                      |
| `success`           | INTEGER | NOT NULL (0/1)                                |
| `savings_cents`     | INTEGER | NOT NULL                                      |
| `final_total_cents` | INTEGER | NOT NULL                                      |
| `tested_at`         | TEXT    | NOT NULL                                      |

INDEX (`store_id`, `code`) for stat aggregation; INDEX (`tested_at`) for "most recent success" tiebreaker.

Timestamps are ISO-8601 strings — matches what the API already produces and serves. SQLite has no native datetime type; lexicographic ordering on ISO strings works for the ranking tiebreaker.

## 5. API → database operations

| Endpoint                         | Operation |
|----------------------------------|-----------|
| `GET /coupons?domain=…`          | `SELECT code FROM coupon_codes JOIN stores …` for the domain, then call `rankCandidateCodes` over `coupon_results`. |
| `GET /admin/coupons`             | `SELECT domain, code FROM stores LEFT JOIN coupon_codes` and group by domain. |
| `POST /admin/coupons`            | Upsert `stores` row; inside a transaction, `DELETE` and `INSERT` `coupon_codes` for the store with the trimmed/deduped list. |
| `DELETE /admin/coupons?domain=…` | `DELETE FROM stores WHERE domain=?` — `coupon_codes` rows cascade. |
| `POST /results`                  | Upsert `stores`, `INSERT` into `coupon_results`. |
| `GET /results?domain=…`          | `SELECT … FROM coupon_results JOIN stores …` for the domain, ordered by `tested_at`. |
| `DELETE /results?domain=…`       | `DELETE FROM coupon_results` for the store; return affected count. |
| `GET /admin/coupon-stats?domain=…` | `SELECT` codes + aggregate over `coupon_results`; pass through `buildCouponStats`. |

Ranking rules and `buildCouponStats` are unchanged — they still operate on arrays returned from queries.

## 6. Migration approach

- On first start, the server runs an idempotent schema-migration step. If tables don't exist, it creates them, then imports `coupons.seed.json` into `stores`/`coupon_codes` and `coupon-results.json` into `coupon_results`. If the tables already have rows, the import is skipped.
- Response shapes stay identical. Existing pure helpers (`validateAdminBody`, `validateResultBody`, `validateDomainParam`, `rankCandidateCodes`, `buildCouponStats`, `parseCommaSeparatedCodes`) are untouched. Only the data layer behind them changes.
- Admin UI is unchanged — it talks to the same HTTP endpoints.

## 7. Phased implementation plan

1. **Phase 1 — schema and dependency.** Add `better-sqlite3` to dependencies. Add `server/db/schema.sql` (or inline schema) and a `migrate()` function that creates tables idempotently. No handler changes yet.
2. **Phase 2 — data access layer.** Add `server/db.ts` that opens a single connection (`server/salvare.db`, or `:memory:` in tests). Add per-concern modules under `server/db/` — `stores.ts`, `codes.ts`, `results.ts` — exposing a small typed API. Tests use an in-memory database via dependency injection.
3. **Phase 3 — migrate coupon seed/admin.** Switch `getSeedData`, `upsertCoupons`, `deleteCoupons` to the DB layer. JSON file becomes bootstrap-only. Run the full extension test suite at each step to verify behavior parity.
4. **Phase 4 — migrate result history.** Switch `appendResult`, `getResultsForDomain`, `deleteResultsForDomain`, `getAllResults` to the DB. Result-history JSON becomes bootstrap-only.
5. **Phase 5 — JSON as bootstrap only.** Keep both JSON files in-tree as the one-shot import source for fresh dev environments. Document them as legacy and plan removal once the DB workflow is the default.
6. **Phase 6 — final QA.** Run Salvare on all three test environments (local React, Shopify dev, WooCommerce LocalWP). Verify identical responses, ranking, and stats. Update `QA.md` with the new "reset DB" instruction.

## 8. Risks and assumptions

- **DB file location.** `server/salvare.db`, sibling to existing JSON files. Add to `.gitignore` since it holds runtime data.
- **Resetting local data.** `rm server/salvare.db` re-bootstraps from JSON on next start. Document in `docs/SERVER.md` once Phase 5 lands.
- **JSON import.** Single transaction, idempotent, bounded by file size. Runs only when the DB has no rows for the relevant table.
- **Test determinism.** Each test suite uses a fresh in-memory database (`":memory:"`). No shared disk state, parallel-safe.
- **Concurrency.** SQLite serializes writes; the local server is a single Node process so contention is minimal. WAL mode is optional and unlikely to be needed at this scale.
- **Dependency choice.** `better-sqlite3` is synchronous, small, and avoids an async refactor of the existing handlers. `node:sqlite` (Node 22+) and the older `sqlite3` package are alternatives but trade portability or ergonomics. The choice can be revisited in Phase 1 if installation friction surfaces.
- **Extension behavior.** Not touched at any phase. Each phase ends with `npm run build:extension` and the existing 99-test suite green.

## 9. Phase 1 status

Phase 1 has landed: the SQLite dependency and schema setup are in place. No routes are wired to the database yet.

- `npm run build:db-init` bundles `server/db-init.ts` to `server/db-init.js` (esbuild, with `better-sqlite3` kept external).
- `npm run db:init` builds the script and runs it via `node`. The script opens (or creates) `server/salvare.db` next to the existing JSON files and applies the schema. It is idempotent — re-running does nothing harmful.
- `server/salvare.db` (and SQLite's sidecar files: `-journal`, `-wal`, `-shm`) is local runtime data and is ignored by Git. The bundled `server/db-init.js` is also ignored. To reset the local database, delete `server/salvare.db` and re-run `npm run db:init`.

Phase 2 will start using this connection from the existing route handlers.

### Phase 5 — JSON as bootstrap only (docs cleanup)

The runtime is fully on SQLite. Both JSON files in `server/` are now bootstrap-only sources, kept in the repo so a fresh checkout can populate a database from a reviewable, committed snapshot.

- `server/salvare.db` (and the SQLite sidecar files `-journal`, `-wal`, `-shm`) is local runtime data, gitignored — do not commit it.
- [`server/coupons.seed.json`](../server/coupons.seed.json) and [`server/coupon-results.json`](../server/coupon-results.json) are imported into SQLite on first run and via `npm run db:bootstrap`. Runtime admin edits and reported results persist in SQLite, not in the JSON files.
- Reset recipe: `rm -f server/salvare.db && npm run db:init && npm run db:bootstrap`. Documented in [`docs/SERVER.md`](./SERVER.md#local-database--reset).
- Quirk to be aware of: re-running `npm run db:bootstrap` on an already-populated DB **adds** new seed rows via `INSERT OR IGNORE` (does not remove or rewrite existing rows) and **clears + reimports** the entire `coupon_results` table. For a true reset of seed/admin data, delete the DB file first.
- README, `docs/SERVER.md`, `docs/SEED_DATA.md`, and `docs/API_DESIGN.md` were updated to reflect the runtime/bootstrap split. No runtime code changes in this phase.
- JSON file removal is not in this phase. The files stay in-tree as the canonical bootstrap snapshot.

### Phase 4 — result history on SQLite

Coupon result history reads and writes now go through SQLite at runtime via `server/db-results.ts`. The JSON file is no longer the runtime source of truth.

- On startup, after the seed bootstrap, the server runs `bootstrapResultsIfEmpty`. If `coupon_results` is empty, the contents of `server/coupon-results.json` are imported once. Subsequent restarts no-op, so newly written records survive.
- `POST /results`, `GET /results?domain=…`, and `DELETE /results?domain=…` go through the SQLite repository. Records persist across server restarts (verified by `server/db-results.test.ts`'s file-backed reopen test, and by a manual restart check).
- Append for an unseeded domain is supported: the repository `INSERT OR IGNORE`s a `stores` row before inserting the result row, matching the prior JSON-backed behavior of accepting any domain.
- `DELETE /results` removes only `coupon_results` rows for the domain — the `stores` row and any `coupon_codes` are preserved.
- `server/coupon-results.json` remains a bootstrap source. Existing pure helpers (`validateResultBody`, `rankCandidateCodes`, `buildCouponStats`) are unchanged.
- API response shapes are unchanged. Ranking and admin stats behavior are unchanged.
- The explicit `npm run db:bootstrap` CLI continues to clear and reimport result history from the JSON file for deliberate resets.

### Phase 3 — coupon data on SQLite

Coupon seed/admin reads and writes now go through SQLite at runtime via `server/db-coupons.ts`. Result history remains JSON-backed in this milestone.

- On startup, the server opens `server/salvare.db`, ensures the schema, and runs `bootstrapIfEmpty`. If the `stores` table is empty, the contents of `server/coupons.seed.json` are imported automatically. Subsequent restarts no-op.
- Admin add/update/delete operations write to the database, so changes persist across server restarts (verified by `server/db-coupons.test.ts`'s file-backed reopen test).
- For a fresh database — for example after deleting `server/salvare.db` — run `npm run db:bootstrap` to import both the seed JSON and the result history JSON, or just start the server (`npm run start:server`) and let `bootstrapIfEmpty` populate the seed automatically.
- Result history endpoints (`POST/GET/DELETE /results`) still read and write `server/coupon-results.json` via `server/results.ts`. Phase 4 will move these to SQLite.
- API response shapes are unchanged. The popup, content script, and admin UI continue to work identically.

### Phase 2 — JSON-to-SQLite bootstrap

A bootstrap step lands ahead of the route swap so the database can be populated from existing JSON files.

- `npm run db:bootstrap` bundles `server/db-bootstrap-cli.ts` and runs it. The script imports `server/coupons.seed.json` and `server/coupon-results.json` into `server/salvare.db`.
- Seed and coupon-code imports are idempotent: stores and codes are inserted with `INSERT OR IGNORE`, so repeated runs report zero new rows.
- Result history is cleared and reimported from the JSON file on every bootstrap run. The JSON file remains the source of truth in Phase 2 — routes still write to JSON, and the DB mirror is rebuilt on demand. This will be revisited in Phase 4 when routes start writing directly to the DB.

## 10. Out of scope

- Hosted database, replication, or remote sync.
- Auth, rate limiting, multi-tenant data partitioning.
- Schema changes that would break existing API shapes.
- Scraping or external coupon discovery.
- Extension changes.
