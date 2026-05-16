# Salvare Source Provider Research — v0.31.0

> **v0.48.0 status (2026-05-16):** Provider **activation framework.** The
> split registry gating (`ProviderCapabilities` + `descriptor.userExposed`)
> is unified into one six-field `ProviderActivation`
> (`enabled`/`previewEnabled`/`importEnabled`/`userExposed`/`cacheSupported`/`schedulerSupported`;
> `preview → previewEnabled`, `importSupported → importEnabled`). A master
> `enabled` gate is enforced fail-closed in `resolveProvider` via the new
> pure `classifyActivation(activation|null, purpose)` —
> precedence `unknown_provider` > `provider_disabled` > `not_user_exposed`
> > `capability_unsupported` (`provider_disabled` added to
> `ResolveDenyReason`; echoed directly by the preview/import routes, the
> `SAFE_REASONS` adapter-error-code sets untouched). Both providers ship
> `enabled:true` so behavior is **byte-identical to v0.47** — the disabled
> path is test-double only; `schedulerSupported` is declared-only (false,
> no consumer/enforcement, v0.52). Flags stay compile-time constants (no
> env/DB/runtime toggling, schema stays `"5"`). `GET
> /admin/source-providers` now carries a nested `activation` **5-field
> subset** (`userExposed` stays the filter gate, never echoed) plus a new
> **read-only** "Provider activation" admin.html section. Impact stays
> hidden (`importEnabled:false`/`userExposed:false`), denied on
> preview+import exactly as v0.47 (v0.49 will expose it).
>
> **v0.47.0 status (2026-05-16):** Generic provider **pipeline execution
> layer.** The structurally-identical Awin (v0.32/v0.33) and Impact
> (v0.42) adapters are gutted to thin spec builders that delegate one
> shared `runProviderPipeline`
> ([`server/source-provider-pipeline.ts`](../server/source-provider-pipeline.ts)),
> extracted **verbatim** from the live Awin adapter so observable
> behavior is byte-identical. The pipeline runs the shared phases in
> fixed order: config/key/`validateDomain` gate (early returns keep
> `durationMs:0`/`fetched:false`/`cacheHit:false`) → runtime
> `ensureCouponSource` → cache-read short-circuit **gated on
> `spec.cacheSupported`** → `spec.buildUrl` + `Bearer` header → fetch
> (`AbortError → timeout`, else `fetch_error`) → `mapHttpStatus` →
> `JSON.parse` → `spec.extractEnvelope` → per-row `spec.mapRow`
> (`skip`/`error`/`row`) → shared `pickAllowedRow` + `buildCandidate` →
> one `recordSourceFetchAttempt` per fail/success path (same call
> sites/counts as v0.46) → `upsertSourceCacheEntry` once on success.
> Provider divergence is isolated to the injected `ProviderPipelineSpec`
> (`config`, `buildUrl`, `extractEnvelope`, `mapRow`, `cacheSupported`);
> per-provider deny-field redaction stays inside each `mapRow`. **Impact
> reaches internal capability parity** — same cache-read short-circuit
> (registry `cacheSupported: false → true`) and a `cacheHit` result
> field — while staying registry-internal: `importSupported:false` /
> `userExposed:false` unchanged, so `resolveProvider` still denies Impact
> on preview+import (`not_user_exposed`) exactly as v0.45/v0.46. The
> error-code unions are unified into one shared
> `ProviderAdapterErrorCode` (`Awin`/`ImpactAdapterErrorCode` retained as
> aliases — a type-only widening; `source-refresh.ts` `SAFE_REASONS`
> untouched); the two identical status helpers fold into one shared
> `providerStatusFromConfig`. Parity is locked by characterization pins
> captured **pre-refactor** (Awin cache-fresh-hit, Awin cache-miss full
> fetch, Awin `disabled`/`missing_api_key`/`parse_error` early returns,
> Impact golden full-result) that stay green **unchanged** through the
> rewrite, plus pipeline contract tests and a new Impact cache-read
> parity suite. **Still out of scope:** Impact user exposure / import
> wiring (v0.48/v0.49), schema bump (stays `"5"`), route-handler
> changes, new providers, scraping, live HTTP in tests.
>
> **v0.46.0 status (2026-05-16):** **Generic provider import history /
> audit trail.** New append-only `import_history` table
> (`EXPECTED_SCHEMA_VERSION 4 → 5`; `CREATE TABLE IF NOT EXISTS` on next
> boot, no migration array, starts empty, `db:bootstrap` never writes it)
> records one redacted row per **real** import attempt — i.e. one that
> passed auth **and** registry provider resolution. Redacted by
> construction: columns are `provider_id` (always the registry-resolved
> `descriptor.providerId`, never the client/path segment), nullable
> `source_id` (`REFERENCES coupon_sources(id) ON DELETE RESTRICT`; NULL
> for resolved-but-failed attempts where the adapter has not registered
> the parent row), `domain`, `attempted_at`, `outcome`
> (`ok`/`empty`/`error`), counter set, `error_code` (allowlisted short
> token — the identical classifier the response builder emits, never a
> raw exception string), `duration_ms`. No body/header/credential/token/
> URL/free-text columns exist. Writer `recordProviderImportAttempt`
> ([`server/db-source-import.ts`](../server/db-source-import.ts)) mirrors
> `recordSourceFetchAttempt` validation/allowlisting; called exactly once
> per post-resolution branch (closure-throw, adapter-not-ok, success).
> **Resolver-denied / unknown-provider / not_user_exposed /
> capability_unsupported / invalid-body / unauthorized → zero rows**
> (denials are not real attempts; impact stays hidden). Existing import
> response bodies are byte-identical to v0.45. `db-verify` adds the
> table, both indexes, and a NULL-aware orphan check. Read-only
> `GET /admin/import-history`
> ([`server/admin-import-history-routes.ts`](../server/admin-import-history-routes.ts))
> — protected, no mutation verb, allowlisted projection, `attempted_at
> DESC` capped 500 + `truncated`, optional registry-validated `provider`
> + ISO `from`/`to` filters (unknown/invalid fail closed). Minimal
> read-only admin UI section. **Still out of scope:** retention /
> pruning / export of history, history mutation / delete endpoint, any
> import-behavior or response-shape change, scraping / new providers,
> impact user exposure, extension / `/coupons` / export-import JSON /
> ranking / further-schema changes.
>
> **v0.45.0 status (2026-05-16):** **Generic provider preview/import
> routing.** The Awin-pinned preview/import routes are replaced by
> parameterised `POST /admin/source-preview/:providerId` and
> `POST /admin/source-import/:providerId`, resolving the provider through a
> new registry method `resolveProvider(providerId, purpose, deps)`. A
> generic `ProviderAdapter` contract ([`server/source-provider-types.ts`](../server/source-provider-types.ts))
> is extracted from the identical Awin/Impact shapes (compile-time
> assignability assertions; zero adapter behavior change). The provider-id
> path segment is charset-validated (`^[a-z0-9-]{1,32}$`) before any echo;
> illegal/oversize → `HTTP 400 {ok:false,error:"invalid provider"}` with a
> fixed literal. Resolver is fail-closed (never throws raw): unknown →
> `unknown_provider`; registry-internal (`userExposed!==true`) →
> `not_user_exposed`; missing capability → `capability_unsupported`; deny
> returns the v0.44 disabled-envelope shape at HTTP 200 with no
> `disabled:true`. **impact stays unreachable on the user surface** —
> `userExposed:false` denies it for BOTH preview and import
> (`not_user_exposed`), and `importSupported:false` is an additional gate.
> The import route is fully decoupled from the old
> `AWIN_SOURCE_ID`/`AWIN_SOURCE_NAME` constants: the candidate filter and
> `importProviderCandidates` args are driven from the resolved registry
> descriptor (`sourceId`/`displayName`/`sourceType`), never a constant or
> client value. `awin` response bodies are byte-identical to v0.44;
> `source_fetch_log` still records the adapter's own `source_id`-keyed row.
> `server/index.ts` swaps the single injected `awinPreview` for a
> registry-driven resolver, preserving only the `awin` test-override seam.
> **Still out of scope (v0.46.0+):** no new audit/import-history table, no
> import history view, no multi-provider admin chrome/badges, no impact
> user exposure, no scraping/new providers, no automatic import/apply, no
> scheduler, no extension/`/coupons`/export/import JSON/ranking/DB-schema
> changes, no live HTTP in tests.
>
> **v0.44.0 status (2026-05-15):** Registry-backed **admin provider
> selector** added. New protected read-only endpoint
> `GET /admin/source-providers`
> ([`server/admin-source-providers-routes.ts`](../server/admin-source-providers-routes.ts))
> filters `createProviderRegistry().list()` to `userExposed === true` and
> returns an allowlisted `{ providers: [{ providerId, displayName,
> sourceId, sourceType, capabilities: { preview, importSupported,
> cacheSupported } }] }`. `userExposed` is the gate, not a returned field;
> `featureEnabled` / `configured` remain only on `/admin/source-status`.
> The admin UI replaces the static `Provider: Awin` label with a
> registry-populated `<select>` + capability line, defaulting to Awin,
> capability-gating the Import button on `importSupported`, and enforcing a
> **hard client-side id allowlist** (`["awin"]`) plus an embedded
> Awin-only fallback so a tampered list response cannot surface
> **impact** or any arbitrary id. **impact stays registry-internal**
> (`userExposed: false`) — it is absent from the endpoint response, the
> admin selector, and the admin HTML source (no `impact` literal). Awin
> preview/import paths, request bodies, server-side `IMPORT` confirmation,
> and `/admin/source-status` shape are byte-compatible with v0.43.
> **Still out of scope:** impact admin exposure / import, generic public
> provider endpoint, source-refresh CLI multi-provider support, automatic
> import / apply, scheduler / background refresh, source edit / delete,
> live provider calls in tests, extension behaviour changes, `/coupons` /
> export / import JSON shape changes, ranking / winner-selection changes,
> `coupon_results` writes, and DB schema changes.
>
> **v0.43.0 status (2026-05-15):** Internal **provider registry** added
> ([`server/source-provider-registry.ts`](../server/source-provider-registry.ts)).
> Centralises descriptor metadata, safe status accessors, and typed preview
> factories for the two registered providers (awin + impact). Each
> descriptor carries explicit capability flags
> (`preview` / `importSupported` / `cacheSupported`) plus a `userExposed`
> boolean so future milestones can flip the admin/CLI gate per provider
> without rewriting dispatch. v0.43 keeps **awin** fully user-exposed
> (admin preview + admin import + source-refresh CLI + status dashboard
> unchanged) and **impact registry-internal**: `importSupported: false`
> and `userExposed: false` keep impact out of the admin URL allowlist, the
> source-refresh CLI provider allowlist, and the admin UI. Registry
> metadata is static strings + capability booleans only; status accessors
> return `{ featureEnabled, configured }` booleans derived from the
> existing `readAwinConfig` / `readImpactConfig` readers — env values,
> API keys, account SIDs, the `Authorization` header, the DB path, raw
> payloads, raw HTML, affiliate / tracking / payout fields, and stack
> traces never appear in any registry-exported surface. Unknown provider
> ids fail closed (`get()` → `null`, `statusFor()` →
> `{ featureEnabled: false, configured: false }`). `server/index.ts` now
> derives its default `awinPreview` and `providerStatus` callbacks from
> the registry, so byte-compatible Awin behaviour is preserved while a
> single registration point governs both providers. **Still out of
> scope:** admin provider selector / dropdown, admin preview / import
> route for impact, source-refresh CLI multi-provider support,
> automatic import / apply, scheduler / background refresh, live
> provider calls in tests, extension behaviour changes, `/coupons` /
> export / import JSON shape changes, ranking / winner-selection
> changes, `coupon_results` writes, and DB schema changes.
>
> **v0.42.0 status (2026-05-15):** Second mocked **provider adapter spike**
> added for **impact.com** Promotions API. New module
> [`server/source-provider-impact.ts`](../server/source-provider-impact.ts)
> mirrors the v0.32 Awin module layout: an injected fetcher (no live HTTP
> in tests or CI), env gating via independent `readImpactConfig` in
> [`server/source-provider-config.ts`](../server/source-provider-config.ts)
> (`SALVARE_IMPACT_ENABLED` literal `"true"` plus a non-blank
> `SALVARE_IMPACT_API_KEY`; optional `SALVARE_IMPACT_ACCOUNT_SID`; missing or
> blank values fail closed), promo-code-only `PromotionType` filter,
> runtime-only `coupon_sources` registration (not seeded into bootstrap),
> per-attempt `source_fetch_log` write, and on-success `source_cache` write
> with `body_sha256` and allowlisted `{ offer_count, error_count }` metadata
> only. Affiliate / tracking / deep-link / partner-id / advertiser-id /
> account-sid / payout / commission-rate fields (including `EarningsPerClick`,
> `ClickUrl`, `AuthToken`, and case variants) are stripped before any
> candidate is returned, and dedicated redaction assertions confirm the API
> key, the account SID, `Authorization`, `Bearer`, raw response bodies, and
> denied field names never appear in results, errors, fetch-log rows, cache
> metadata, or `candidates_json`. Fixtures
> ([`server/fixtures/impact-offers-ok.json`](../server/fixtures/impact-offers-ok.json),
> [`server/fixtures/impact-offers-edge-cases.json`](../server/fixtures/impact-offers-edge-cases.json),
> [`server/fixtures/impact-offers-malformed.json`](../server/fixtures/impact-offers-malformed.json))
> are explicitly **contract-style**; values are obviously fake (no real
> account IDs, no real partner IDs, no real tracking URLs, no real API
> keys). The real impact.com API authenticates via HTTP Basic with
> `<accountSid>:<authToken>`; v0.42 uses a `Bearer` header to keep
> redaction assertions parallel to the existing Awin surface, and **live
> activation must reconcile the auth scheme, credential format, pagination,
> response envelope (`Promotions` casing), and field shape against
> developer.impact.com before the feature flag is set to `true` in any
> environment other than local development with mocked HTTP**. Cache-read
> short-circuit is **deferred** to a later generic provider-registry
> milestone to avoid duplicating Awin-specific TTL logic. **Still out of
> scope:** admin preview/import wiring for impact, source-refresh CLI
> multi-provider support, generic provider registry, admin UI provider
> selector, automatic import/apply, scheduler / automatic refresh, scraping,
> extension behavior changes, `/coupons` / export / import JSON shape
> changes, ranking / winner-selection changes, `coupon_results` writes, DB
> schema changes, and any live HTTP in tests. The §4 terms / safety
> checklist below must still be completed (per-provider) before live
> activation.
>
> **v0.41.0 status (2026-05-14):** Awin parser **fixture hardening** added.
> Two new contract-style fixtures — `server/fixtures/awin-offers-realistic-contract.json`
> and `server/fixtures/awin-offers-edge-cases.json` — cover the full realistic
> Awin Offers API field set (with all affiliate/payout/tracking fields present
> for stripping validation), plus edge cases: duplicate same-domain codes,
> same code on different domains, null code, missing optional fields, `type` /
> `voucherCode` / `validTo` / `description` field aliases, bare-hostname
> domain, and unknown promotion types. New parser tests confirm voucher/code
> offers parse correctly, non-code offers are silently dropped, duplicates
> dedupe deterministically, optional-field absence does not break valid rows,
> malformed rows produce safe per-row errors, and affiliate/tracking/payout
> fields never appear in candidates or errors. **Live Awin response validation
> is still pending** — no publisher account has been used; both fixtures are
> explicitly marked contract-style and must be reconciled against a real
> response once account access is available. No behavior changes in this
> milestone: no new endpoints, no admin UI changes, no import/refresh/cache
> changes, no extension or ranking changes.

