// Source freshness / health summary helper (v0.40.0).
//
// Pure SELECT-only aggregation over `coupon_sources`, `source_cache`, and
// `source_fetch_log` so a local admin can inspect source/cache/fetch-log
// health without triggering refresh, import, or provider calls. The helper
// performs no INSERT/UPDATE/DELETE and never issues network I/O, never reads
// from the filesystem, and never reads `process.env`. Provider feature flag
// and configured-key booleans are supplied by the caller via the
// `providerStatus` callback so this module remains environment-free.
//
// Per docs/SOURCE_POLICY.md §6 and the redaction rules in
// docs/SOURCE_PROVIDER_RESEARCH.md §5, the returned shape is a strict
// allowlist of safe summary fields. It never returns request payloads, raw
// provider payloads, raw HTML, the `body_sha256` hash, the `metadata_json`
// blob, candidate arrays, source URLs, cookies, env values, DB paths, API
// keys, authorization headers, stack traces, or affiliate / tracking fields.
// `lastSafeError` is re-validated against the existing fetch-log error-code
// pattern before emission so a corrupt row cannot leak free-form text.

import type { Db } from "./db";
import type { CouponSourceType } from "./db";
import type { SourceFetchOutcome } from "./db-source-cache";

const ERROR_CODE_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const FETCH_OUTCOMES: readonly SourceFetchOutcome[] = [
  "ok",
  "empty",
  "error",
  "rate_limited",
  "cache_hit",
];

export interface SourceStatusProviderInfo {
  /** True iff the provider feature flag (env or equivalent) is on. */
  featureEnabled: boolean;
  /**
   * True iff the provider is fully configured for live use (flag on AND
   * required credentials present). Always false when `featureEnabled` is
   * false.
   */
  configured: boolean;
}

export type ProviderStatusFn = (
  sourceId: string,
) => SourceStatusProviderInfo;

export interface SourceStatusRow {
  sourceId: string;
  sourceName: string;
  sourceType: CouponSourceType;
  enabled: boolean;
  providerFeatureEnabled: boolean;
  providerConfigured: boolean;
  lastFetchAt: string | null;
  lastFetchOutcome: SourceFetchOutcome | null;
  lastSafeError: string | null;
  cacheEntries: number;
  freshCacheEntries: number;
  staleCacheEntries: number;
  cachedCandidateCount: number;
  newestCacheAt: string | null;
  nextAllowedFetchAt: string | null;
}

export interface SourceStatusSummary {
  sources: SourceStatusRow[];
}

export interface GetSourceStatusOptions {
  /**
   * Per-source provider info. Called once per `coupon_sources.id`. The
   * default returns `{ featureEnabled: false, configured: false }` so a
   * caller that forgets to wire this falls closed.
   */
  providerStatus?: ProviderStatusFn;
  /**
   * Reference timestamp used to split cache rows into fresh vs stale and to
   * derive `nextAllowedFetchAt`. Defaults to `new Date().toISOString()`.
   */
  now?: string;
}

interface SourceRow {
  id: string;
  name: string;
  type: string;
  enabled: number;
}

interface CacheAggRow {
  source_id: string;
  total: number | null;
  fresh: number | null;
  stale: number | null;
  newest: string | null;
  next_allowed: string | null;
}

interface LastFetchRow {
  source_id: string;
  attempted_at: string;
  outcome: string;
  error_code: string | null;
}

interface CandidatesJsonRow {
  source_id: string;
  candidates_json: string | null;
}

function nowIso(): string {
  return new Date().toISOString();
}

function parseIso(value: string, field: string): number {
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) {
    throw new Error(`${field} must be a valid ISO-8601 timestamp`);
  }
  return ms;
}

function safeOutcome(value: string): SourceFetchOutcome | null {
  return (FETCH_OUTCOMES as readonly string[]).includes(value)
    ? (value as SourceFetchOutcome)
    : null;
}

function safeErrorCode(value: string | null): string | null {
  if (value === null) return null;
  return ERROR_CODE_PATTERN.test(value) ? value : null;
}

