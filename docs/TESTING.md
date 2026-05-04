# Salvare Testing & Verification Guide

Salvare ships with a layered verification surface: unit tests, build/type checks, read-only database and profile verification, and Playwright smoke suites for the backend, admin UI, and Chrome extension. This document explains every layer, which commands are safe to run repeatedly, which commands mutate local state, and how to recover from common failures.

The shorthand `verify:*` aliases in `package.json` group these layers so you can pick the right level of confidence without memorizing every underlying command. None of the `verify:*` aliases mutate `server/salvare.db`.

---

## At a glance

| Command | Mutates local DB? | Needs port 4123 free? | Needs Playwright Chromium? | Recommended use |
|---|---|---|---|---|
| `npm test` | no | no | no | Unit tests during development. |
| `npx tsc -b` | no | no | no | Type-check the whole project. |
| `npm run build:server` | no | no | no | Bundle the backend. |
| `npm run build:extension` | no | no | no | Bundle the Chrome extension. |
| `npm run db:init` | **yes** (creates schema) | no | no | First-time setup only. |
| `npm run db:bootstrap` | **yes** (imports JSON seeds) | no | no | First-time setup only. |
| `npm run db:reset` | **yes** (deletes the DB) | no | no | Manual reset only. |
| `npm run db:verify` | no (read-only) | no | no | Schema/integrity audit. |
| `npm run profiles:verify` | no (read-only) | no | no | Extension store-profile audit. |
| `npm run test:smoke` | no (in-memory DB) | no (random port) | yes | Backend + admin UI smoke. |
| `npm run test:smoke:extension` | no (in-memory DB) | **yes** (binds 4123) | yes | Extension smoke on the local React checkout. |
| `npm run verify:build` | no | no | no | Build + type check. |
| `npm run verify:unit` | no | no | no | Unit tests, single run. |
| `npm run verify:data` | no | no | no | DB schema + profiles audit. |
| `npm run verify:smoke` | no | no (random port) | yes | Backend + admin UI smoke. |
| `npm run verify:extension` | no | **yes** | yes | Extension smoke on the local React checkout. |
| `npm run verify:local` | no | no | yes | Full local non-mutating verification. |

`verify:local` deliberately omits extension smoke because that suite binds port 4123 and conflicts with a running `npm run start:server`. Run `npm run verify:extension` separately when no other process holds 4123.

There is no `verify:all` alias. The `db:init` / `db:bootstrap` / `db:reset` CLIs are intentionally excluded from every `verify:*` alias because they mutate or delete the configured local database.

---

## Unit tests (`npm test`)

Vitest runs every spec under `src/`, `extension/`, and `server/` that ends in `.test.ts`. Tests are pure — no SQLite, no network, no Playwright. They cover the coupon engine, profile selectors, the in-DOM checkout scanner, and backend helpers.

- `npm test` runs in watch mode; press `q` to quit.
- `npm test -- --run` runs once and exits (used by `verify:unit` and CI).

Failures are unit-level and self-contained. There is no DB or port dependency.

---

## Build and type checks (`verify:build`)

`npm run verify:build` runs three stages:

1. `npx tsc -b` — full project TypeScript build, including server and extension references.
2. `npm run build:server` — esbuild bundles `server/main.ts` → `server/server.js`.
3. `npm run build:extension` — esbuild bundles the content script, popup, and background worker into `extension/*.js`.

These commands write build artifacts under `server/` and `extension/`. The extension bundle (`extension/contentScript.js`) is intentionally tracked so reviewers can read the shipped code; the server bundles (`server/*.js`) are gitignored. None of the build commands touch SQLite.

If you commit unintended diff in `extension/contentScript.js`, run `npm run build:extension` once and commit the regenerated bundle, or `git restore extension/contentScript.js` if the change is unrelated.

---

## Database verification (`db:verify`)

`npm run db:verify` runs the read-only `db-verify-cli` against the configured database (`SALVARE_DB_PATH`, default `server/salvare.db`). Checks:

- `tables_present`, `schema_version`, `foreign_keys`, `indexes_present`
- `coupon_codes_orphans`, `coupon_results_orphans`
- Warning-only: `duplicate_coupon_results`

The CLI never inserts, updates, or deletes user data. It exits non-zero on any FAIL and zero when only warnings are present.

**Prerequisite:** the configured DB must exist. On a fresh checkout run `npm run db:init && npm run db:bootstrap` once before `db:verify`. After that, `db:verify` is safe to run as often as you like.

The output never includes coupon codes, result records, the database path, request headers, the admin token, or environment variables.

---

## Profile verification (`profiles:verify`)

`npm run profiles:verify` is a read-only check on `extension/storeProfiles.ts` plus the local fixture pages under `public/fixtures/`. It does not open SQLite and does not need a running backend. Checks include:

- Structural validation of every profile entry (hostname patterns, required selector keys).
- Selector uniqueness (no duplicate or overlapping match patterns).
- Sanity validation (selectors are non-empty, distinct from one another).
- Local-fixture compatibility: the helpers used by `extension/contentScript.ts` resolve the expected nodes on each fixture HTML page.