> **v0.40.0 status (2026-05-14):** Read-only admin **source freshness /
> status dashboard** added. New SELECT-only helper
> [`server/db-source-status.ts`](../server/db-source-status.ts) and protected
> route [`server/admin-source-status-routes.ts`](../server/admin-source-status-routes.ts)
> expose `GET /admin/source-status`, which aggregates `coupon_sources`,
> `source_cache`, and `source_fetch_log` into one row per source with
> allowlisted fields only: `sourceId`, `sourceName`, `sourceType`, `enabled`,
> `providerFeatureEnabled`, `providerConfigured`, `lastFetchAt`,
> `lastFetchOutcome`, `lastSafeError`, `cacheEntries`, `freshCacheEntries`,
> `staleCacheEntries`, `cachedCandidateCount`, `newestCacheAt`, and
> `nextAllowedFetchAt`. The handler executes zero writes (helper is SELECT-only,
> no provider fetcher, no importer, no refresh runner). Provider feature-flag
> and configured booleans are derived from `readAwinConfig(process.env)` at
> request time for the `awin` source; env values, the API key,
> `Authorization`, cookies, `localStorage`, DB paths, raw payloads, raw HTML,
> stack traces, `body_sha256`, `metadata_json`, candidate arrays, source URLs,
> and affiliate / tracking fields are never returned. `lastFetchOutcome` and
> `lastSafeError` are re-validated against the existing fetch-log outcome
> allowlist and short-error-code pattern. `cachedCandidateCount` reads only
> `JSON.parse(candidates_json).length` per cache row (32 KB write cap from
> v0.33) and corrupt or oversized rows contribute zero without throwing. A
> small **Source status** admin UI section calls the route via the existing
> `authHeaders()` helper and renders one row per source through `textContent`
> with a **Load status** button (intentionally not "Refresh source") so it is
> visually distinct from the v0.34/v0.36 preview/import sections. **Still
> out of scope:** scheduler / automatic refresh, second provider, scraping,
> extension behavior changes, `/coupons` / export / import JSON shape
> changes, ranking / winner-selection changes, `coupon_results` writes, DB
> schema changes, provider fetch calls, and source refresh/import/edit/delete
> controls in this section.
>
> **v0.39.0 status (2026-05-14):** Manual source-refresh CLI added for the
> mocked, feature-flagged Awin provider. New entrypoint
> [`server/source-refresh-cli.ts`](../server/source-refresh-cli.ts) (pure
> runner in [`server/source-refresh.ts`](../server/source-refresh.ts)) lets a
> developer preview candidates from the shell and (with `--import` plus an
> exact `--confirm IMPORT`) trigger the same additive importer used by the
> v0.36 admin route. Preview is the default and writes no `coupon_codes` or
> `coupon_results`. The CLI reuses `readAwinConfig`, `createAwinAdapter`, and
> `importProviderCandidates`; unknown provider, invalid domain, missing/wrong
> confirm, and disabled/missing config all fail closed with non-zero exit
> and an allowlisted reason. Output is the same admin-route allowlist —
> never the API key, `Authorization`, env vars, the DB path, raw payloads,
> raw HTML, affiliate/tracking fields, or stack traces. The fetcher is
> injectable; tests run entirely against committed fixtures with zero live
> HTTP. **Still out of scope:** scheduler / automatic refresh, second
> provider, scraping, extension behavior changes, `/coupons` / export /
> import JSON shape changes, ranking / winner-selection changes,
> `coupon_results` writes, and DB schema changes.
>
> **v0.32.0 status (2026-05-11):** A mocked, feature-flagged Awin Offers API
> adapter spike landed in [`server/source-provider-awin.ts`](../server/source-provider-awin.ts)
> and [`server/source-provider-config.ts`](../server/source-provider-config.ts).
> The adapter is disabled by default, requires `SALVARE_SOURCE_PROVIDER_ENABLED=true`
> plus a non-blank `SALVARE_AWIN_API_KEY` to activate, takes an injected
> `fetcher` (no live HTTP from CI), strips affiliate/tracking fields before
> emitting candidates, registers the `awin` row in `coupon_sources` only at
> runtime (not in bootstrap), and writes only fetch-log + cache rows on each
> attempt. The exact response shape used by the parser is the documented
> sketch in §5.5 and is `[needs verification]` against developer.awin.com
> once a publisher account exists; a regression fixture from a real call
> should be added at that time.
>
> **v0.33.0 status (2026-05-11):** Cache-read short-circuit added. The Awin
> adapter now consults `getSourceCacheEntry` after the config + key checks
> and before invoking the fetcher: if the row is fresh, has `status='ok'`,
> and the new `candidates_json` column round-trips through strict
> per-row revalidation, the adapter returns those candidates with
> `cacheHit:true`, `fetched:false`, `outcome:'cache_hit'` and writes a
> single `cache_hit` row to `source_fetch_log`. Stale, missing, corrupt, or
> tamper-evident cache rows fall through to a fresh fetch. The schema bump
> 3→4 added only the additive `source_cache.candidates_json TEXT` column
> (idempotent in-place ALTER); no other surface changed. Still no live
> Awin calls in tests, no automatic import/apply, no source endpoint, no
> admin UI, no extension changes. Live activation outside local
> development still requires the §4 terms checklist.
>
> **v0.34.0 status (2026-05-11):** Admin-protected source-preview boundary
> added at `POST /admin/source-preview/awin`
> ([`server/admin-source-preview-routes.ts`](../server/admin-source-preview-routes.ts)).
> The route is preview-only: it calls the mocked, feature-flagged Awin
> adapter through an injectable preview function, rebuilds candidates from
> an explicit allowlist, and writes nothing to `coupon_codes` or
> `coupon_results`. Allowed writes are still only the adapter's existing
> `source_fetch_log`, `source_cache`, and runtime `coupon_sources`
> registration. Disabled-by-default behavior is unchanged; live Awin
> activation still depends on completing the §4 terms/safety checklist
> below, a verified publisher account, and per-merchant program approval.
> No admin UI controls, no automatic import/apply, no extension behavior
> changes, no `/coupons` response changes, no export/import shape changes,
> no ranking changes, no schema changes, and no live HTTP in tests.
>
> **v0.36.0 status (2026-05-12):** Admin Awin **preview → confirm → import**
> flow added. New admin-protected `POST /admin/source-import/awin`
> ([`server/admin-source-import-routes.ts`](../server/admin-source-import-routes.ts))
> requires body `{ "domain", "confirm": "IMPORT" }`, re-derives candidates
> server-side via the same injectable Awin preview function used by the
> v0.34 route (cache-preferred via v0.33), and never trusts client-posted
> candidate arrays for DB writes. Server-side it drops candidates whose
> `sourceId !== "awin"` or whose `domain` differs from the request domain,
> dedupes by code, then calls a new additive writer
> ([`server/db-source-import.ts`](../server/db-source-import.ts)) that
> upserts the `stores` row without deleting existing codes, `INSERT`s only
> missing `coupon_codes` rows, and records `coupon_code_sources` rows with
> `source_id="awin"` idempotently. Re-import is a no-op
> (`codesImported`/`provenanceRecorded` both drop to zero). `coupon_results`
> is never read or written. The admin UI gains an **Import previewed
> candidates** button gated by the prior preview returning candidates and
> an exact `IMPORT` confirmation phrase (server still validates). Response
> shape is allowlisted (`provider`, `domain`, `candidatesAccepted`,
> `codesImported`, `provenanceRecorded`, `rejected`, `errors`) and never
> echoes the API key, `Authorization`, env vars, the DB path, raw payloads,
> raw HTML, stack traces, or affiliate/tracking fields. Provider remains
> disabled by default; live activation outside local development still
> requires the §4 terms/safety checklist below, a verified publisher
> account, and per-merchant program approval. **Still out of scope:**
> automatic checkout testing, automatic apply, extension behavior changes,
> ranking/test-order changes, public `/coupons` shape changes, export/import
> JSON shape changes, DB schema changes, and any live HTTP in tests.
>
> **v0.35.0 status (2026-05-12):** Admin UI control added for the v0.34
> source-preview route. The admin shell
> ([`server/admin.html`](../server/admin.html)) now renders a minimal
> **Source preview** section (provider label `Awin`, domain input, Preview
> button, status/candidates/errors containers) that POSTs to the existing
> `/admin/source-preview/awin` route using the same `authHeaders()` helper
> as the rest of the admin page. Rendering is allowlisted client-side
> (`sourceId`, `domain`, `code`, `label`, `expiresAt`, `confidence` plus
> `provider`/`cacheHit`/`fetched`/`candidateCount` summary); the admin
> token, `Authorization`, env var values, raw payloads, raw HTML, stack
> traces, and affiliate/tracking fields are never read off the response and
> cannot reach the DOM. Disabled / missing-key responses render plain
> English messages — the env var name `SALVARE_AWIN_API_KEY` may be
> mentioned, never its value. **Still preview-only:** no Import or Apply
> button, no writes to `coupon_codes` or `coupon_results`, no extension
> behavior changes, no `/coupons` response changes, no export/import shape
> changes, no ranking changes, no schema changes, and no live HTTP in tests.
> Smoke checks assert control visibility only; they never depend on the
> provider being enabled or on any API key being configured.


