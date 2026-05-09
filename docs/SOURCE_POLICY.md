# Salvare Source-Ingestion Policy & Product Principles

This document defines the policy and product principles that govern any future coupon-source integration work in Salvare. It is the canonical reference: any milestone that proposes ingesting candidate codes from outside the existing seed/admin/import flow must review and comply with this document before implementation begins. The policy is forward-looking — Salvare today does not ingest from external sources at all — and exists so the eventual integration work has a clear contract to satisfy.

This document is not legal advice. Future source integrations must independently review and comply with the relevant provider, API, feed, or site terms of service, robots directives, and any other applicable rules before any fetch, parse, or import is enabled.

---

## 1. Scope

This policy governs:

- Where Salvare may obtain candidate coupon codes in the future.
- How candidate codes from any source must be handled, ranked, and verified.
- What kinds of source integration are explicitly disallowed.
- The guardrails any future ingestion code must satisfy before it ships.

It does not govern the existing local seed/admin/import flow, which already ships in Salvare today and is unchanged by this policy.

## 2. Current state

As of this milestone, Salvare:

- Does not scrape any website.
- Does not discover external coupon codes.
- Sources candidate codes only from hand-curated seed JSON, admin-managed entries persisted in SQLite, and previously exported snapshots imported back through the admin UI.
- Verifies coupon value by applying each candidate code on the live checkout and reading the resulting final total. The lowest verified final total decides the winner.

Nothing in this document changes that current behavior. All references to source ingestion below describe future, opt-in, allowlisted work — not anything that runs today.

## 3. Core product principles

These principles apply to every future source integration without exception:

1. **Candidate sources suggest codes.** A source — whether a partner feed, an official API, or an admin-imported JSON file — proposes candidate codes. It does not certify their value.
2. **Checkout verification decides the winner.** Every candidate is applied on the live checkout, and the resulting order total is what counts.
3. **The lowest verified final total wins.** Final winner selection is based on observed `finalTotalCents`, with `savingsCents` as the tiebreaker.
4. **Affiliate value must never influence which code wins.** Affiliate metadata, payout shares, partner relationships, or any monetization signal must never rank a worse user outcome above a better one. The user always sees the code that gives them the lowest verified final total.
5. **Source provenance must be recorded** when source ingestion exists, so every candidate code can be audited back to where it came from, when it was ingested, and under what permission.
6. **Source confidence may influence test order, never the winner.** A high-confidence source may move its codes earlier in the test queue, and may serve as a tiebreaker only when final totals are exactly equal. It must never override an observed cheaper checkout.
7. **Source integrations must be trusted, allowed, rate-limited, and transparent.** Sources that cannot be operated within those four constraints are not valid Salvare sources.

## 4. Allowed future source types

The following source types are permitted in scope, in roughly increasing risk order. Each requires its own review against the guardrails in section 6 before being enabled:

- **Manual/admin import** — already exists; remains the safest path.
- **Local JSON import** — validated, schema-checked imports of previously exported or hand-authored snapshots.
- **Official APIs** — documented endpoints from a provider that explicitly authorizes Salvare's use case.
- **Licensed or partner feeds** — sources with a written agreement that authorizes ingestion.
- **Merchant-provided promo feeds** — feeds the merchant publishes specifically for this kind of use (e.g. signed JSON, RSS/Atom).
- **User-provided source files or URLs**, only after strict validation of shape, size, and content. The user remains responsible for the source's permission.
- **Allowlisted HTML adapters** — narrowly scoped, source-by-source, and only if the source explicitly permits structured extraction. These are last in line, never enabled by default, and never generic.

## 5. Prohibited or out-of-scope behavior

The following are explicitly disallowed under this policy and may not be implemented in Salvare under any source-ingestion milestone:

- No uncontrolled or broad crawling.
- No scraping of sites that prohibit it via terms, robots directives, or comparable signal.
- No login or session scraping (no automated sign-in to access gated content).
- No CAPTCHA solving.
- No bot-protection bypass of any kind.
- No proxy rotation, IP cycling, or stealth-scraping techniques.
- No collection of personal checkout data — names, addresses, emails, payment fields, cookies, session tokens, or anything that identifies the shopper.
- No raw HTML dumps stored by default. If a future adapter must retain a fetched payload for debugging, it does so opt-in, time-bounded, and with personal data scrubbed.
- No use of affiliate payout, partner relationship, or any monetization signal to choose the winning code.

## 6. Guardrails for future ingestion

When source ingestion lands, every adapter and every fetch path must satisfy the following guardrails. These are non-negotiable preconditions, not aspirational goals:

- **Explicit allowlist.** A source must be added to a maintained allowlist before it can be fetched. Unknown hosts and unknown source identifiers are rejected.
- **Disabled by default until configured.** No adapter activates without an explicit local configuration step. A fresh checkout fetches from no external source.
- **Rate limits.** Per-source maximum requests per interval, plus a global ceiling, to prevent accidental traffic spikes.
- **Fetch timeouts.** Every outbound request carries a hard timeout; slow sources fail fast and do not block the test pipeline.
- **Max response size.** Bounded response size per source so a misconfigured or malicious endpoint cannot exhaust memory or disk.
- **Caching policy.** Documented per-source cache TTL so the same source is not refetched on every checkout.
- **Provenance tracking.** Every imported candidate carries the source identifier, ingestion timestamp, and the permission basis (manual import, partner feed, etc.) so the audit trail is intact.
- **Preview before import where practical.** Mirror the existing admin import flow's `Preview → type IMPORT → Apply` discipline whenever a source can produce a payload the user can review up front.
- **Safe parsing and strict validation.** No `eval`, no untyped object spread into the database, no trust in unknown fields. Validators reject unknown shapes and never echo raw payload contents back in errors.
- **No secrets in logs.** API keys, bearer tokens, partner credentials, and user-supplied source URLs that may carry tokens must never appear in logs, error messages, or on disk outside the configured secret store.
- **Clear kill switch.** A single configuration toggle disables a source — and a single toggle disables all source ingestion — without requiring a rebuild.
- **Source health and quality metrics later.** Once multiple sources exist, track per-source success rate, average savings, and freshness so under-performing or stale sources can be deprioritized or removed.

Adapters that cannot meet every applicable guardrail are not eligible to ship.

## 7. Ranking principle

Salvare's ranking rule, restated unambiguously for future implementations:

- **Pre-test ordering.** Source confidence and prior result history may reorder the candidate test queue so likely-winning codes are tried earlier. This is purely an ordering optimization; the same set of codes is tested either way.
- **Final selection.** The winning code is whichever produced the lowest observed `finalTotalCents` on the live checkout.
- **Tiebreakers, in order.**
  1. Highest `savingsCents` against the baseline.
  2. Source confidence — only when final totals (and savings) are exactly equal.
- **Affiliate metadata is not a ranking input.** It must not move a higher final total above a lower one, ever, under any tiebreaker.

If a future ranking change cannot satisfy these rules in writing, it does not ship.

## 8. Compliance note

This document is not legal advice. Any future source integration must independently review and comply with:

- The provider, API, feed, partner, or site's published terms of service and any other governing agreement.
- Applicable robots directives, rate-limit headers, and similar machine-readable signals.
- Any jurisdiction-specific rules that apply to the source or the user.

If a source's terms prohibit ingestion, or if compliance is unclear, the source does not ship until its status is resolved.

## 9. Roadmap

The near-term roadmap exists to translate this policy into small, reviewable milestones. Each step remains docs- or schema-level until an explicit implementation milestone follows.

- **v0.27** — Coupon source / provenance data model (design only).
- **v0.28** — Candidate dedupe and provenance logic.
- **v0.29** — Source cache and rate-limit foundation.
- **v0.30** — Local source-adapter fixture system (no live network).
- **v0.31+** — Provider, API, and feed research; first real provider spike behind the allowlist and kill switch defined above.

The roadmap is a planning aid, not a commitment. Every milestone above must still satisfy this policy before any code lands.

### Status

- **v0.27.0 — landed.** The internal `coupon_sources` and `coupon_code_sources` tables, default `seed`/`admin`/`import` source rows, source-id validation, and the `db-sources.ts` helper module exist at the schema and code layer. No external ingestion runs against them yet; export/import JSON shapes are unchanged. See [`docs/DATABASE_PLAN.md`](DATABASE_PLAN.md) section 9b for the schema details.
- **v0.28.0 — landed.** The three local coupon-code writers (seed bootstrap, admin `POST /admin/coupons`, JSON import via the `db:import` CLI and `POST /admin/import/apply/coupons`) now record provenance via the v0.27 helpers, atomically inside their existing transactions. Destructive per-store replace helpers also prune stale provenance for codes they remove. Still no external ingestion; export/import JSON shapes and public response shapes are unchanged. See [`docs/DATABASE_PLAN.md`](DATABASE_PLAN.md) section 9c.
- **v0.29.0 — landed.** Internal `source_cache` and `source_fetch_log` tables and pure decision-only helpers (`recordSourceFetchAttempt`, `canFetchSourceNow`, `upsertSourceCacheEntry`, `getSourceCacheEntry`, `pruneExpiredSourceCache`, `getSourceCacheSummary`) exist so future trusted-source adapters can satisfy the rate-limit and caching guardrails in section 6. **No external fetching, no scraping, no provider/API/feed adapters, no HTML adapters, no source endpoints, and no source admin UI exist yet** — these are the cache/rate-limit foundation only. `body_sha256` is the only response artefact stored; raw HTML, raw response bodies, headers, cookies, tokens, env vars, and filesystem paths are never persisted. See [`docs/DATABASE_PLAN.md`](DATABASE_PLAN.md) section 9d.