This is the cheapest way to confirm a profile change didn't accidentally break support detection. It is safe in CI.

---

## Backend + admin smoke tests (`verify:smoke` / `test:smoke`)

`npm run test:smoke` runs `playwright test --project=chromium` against the suites in `smoke/*.smoke.ts`:

- `smoke/api.smoke.ts` — `/coupons`, `/results`, ranking, `/admin/coupon-stats`.
- `smoke/admin.smoke.ts` — admin UI add/update/delete + cross-check via `/coupons`.
- `smoke/auth.smoke.ts` — token-mode 401s, protected vs unprotected endpoints.

Each test boots its own server via `createSalvareServer` on `127.0.0.1` with an OS-assigned port and an in-memory SQLite database. **`server/salvare.db` is never opened or modified.** No external services are contacted.

Prerequisite: `npx playwright install chromium` (one-time).

The smoke run can hold a temporary `smoke/salvare.db` artifact; it is gitignored and may be deleted between runs.

---

## Extension smoke tests (`verify:extension` / `test:smoke:extension`)

`npm run test:smoke:extension` rebuilds the extension and harness, then runs `playwright test --project=extension` against the suites in `smoke/extension/`. The suite drives Chromium with the unpacked Salvare extension and asserts:

- Popup readiness on the local React checkout.
- A successful "Find Best Coupon" run with a winning code, final total, and matching grand-total in the React app.
- The harness backend received at least one successful result report.
- An unsupported page surfaces the `UNSUPPORTED_FALLBACK` message.

Critical preconditions:

- **Port 4123 must be free.** The harness binds 4123 across all interfaces. If `npm run start:server` (or any other process) is already on 4123, `globalSetup` exits with a clear message — stop the other process and rerun.
- **Playwright Chromium must be installed.** Run `npx playwright install chromium` once.
- The Vite dev server is auto-spawned by Playwright at `http://localhost:5173`.

Extension smoke is intentionally excluded from CI. It is reliable on a known developer machine but flaky in headless CI runners that do not load extensions consistently.

---

## Verify aliases — when to use which

- **Working on backend code:** `npm run verify:build && npm run verify:unit && npm run verify:smoke`.
- **Working on extension code:** `npm run verify:build && npm run verify:unit`, then `npm run verify:extension` once 4123 is free.
- **Working on store profiles or fixtures:** `npm run verify:data`. Add `npm run verify:extension` if you can spare port 4123.
- **Pre-merge confidence on local dev machine:** `npm run verify:local`, plus `npm run verify:extension` if you want extension coverage.
- **CI:** see [`/.github/workflows/ci.yml`](../.github/workflows/ci.yml). Runs `verify:unit`, `npx tsc -b`, the two build commands, and `profiles:verify`. No browser smoke.

`verify:data` runs `db:verify` first, which requires the configured database to exist. If you have not bootstrapped, run `npm run db:init && npm run db:bootstrap` once before invoking `verify:data` or `verify:local`.

---

## Common failures and fixes

### `npm run db:verify` fails with `tables_present`/`schema_version`
The configured DB is missing or empty. Run `npm run db:init && npm run db:bootstrap` once, then retry. If the DB exists but verification still fails, you may have an older schema — back up first (`npm run db:backup`) and re-bootstrap or `npm run db:reset` (destructive).

### `npm run test:smoke` reports a missing browser
Playwright's Chromium is not installed. Run `npx playwright install chromium` and retry. The same applies to `test:smoke:extension`.

### `npm run test:smoke:extension` errors with `port 4123 already in use`
Another process holds 4123. Stop your local backend (`npm run start:server`) or any other listener, then retry. The harness deliberately refuses to auto-kill existing processes.

### `npm run profiles:verify` reports a fixture mismatch
The local fixture HTML and `extension/storeProfiles.ts` selectors disagree. Either update the fixture under `public/fixtures/` to match the production page shape, or fix the profile selector. Both are read-only changes; no DB action required.

### `npm test` cannot find a module from the extension bundle
You changed an extension source file but have not rebuilt. Run `npm run build:extension` (or `npm run verify:build`) and retry. Vitest specs import the TypeScript sources directly, so a rebuild is rarely required for unit tests — but smoke harnesses and extension scripts read bundled JS.

### TypeScript build fails after editing `server/*.ts`
Run `npx tsc -b --clean && npx tsc -b` to flush stale incremental state. If type errors persist, they are real — fix the source.

### `git status` shows generated build files
`server/server.js`, `server/db-*-cli.js`, `server/profiles-verify-cli.js`, `extension/popup.js`, `extension/background.js`, and `smoke/extension-server-harness.js` are esbuild outputs and are gitignored. `extension/contentScript.js` is the one tracked extension bundle. If gitignored files appear in `git status`, confirm `.gitignore` covers them and run `git status --ignored` to debug.

### Local SQLite files appear in `git status`
`server/salvare.db`, `smoke/salvare.db`, `server/backups/`, and `server/exports/` are gitignored runtime artifacts. Never commit them. If they appear tracked, restore the entry in `.gitignore`.