This document evaluates candidate coupon source providers, APIs, and feeds for Salvare's first real trusted source integration. It is research-only: no adapter, no network fetching, no API keys, and no schema changes are introduced in this milestone. The recommendation here informs v0.32.0 implementation work.

All details marked **[needs verification]** are based on public documentation and general knowledge of the provider as of the research date (2026-05-11). Provider terms, pricing, API schemas, and approval processes change — verify from official sources before any implementation begins.

This document must be read alongside [`docs/SOURCE_POLICY.md`](SOURCE_POLICY.md). Any integration work in v0.32.0+ must comply with that policy in full before a line of code is written.

---

## 1. Scope and methodology

### What this doc covers

- Nine candidate providers evaluated against Salvare's source policy and architectural constraints.
- A primary recommendation and backup for v0.32.0 prototyping.
- A terms and safety checklist to complete before enabling any live integration.
- An implementation preview describing the intended v0.32.0 integration shape.

### Evaluation criteria

For each provider:

1. **Type** — API, feed, affiliate network, aggregator, partner platform.
2. **Access requirements** — account approval, API key, commercial relationship.
3. **Data shape** — which fields are available and how they map to `SourceAdapterCandidate`.
4. **Policy fit** — alignment with `SOURCE_POLICY.md` §4 allowed source types.
5. **Risks and unknowns** — what must be verified before implementation.
6. **v0.32.0 candidate?** — primary / backup / lower-priority / no.