function countCandidatesJson(value: string | null): number {
  if (value === null) return 0;
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    return 0;
  }
}

function defaultProviderStatus(): SourceStatusProviderInfo {
  return { featureEnabled: false, configured: false };
}

export function getSourceStatusSummary(
  db: Db,
  options: GetSourceStatusOptions = {},
): SourceStatusSummary {
  const providerStatus = options.providerStatus ?? defaultProviderStatus;
  const now = options.now ?? nowIso();
  parseIso(now, "now");

  const sourceRows = db
    .prepare(
      `SELECT id, name, type, enabled
         FROM coupon_sources
         ORDER BY id ASC`,
    )
    .all() as SourceRow[];

  if (sourceRows.length === 0) {
    return { sources: [] };
  }

  const cacheAgg = db
    .prepare(
      `SELECT source_id,
              COUNT(cache_key)                                  AS total,
              SUM(CASE WHEN expires_at > ? THEN 1 ELSE 0 END)   AS fresh,
              SUM(CASE WHEN expires_at <= ? THEN 1 ELSE 0 END)  AS stale,
              MAX(fetched_at)                                   AS newest,
              MAX(CASE WHEN expires_at > ? THEN expires_at END) AS next_allowed
         FROM source_cache
         GROUP BY source_id`,
    )
    .all(now, now, now) as CacheAggRow[];

  const cacheBySource = new Map<string, CacheAggRow>();
  for (const row of cacheAgg) cacheBySource.set(row.source_id, row);

  // Candidate-count aggregation runs per row in JS so corrupt/non-array
  // candidates_json blobs contribute 0 instead of throwing. Bounded by the
  // existing 32 KB / row write cap in db-source-cache.ts.
  const candidatesRows = db
    .prepare(
      `SELECT source_id, candidates_json
         FROM source_cache
         WHERE candidates_json IS NOT NULL`,
    )
    .all() as CandidatesJsonRow[];

  const candidateCountBySource = new Map<string, number>();
  for (const row of candidatesRows) {
    const n = countCandidatesJson(row.candidates_json);
    candidateCountBySource.set(
      row.source_id,
      (candidateCountBySource.get(row.source_id) ?? 0) + n,
    );
  }

  const lastFetchBySource = new Map<string, LastFetchRow>();
  for (const source of sourceRows) {
    const row = db
      .prepare(
        `SELECT source_id, attempted_at, outcome, error_code
           FROM source_fetch_log
           WHERE source_id = ?
           ORDER BY attempted_at DESC, id DESC
           LIMIT 1`,
      )
      .get(source.id) as LastFetchRow | undefined;
    if (row) lastFetchBySource.set(source.id, row);
  }

  const sources: SourceStatusRow[] = sourceRows.map((source) => {
    const agg = cacheBySource.get(source.id);
    const last = lastFetchBySource.get(source.id);
    const providerInfo = providerStatus(source.id);
    const featureEnabled = providerInfo.featureEnabled === true;
    const configured = featureEnabled && providerInfo.configured === true;

    const cacheEntries = Number(agg?.total ?? 0);
    const freshCacheEntries = Number(agg?.fresh ?? 0);
    const staleCacheEntries = Number(agg?.stale ?? 0);
    const newestCacheAt = agg?.newest ?? null;
    const nextAllowedFetchAt = agg?.next_allowed ?? null;
    const cachedCandidateCount = candidateCountBySource.get(source.id) ?? 0;

    return {
      sourceId: source.id,
      sourceName: source.name,
      sourceType: source.type as CouponSourceType,
      enabled: source.enabled === 1,
      providerFeatureEnabled: featureEnabled,
      providerConfigured: configured,
      lastFetchAt: last?.attempted_at ?? null,
      lastFetchOutcome: last ? safeOutcome(last.outcome) : null,
      lastSafeError: last ? safeErrorCode(last.error_code) : null,
      cacheEntries,
      freshCacheEntries,
      staleCacheEntries,
      cachedCandidateCount,
      newestCacheAt,
      nextAllowedFetchAt,
    };
  });

  return { sources };
}
