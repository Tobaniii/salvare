// Admin source freshness / status boundary (v0.40.0).
//
// Read-only admin endpoint that surfaces source/cache/fetch-log health for
// every row in `coupon_sources`. The handler wraps `getSourceStatusSummary`
// (db-source-status.ts) and a strict response allowlist so the route cannot
// accidentally leak the API key, the `Authorization` header, raw provider
// payloads, raw HTML, env values, the DB path, stack traces, affiliate /
// tracking fields, source URLs, `body_sha256`, or `metadata_json`.
//
// The handler executes zero writes. It calls no provider fetcher, no
// importer, and no refresh runner. Only SELECTs run via the helper.
//
// Provider feature-flag / configured booleans are derived from an injected
// `providerStatus` callback so the route stays env-free in tests; the
// default wiring in `server/index.ts` consults `readAwinConfig(process.env)`
// for the `awin` source.
//
// Per docs/SOURCE_POLICY.md §6 and the redaction rules in
// docs/SOURCE_PROVIDER_RESEARCH.md §5, the response is built from an
// explicit allowlist below. New fields must be added here, not at the
// helper boundary.

import { sendJson, type RouteContext } from "./http-helpers";
import {
  getSourceStatusSummary,
  type ProviderStatusFn,
  type SourceStatusRow,
  type SourceStatusSummary,
} from "./db-source-status";

const ALLOWED_OUTCOMES = new Set([
  "ok",
  "empty",
  "error",
  "rate_limited",
  "cache_hit",
]);

const ERROR_CODE_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;

function safeOutcome(value: string | null): string | null {
  if (value === null) return null;
  return ALLOWED_OUTCOMES.has(value) ? value : null;
}

function safeErrorCode(value: string | null): string | null {
  if (value === null) return null;
  return ERROR_CODE_PATTERN.test(value) ? value : null;
}

function buildSafeRow(row: SourceStatusRow): SourceStatusRow {
  return {
    sourceId: row.sourceId,
    sourceName: row.sourceName,
    sourceType: row.sourceType,
    enabled: row.enabled === true,
    providerFeatureEnabled: row.providerFeatureEnabled === true,
    providerConfigured: row.providerConfigured === true,
    lastFetchAt: row.lastFetchAt,
    lastFetchOutcome: safeOutcome(row.lastFetchOutcome) as
      | SourceStatusRow["lastFetchOutcome"],
    lastSafeError: safeErrorCode(row.lastSafeError),
    cacheEntries: Number(row.cacheEntries),
    freshCacheEntries: Number(row.freshCacheEntries),
    staleCacheEntries: Number(row.staleCacheEntries),
    cachedCandidateCount: Number(row.cachedCandidateCount),
    newestCacheAt: row.newestCacheAt,
    nextAllowedFetchAt: row.nextAllowedFetchAt,
  };
}

function buildSafeResponse(summary: SourceStatusSummary): SourceStatusSummary {
  return { sources: summary.sources.map(buildSafeRow) };
}

export function handleAdminSourceStatusRoute(
  ctx: RouteContext,
  providerStatus: ProviderStatusFn,
): boolean {
  const { db, req, res, url, requireAuth } = ctx;

  if (req.method !== "GET" || url.pathname !== "/admin/source-status") {
    return false;
  }
  if (!requireAuth(req, res)) return true;

  const summary = getSourceStatusSummary(db, { providerStatus });
  sendJson(res, 200, buildSafeResponse(summary));
  return true;
}