### What Salvare needs from a provider

- Coupon codes (not just affiliate links) queryable by merchant domain.
- Documented API or structured feed with clear permitted-use terms.
- Response fields mappable to `SourceAdapterCandidate`: `domain`, `code`, `label`, `expiresAt`, `sourceUrl`, `confidence`.
- Rate limits, caching TTLs, and kill-switch compatibility (source_cache / source_fetch_log).
- Terms that explicitly permit programmatic candidate fetching for local automated checkout testing.

---

## 2. Provider evaluations

### 2.1 FMTC

**Type:** Coupon data aggregator — commercial REST API

FMTC (For Me To Coupon) is a B2B coupon data provider that aggregates merchant coupon codes from multiple affiliate networks and normalizes them into a queryable feed. Their product is designed specifically for coupon comparison and testing tools — Salvare's use case.

**Access requirements:**
- Commercial API subscription required. Pricing is not publicly listed — contact FMTC sales. **[needs verification]**
- API key issued after account setup.
- No per-merchant approval required; data covers FMTC's aggregated merchant network.
- Contact and account creation at fmtc.co.

**Data shape (field names and response format need verification from current FMTC API docs):**

| Provider field | SourceAdapterCandidate field | Notes |
|---|---|---|
| Merchant domain / URL | `domain` | May need hostname extraction |
| Coupon code | `code` | |
| Description / title | `label` | |
| End / expiry date | `expiresAt` | |
| FMTC offer URL | `sourceUrl` | Not tracking link |
| — | `confidence` | Not provided; Salvare assigns default |

**Policy fit:** `SOURCE_POLICY.md` §4 "Official APIs" or "Licensed or partner feeds" — fits if the commercial agreement explicitly authorizes automated candidate ingestion and checkout testing (not just display/referral). Verify terms before implementation.

**Risks and unknowns:**
- Commercial pricing is opaque — may be cost-prohibitive for a local/portfolio project.
- Terms must confirm that applying fetched codes on a real checkout is permitted, not just displaying them for referral.
- Affiliate network source metadata in the response (affiliate link, network attribution) must be discarded before any candidate reaches winner selection.
- Domain resolution: FMTC may identify merchants by name or ID rather than canonical domain — normalization step needed. **[needs verification]**
- API versioning, rate limits, and response pagination need verification from current FMTC docs.

**v0.32.0 candidate?** **Backup / alternative.** Purpose-built for this use case and best data quality, but the commercial subscription barrier makes Awin a lower-friction first prototype.

---

### 2.2 LinkMyDeals

**Type:** Coupon and deal feed aggregator — publisher platform

LinkMyDeals provides curated deal and coupon data to publishers and comparison sites via API and structured feeds.

**Access requirements:**
- Publisher account application required. Approval criteria (minimum traffic, audience size) not publicly documented. **[needs verification]**
- API key issued after approval.
- Direct contact likely required for API access details.

**Data shape (needs verification from current LinkMyDeals publisher docs):**

| Provider field | SourceAdapterCandidate field | Notes |
|---|---|---|
| Merchant website URL | `domain` | Hostname extraction needed |
| Coupon code | `code` | May be absent for non-code deals |
| Title / description | `label` | |
| End date | `expiresAt` | |
| Offer URL | `sourceUrl` | Not tracking link |
| — | `confidence` | Not provided; Salvare assigns default |

**Policy fit:** §4 "Official APIs" or "Licensed or partner feeds" — fits if terms permit automated candidate fetching.

**Risks and unknowns:**
- US merchant coverage is unclear; the platform appears EU/UK-heavy. **[needs verification]**
- Not all deals include a coupon code — Salvare needs code-type filtering.
- API endpoint, authentication scheme, and field names need verification from current docs.
- Publisher approval process and access timeline are opaque.
- Terms must explicitly permit automated checkout testing.

**v0.32.0 candidate?** Lower priority — market coverage and publisher access terms need verification before committing to this provider.

---

### 2.3 CouponAPI.org

**Type:** Third-party coupon REST API

CouponAPI.org provides a simple REST API for querying coupon codes by merchant or domain.

**Access requirements:**
- API key registration. May be self-service or by request — process needs verification. **[needs verification]**
- May have a free tier with rate limits. **[needs verification]**

**Data shape (needs verification from current CouponAPI.org docs):**

| Provider field | SourceAdapterCandidate field | Notes |
|---|---|---|
| Store / domain identifier | `domain` | May need normalization |
| Coupon code | `code` | |
| Description | `label` | |
| Expiry date | `expiresAt` | |
| Offer URL | `sourceUrl` | If available |
| — | `confidence` | Not provided; Salvare assigns default |

**Policy fit:** §4 "Official APIs" — fits if terms permit programmatic candidate ingestion.

**Risks and unknowns:**
- Provider size, reliability, and long-term maintenance status are unclear.
- Data quality, deduplication, and coverage breadth are unverified.
- API stability, versioning, and active development status need verification.
- Terms of use need careful review — particularly around automated checkout application.
- Smaller operator compared to major affiliate network APIs.

**v0.32.0 candidate?** Lower priority — reliability and terms need verification; smaller network than major affiliate providers.

---

### 2.4 Rakuten Advertising Coupon Feed API

**Type:** Affiliate network — coupon feed / promotional data

Rakuten Advertising (formerly LinkShare) is one of the largest US affiliate networks. Their publisher platform provides promotional data feeds including coupon codes for network merchants. Historically delivered as structured text/CSV feeds; API availability and format may have evolved. **[needs verification of current format]**

**Access requirements:**
- Rakuten Advertising publisher account required (application + approval at rakutenadvertising.com).
- Per-merchant "join program" approval required to access that merchant's feed data.
- Feed/API credentials issued per publisher account — free to approved publishers, no separate commercial subscription.

**Data shape (field names and format need verification from current Rakuten publisher docs):**

| Provider field | SourceAdapterCandidate field | Notes |
|---|---|---|
| Merchant URL / domain | `domain` | May require merchant ID → domain mapping |
| Coupon / promo code | `code` | |
| Description | `label` | |
| End date | `expiresAt` | |
| Offer URL | `sourceUrl` | Not tracking link |
| — | `confidence` | Not provided; Salvare assigns default |

**Policy fit:** §4 "Official APIs" or "Licensed or partner feeds" — fits if Rakuten publisher terms permit automated candidate fetching and checkout testing (not just display/referral links).

**Risks and unknowns:**
- Per-merchant join approval required — initial merchant coverage limited to approved programs.
- Domain resolution: Rakuten identifies merchants by ID; mapping to canonical domain requires a separate merchant-info query or lookup table. **[needs verification]**
- Affiliate tracking links in the feed response must be discarded before any candidate data reaches winner selection.
- Feed format (CSV vs REST API, current field names) needs verification from Rakuten's current publisher docs.
- Terms must confirm automated checkout testing is permitted.

**v0.32.0 candidate?** Backup. Large, established US network, but per-merchant approval overhead and domain resolution complexity make it a second-wave integration after Awin.

---

### 2.5 Awin Offers API

**Type:** Affiliate network — REST API

Awin (formerly Affiliate Window) is a major global affiliate network with strong UK/EU presence and growing US merchant coverage. Their Offers API returns promotions — including voucher/coupon-code type offers — from merchant programs in their network. The API is designed for programmatic consumption by publishers.

**Access requirements:**
- Awin publisher account required (apply at awin.com — application reviewed typically within a few days **[needs verification of current timeline]**).
- OAuth token or API key issued per publisher account after approval.
- Free to publishers — no separate commercial subscription required.
- Per-merchant program join required to access that merchant's offers.
- Public API documentation available at developer.awin.com (authentication required for full API reference **[verify current public access]**).

**Data shape (field names need verification from current Awin API docs at developer.awin.com):**

| Provider field | SourceAdapterCandidate field | Notes |
|---|---|---|
| `merchantUrl` hostname | `domain` | Normalize to bare hostname |
| `code` | `code` | Voucher/promo code |
| `title` or `description` | `label` | |
| `endDate` | `expiresAt` | |
| `merchantUrl` or offer URL | `sourceUrl` | Not affiliate tracking link |
| — | `confidence` | Not provided; Salvare assigns default |

Filter to `promotionType = 'voucher'` (or equivalent code-type field) before parsing rows. Non-code promotions (cashback, free delivery without code, etc.) should be excluded. **[Verify `promotionType` values and filter field from current Awin API docs]**

**Policy fit:** §4 "Official APIs" — maps directly to this category. The Offers API is designed for programmatic publisher consumption. Requires terms review to confirm automated checkout testing is permitted (not just coupon display or affiliate link referral).

**Risks and unknowns:**
- Per-merchant program join required — initial merchant coverage limited to approved programs. Build out merchant join coverage incrementally.
- US merchant coverage is smaller than Rakuten; Awin is EU-heavy. Evaluate coverage for target merchant set before committing.
- Must filter `promotionType` correctly — unfiltered results will include cashback and other non-code promotions.
- Affiliate tracking links in the response must be discarded and must not reach winner selection.
- Current auth scheme (OAuth2 vs API key token), pagination approach, rate limits, and exact field names need verification from developer.awin.com.
- Terms review: confirm automated coupon code application on a real checkout is permitted under Awin's publisher agreement, not just display or referral traffic generation.

**v0.32.0 candidate?** **Yes — primary recommendation.** Clean REST/JSON API, documented publisher program (no commercial fee), offer-type filtering, response shape maps well to `SourceAdapterCandidate`, compatible with source_cache/fetch_log architecture, and can be mocked for all tests before live account approval.

---

### 2.6 impact.com Promotions API

**Type:** Partnership management platform — REST API

impact.com (formerly Impact Radius) is a major US-focused partnership and affiliate management platform. Their API includes promotions and promo codes from managed merchant programs.

**Access requirements:**
- impact.com publisher/partner account required (application + approval at app.impact.com).
- API credentials (Account SID + auth token) issued per publisher account.
- Free to publishers; enterprise features are commercial.
- Per-merchant program join required for merchant-specific promo data.

**Data shape (needs verification from current impact.com developer docs):**

| Provider field | SourceAdapterCandidate field | Notes |
|---|---|---|
| Advertiser domain | `domain` | May need normalization |
| Promo code | `code` | May be absent for non-code promotions |
| Description / terms | `label` | |
| End date | `expiresAt` | |
| Offer URL | `sourceUrl` | Not tracking link |
| — | `confidence` | Not provided; Salvare assigns default |

**Policy fit:** §4 "Official APIs" — fits if terms permit automated candidate fetching and checkout testing.

**Risks and unknowns:**
- Per-merchant program join adds initial setup overhead.
- Promo code field availability may not be universal across all advertiser programs — needs verification.
- US-centric merchant network; weaker EU coverage.
- Terms review: confirm automated checkout testing is permitted, not just referral-link traffic.
- Current API endpoint details and field names need verification from developer.impact.com.

**v0.32.0 candidate?** Moderate — solid REST API and good US merchant coverage, but per-merchant approval overhead and terms verification make it a better second-wave integration after Awin is prototyped.

---

### 2.7 Admitad / Mitgo

**Type:** Affiliate network — API/feed

Admitad (now part of Mitgo group following a 2022 rebranding) is an affiliate network with strong presence in Europe, Russia, CIS, and Asia. They provide coupon and deal data feeds and APIs for publishers.

**Access requirements:**
- Mitgo/Admitad publisher account required (application and approval — process needs verification given the Mitgo rebranding).
- API key issued after account approval.
- Per-merchant program join required for merchant-specific coupon data.

**Data shape (field names and API endpoint need verification from current Mitgo developer docs — rebranding may have changed documentation location):**

| Provider field | SourceAdapterCandidate field | Notes |
|---|---|---|
| Store / merchant domain | `domain` | |
| Coupon code | `code` | |
| Title / description | `label` | |
| End date | `expiresAt` | |
| Offer URL | `sourceUrl` | |
| — | `confidence` | Not provided; Salvare assigns default |

**Policy fit:** §4 "Official APIs" or "Licensed or partner feeds" — fits if terms permit automated candidate ingestion.

**Risks and unknowns:**
- US merchant coverage is limited — primarily EU/Asia network.
- Mitgo rebranding creates documentation uncertainty — current API docs URL and field names need verification.
- English-language API documentation quality is unverified.
- Terms review needed for automated checkout testing use case.
- Lower-priority for US-focused merchant coverage.

**v0.32.0 candidate?** Lower priority — limited US coverage and rebranding-related documentation uncertainty. Revisit after Awin is integrated.

---

### 2.8 Sovrn Commerce

**Type:** Publisher monetization platform / affiliate ecosystem

Sovrn Commerce (formerly VigLink; acquired by Sovrn in 2018) provides link monetization and affiliate network access for publishers. Its primary product is automated conversion of outbound links into affiliate links — not a dedicated coupon/code feed.

**Access requirements:**
- Sovrn publisher account required.
- API key issued after account approval.
- Merchant data API access varies by account tier. **[needs verification]**

**Data shape:** Sovrn's primary model is link rewriting and affiliate attribution, not structured coupon-code delivery. Whether they expose a queryable coupon/promo code feed is unverified — this is the fundamental uncertainty for this provider.

**Policy fit:** Unclear — does not obviously map to any §4 category until it is confirmed that Sovrn offers a structured coupon-code API/feed (as opposed to only link monetization).

**Risks and unknowns:**
- Not primarily a coupon-code source — relevance to Salvare's use case is uncertain until a structured code feed is confirmed.
- Requires investigation to determine if a promo-code API/feed exists at all.
- Affiliate link conversion is the core product; applying that model to Salvare would require careful separation to ensure affiliate metadata never influences winner selection.

**v0.32.0 candidate?** **No.** Not primarily a coupon-code source. Requires significant investigation to even establish relevance. Do not include in v0.32.0 scope.

---

### 2.9 Skimlinks

**Type:** Affiliate monetization platform / publisher network

Skimlinks is a UK-based affiliate marketing platform (acquired by Taboola in 2020) that automatically converts outbound links to affiliate links. They have a publisher API and merchant data, but their primary product is link monetization, not structured coupon/code feeds.

**Access requirements:**
- Skimlinks publisher account required (application + approval by Skimlinks).
- API key issued per approved publisher account.
- Taboola acquisition may have changed product availability — verify current publisher program status. **[needs verification]**

**Data shape:** Like Sovrn Commerce, Skimlinks is link-monetization first. Whether they provide a queryable coupon/promo-code feed is unverified — this is the fundamental uncertainty.

**Policy fit:** Unclear — same issue as Sovrn: does not obviously map to §4 until a structured code feed is confirmed.

**Risks and unknowns:**
- Not primarily a coupon-code source — structured promo-code feed availability is unverified.
- Taboola acquisition may have changed API offerings and publisher program status.
- Requires investigation to establish whether a code feed exists at all.
- If a code feed is found: terms review and affiliate-metadata-isolation controls would both be required.

**v0.32.0 candidate?** **No.** Not primarily a coupon-code source. Requires investigation to establish relevance. Do not include in v0.32.0 scope.

---

## 3. Recommendation

### 3.1 Summary table

| Provider | Candidate? | Rationale |
|---|---|---|
| Awin Offers API | **Primary** | REST/JSON, publisher program, offer-type filter, policy-compatible |
| FMTC | **Backup** | Purpose-built for this use case; commercial subscription required |
| Rakuten Advertising | Second wave | Large US network; per-merchant approval + domain resolution complexity |
| impact.com | Second wave | Solid US API; per-merchant overhead; better after Awin is proven |
| LinkMyDeals | Lower priority | Coverage and access terms need verification |
| CouponAPI.org | Lower priority | Reliability and terms need verification |
| Admitad / Mitgo | Lower priority | Limited US coverage; rebranding uncertainty |
| Sovrn Commerce | **No** | Not primarily a coupon-code source |
| Skimlinks | **No** | Not primarily a coupon-code source |

---

### 3.2 Primary recommendation: Awin Offers API

**Rationale:**

1. **REST/JSON API, not a CSV feed.** Awin's Offers API returns structured JSON — no custom CSV parsing, no column-index brittleness. The response shape maps directly to `SourceAdapterCandidate` fields.
2. **Offer-type filtering.** Awin includes a `promotionType` (or equivalent) discriminator that allows filtering to voucher/code-type offers only. Non-code promotions (cashback, free delivery) are excluded before parsing.
3. **Publisher program with no commercial subscription fee.** Publisher accounts are free at awin.com. No separate commercial licensing required to access the API — unlike FMTC, which requires a paid subscription.
4. **Documented API.** API documentation is available at developer.awin.com (authentication required for full reference). The API is designed for programmatic publisher use — this is not repurposing a display-only tool.
5. **Policy compatibility.** Maps to `SOURCE_POLICY.md` §4 "Official APIs." Offer response includes merchant domain/URL, code, dates, and description — all fields needed without needing to carry affiliate tracking links into the candidate shape.
6. **Mock-first development.** The HTTP fetch layer is injectable; v0.32.0 can be written entirely against fixture responses. Live account approval is not a prerequisite for writing or testing the adapter code.
7. **Kill-switch compatible.** `SALVARE_ENABLE_AWIN_SOURCE` feature flag and `coupon_sources.enabled` DB column both work as kill switches without a rebuild.

**Credentials / access needed:**

- Awin publisher account — apply at awin.com. **[Verify current approval process and timeline from Awin's publisher registration page before starting v0.32.0]**
- OAuth token or API key — issued after publisher account approval.
- Per-merchant program join — required for each merchant whose offers will be fetched. Plan which merchants to join before v0.32.0 begins.

**What stays mocked until access is approved:**

- All HTTP fetch calls in unit tests and smoke tests — injected fixture responses only.
- `source_cache` and `source_fetch_log` entries — driven by mock fetch outcomes, not live API calls.
- No live Awin API calls in CI at any point before the adapter ships behind the feature flag.

---

### 3.3 Backup recommendation: FMTC

**Rationale:**

FMTC is purpose-built for coupon comparison and testing tools — the closest alignment with Salvare's use case of any evaluated provider. Their API is designed around querying by merchant domain, their data is normalized and deduplicated across multiple affiliate networks, and their product is explicitly intended for automated candidate lookup.

**Why Awin comes first:**

- FMTC requires a commercial subscription. Pricing is not publicly listed — it requires contacting FMTC sales. For a local/portfolio project this may be cost-prohibitive or slow to approve.
- Awin's publisher program is accessible (no commercial subscription fee) and the API docs are publicly available.
- FMTC remains the stronger option if Awin's merchant coverage proves insufficient or if commercial access to FMTC becomes available.

**Credentials / access needed for FMTC:**

- Commercial API subscription — contact fmtc.co. **[Verify current pricing, approval process, and use-case terms from FMTC directly before committing]**
- API key issued after subscription setup.

---

## 4. Terms and safety checklist

This checklist must be completed and documented before any live provider integration is enabled in v0.32.0. Each item must be marked verified with a source (e.g., "Awin Publisher Agreement §3.2, reviewed 2026-xx-xx") before the feature flag can be set to `true` in any environment other than local development with mocked HTTP.

- [ ] **Review provider terms of service.** Confirm the publisher/API agreement explicitly permits automated, programmatic access to fetch coupon code data (not just display or referral-link generation).
- [ ] **Confirm use-case permission.** Confirm that applying fetched codes on a real checkout (automated candidate testing to compare final totals) is permitted under the provider's terms — not just coupon display or affiliate click attribution.
- [ ] **Review rate limit and robots policies.** Confirm Salvare's fetch cadence stays within documented per-source rate limits and respects any robots.txt or machine-readable directives. Configure `minIntervalMs` in `canFetchSourceNow` accordingly.
- [ ] **No scraping prohibited sites.** The provider's API or feed endpoint is the fetch target. Salvare must never scrape merchant sites or provider websites directly.
- [ ] **No login or session scraping.** No automated sign-in, session cookie injection, or authenticated scraping of any gated page.
- [ ] **No CAPTCHA or bot-protection bypass.** If a fetch encounters CAPTCHA or bot protection, the fetch must fail cleanly (record `error` in `source_fetch_log`). No bypass attempt.
- [ ] **No raw payload logging.** Raw API response bodies must not be written to logs, `source_fetch_log`, or `source_cache.metadata_json`. Only `body_sha256` (SHA-256 of the raw response) and allowlisted, size-bounded metadata fields may be stored — per the existing `db-source-cache.ts` constraints.
- [ ] **Affiliate metadata does not influence winner selection.** Affiliate tracking links, payout rates, partner priority signals, commission attribution fields, and any monetization metadata in the provider response must be discarded before the candidate list is returned. They must never reach the ranking or winner-selection logic.
- [ ] **Checkout-verified final total decides the winner.** Fetched codes are candidates only. Every candidate must be applied on the live checkout, the resulting grand total must be re-read, and the lowest verified `finalTotalCents` decides the winner — not the provider's advertised savings or priority.
- [ ] **API key and credential hygiene.** API keys and tokens are passed via environment variable only. Never logged. Never committed. Never echoed in error messages, health responses, or `source_fetch_log` entries.
- [ ] **Kill switch and allowlist.** The provider source must be registered in `coupon_sources` with `enabled = 1`. Setting `enabled = 0` or unsetting the feature-flag env var must immediately disable all fetches without a rebuild.

---

## 5. v0.32.0 Implementation Preview

This section describes the intended implementation shape for the first live provider adapter (Awin as primary, FMTC as fallback). No code is written in this milestone. The preview exists so v0.32.0 has a clear contract before implementation begins.

### 5.1 Feature flag and kill switch

```
SALVARE_ENABLE_AWIN_SOURCE=true
```

- Must be explicitly set to `true` to enable. Absent, empty, or any other value means disabled.
- The Awin source row must also be present in `coupon_sources` with `type = 'api'` and `enabled = 1`.
- Either lever alone must be sufficient to disable all fetches. Setting `enabled = 0` in the DB or unsetting the env var must both stop fetches without a rebuild.

### 5.2 API key environment variable

```
SALVARE_AWIN_API_KEY=<token>
```

- Never logged.
- Never committed.
- Never echoed in error messages, health responses, or `source_fetch_log` entries.
- Absence of this variable must prevent the adapter from activating even if the feature flag is set.
- The `/health` endpoint must never expose whether or how the key is configured.

### 5.3 Mock-first test strategy

All unit and smoke tests use fixture/recorded HTTP responses. No live Awin API calls in CI.

Suggested factory shape:

```typescript
// v0.32.0 — design sketch only, not implemented in this milestone
function createAwinAdapter(
  options: AwinAdapterOptions,
  fetcher: (url: string, headers: Record<string, string>) => Promise<string>,
): SourceAdapter
```

- `fetcher` is an injectable dependency. Tests pass a stub returning committed fixture JSON.
- The live fetcher (e.g. Node `fetch`) is wired only in the server bootstrap path, gated by `SALVARE_ENABLE_AWIN_SOURCE` and `SALVARE_AWIN_API_KEY`.
- Test fixtures are committed JSON files under `server/fixtures/` representing valid responses, empty results, error shapes, and edge cases (missing code field, non-voucher promotion type, etc.).

### 5.4 source_cache and source_fetch_log integration

Every Awin fetch must go through the existing v0.29.0 helpers before any network call:

1. Call `canFetchSourceNow({ sourceId: 'awin', cacheKey, minIntervalMs })`.
   - If blocked (fresh cache or recent attempt within `minIntervalMs`): return cached candidates or empty result; record `cache_hit` outcome in `source_fetch_log`.
   - Configure `minIntervalMs` to respect Awin's documented rate limits. **[Verify rate limits from Awin API docs]**
2. On fetch attempt: call `recordSourceFetchAttempt` before the network call.
3. On success: call `upsertSourceCacheEntry` with `body_sha256` (SHA-256 of raw response body) and allowlisted metadata (e.g. `{ offer_count: N }` — no auth tokens, no raw body, no headers).
4. On error: call `recordSourceFetchAttempt` with `outcome: 'error'` and a short `error_code` token (e.g. `http_4xx`, `timeout`, `parse_error`).

### 5.5 Parse into SourceAdapterCandidate shape

The Awin response parser must reuse the validation primitives already defined in `server/source-adapters.ts`:

- `validateDomain`, `validateCode`, `validateLabel`, `validateExpiresAt`, `validateSourceUrl`, `validateConfidence`.
- Filter to voucher/code-type `promotionType` before iterating rows. Discard non-code promotions silently.
- Extract `domain` from merchant URL hostname — normalize to bare hostname (e.g. `example.com`), not full URL.
- Drop all affiliate tracking link fields from parsed candidates. `sourceUrl` must be the merchant URL or Awin's canonical offer URL — never the affiliate tracking link.
- Drop unknown fields silently per the existing `pickAllowedRow` pattern.
- Emit redacted `{ index, reason }` errors for invalid rows — never echo payload field values.

### 5.6 Preview before import — no automatic application

Parsed candidates follow the existing preview→import discipline:

- Parsed candidates are surfaced through an admin preview endpoint (analogous to the existing `POST /admin/import/preview/coupons`).
- No automatic write to `coupon_codes` or `coupon_code_sources` on fetch.
- The user reviews parsed candidates in the admin UI before any import step.
- The explicit import step follows the existing `Preview → type IMPORT → Apply` gate.
- Background auto-fetch, scheduled polling, and automatic import are out of scope for v0.32.0.

### 5.7 No extension behavior change

The extension's `GET /coupons?domain=` response shape and ranking behavior are unchanged. If Awin candidates are imported (via the preview→import gate), they enter the existing `coupon_codes` table alongside seed/admin codes and are returned by the same endpoint with the same ranking logic. No extension code, content script, popup, or store profile changes in v0.32.0.

---

## 6. Open questions before v0.32.0 begins

The following must be answered — from official Awin documentation or direct inquiry — before v0.32.0 implementation starts:

1. What is the current Awin Offers API auth scheme? (OAuth2 authorization code, API key header, or both?)
2. What are the documented rate limits for the Offers API? (Requests per minute/hour per publisher account?)
3. What is the exact `promotionType` value (or field name) used for voucher/coupon-code type promotions?
4. Does the Offers API response include a bare merchant domain field, or only a full merchant URL requiring hostname extraction?
5. Does the publisher agreement explicitly permit automated coupon code application on a checkout (not just display/referral)?
6. What is the current publisher account approval timeline at awin.com?
7. Are there any restrictions on querying offers for merchants the publisher has not yet joined? (i.e., can you discover merchant offers before joining, or only after per-merchant approval?)
