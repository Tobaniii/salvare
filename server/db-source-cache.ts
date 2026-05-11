// Source cache + rate-limit helpers (v0.29.0).
//
// Pure functions over the SQLite tables `source_cache` and
// `source_fetch_log`. These tables and helpers exist so future trusted
// source-ingestion adapters can record fetch attempts, cache hashed
// payloads, and decide whether a new fetch is allowed under the per-source
// rate limit defined in docs/SOURCE_POLICY.md §6. No fetcher lives here —
// these are decision-only helpers. Callers must perform the actual network
// I/O elsewhere (and in a future milestone).
//
// Storage rules: nothing in this module accepts or stores raw HTML, raw
// response bodies, request/response headers, cookies, set-cookies, auth
// tokens, bearer values, environment variables, filesystem paths, or
// localStorage. The cache table holds only a body sha256 hash and a
// strictly validated, allowlisted, size-bounded metadata blob. The fetch
// log holds only outcome tokens, a numeric status code, a short error
// code, and a duration — never error messages or response payloads.

import type { Db } from "./db";
import { validateSourceId } from "./db-sources";

const CACHE_KEY_PATTERN = /^[a-z0-9][a-z0-9._:/-]{0,255}$/;
const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;
const ERROR_CODE_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const METADATA_KEY_PATTERN = /^[a-z0-9][a-z0-9_-]{0,47}$/;
const METADATA_MAX_KEYS = 16;
const METADATA_MAX_BYTES = 2048;
const METADATA_STRING_MAX = 200;
const CANDIDATES_JSON_MAX_BYTES = 32 * 1024;

const METADATA_DENY_KEYS: ReadonlySet<string> = new Set([
  "authorization",
  "cookie",
  "set-cookie",
  "setcookie",
  "token",
  "bearer",
  "password",
  "secret",
  "session",
  "session-id",
  "sessionid",
  "api-key",
  "apikey",
  "x-api-key",
  "x-auth-token",
  "auth",
  "credential",
  "credentials",
]);

const CACHE_STATUSES = ["ok", "empty", "error"] as const;
export type SourceCacheStatus = (typeof CACHE_STATUSES)[number];

const FETCH_OUTCOMES = [
  "ok",
  "empty",
  "error",
  "rate_limited",
  "cache_hit",
] as const;
export type SourceFetchOutcome = (typeof FETCH_OUTCOMES)[number];

export interface SourceFetchAttemptInput {
  sourceId: string;
  cacheKey: string;
  outcome: SourceFetchOutcome;
  attemptedAt?: string;
  statusCode?: number | null;
  errorCode?: string | null;
  durationMs?: number | null;
}

export interface SourceFetchLogRow {
  id: number;
  sourceId: string;
  cacheKey: string;
  attemptedAt: string;
  outcome: SourceFetchOutcome;
  statusCode: number | null;
  errorCode: string | null;
  durationMs: number | null;
}

export interface SourceCacheUpsertInput {
  sourceId: string;
  cacheKey: string;
  fetchedAt: string;
  expiresAt: string;
  status: SourceCacheStatus;
  bodySha256?: string | null;
  metadata?: Record<string, MetadataValue> | null;
  candidatesJson?: string | null;
}

export type MetadataValue = string | number | boolean | null;

export interface SourceCacheEntry {
  sourceId: string;
  cacheKey: string;
  fetchedAt: string;
  expiresAt: string;
  status: SourceCacheStatus;
  bodySha256: string | null;
  metadata: Record<string, MetadataValue> | null;
  candidatesJson: string | null;
}

export interface SourceCacheLookup {
  entry: SourceCacheEntry;
  fresh: boolean;
  expired: boolean;
}

export interface CanFetchInput {
  sourceId: string;
  cacheKey: string;
  minIntervalMs: number;
}

export type CanFetchReason =
  | "unknown_source"
  | "cache_fresh"
  | "recent_attempt";

export interface CanFetchDecision {
  allowed: boolean;
  reason?: CanFetchReason;
  retryAfterMs?: number;
}

export interface SourceCacheSummaryRow {
  sourceId: string;
  total: number;
  fresh: number;
  expired: number;
  lastFetchedAt: string | null;
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

function validateCacheKey(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("cacheKey must be a string");
  }
  if (!CACHE_KEY_PATTERN.test(value)) {
    throw new Error(
      "cacheKey must match /^[a-z0-9][a-z0-9._:/-]{0,255}$/ (no whitespace, no auth-shaped chars)",
    );
  }
  return value;
}

function validateOutcome(value: unknown): SourceFetchOutcome {
  if (
    typeof value !== "string" ||
    !(FETCH_OUTCOMES as readonly string[]).includes(value)
  ) {
    throw new Error(
      `outcome must be one of: ${FETCH_OUTCOMES.join(", ")}`,
    );
  }
  return value as SourceFetchOutcome;
}

function validateStatus(value: unknown): SourceCacheStatus {
  if (
    typeof value !== "string" ||
    !(CACHE_STATUSES as readonly string[]).includes(value)
  ) {
    throw new Error(
      `status must be one of: ${CACHE_STATUSES.join(", ")}`,
    );
  }
  return value as SourceCacheStatus;
}

function validateOptionalStatusCode(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > 999
  ) {
    throw new Error("statusCode must be an integer in [0, 999]");
  }
  return value;
}

function validateOptionalErrorCode(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || !ERROR_CODE_PATTERN.test(value)) {
    throw new Error(
      "errorCode must match /^[a-z0-9][a-z0-9_-]{0,63}$/ (short token, not a message)",
    );
  }
  return value;
}

function validateOptionalDurationMs(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > 24 * 60 * 60 * 1000
  ) {
    throw new Error("durationMs must be an integer in [0, 86_400_000]");
  }
  return value;
}

function validateOptionalCandidatesJson(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") {
    throw new Error("candidatesJson must be a string");
  }
  if (Buffer.byteLength(value, "utf8") > CANDIDATES_JSON_MAX_BYTES) {
    throw new Error(
      `candidatesJson exceeds ${CANDIDATES_JSON_MAX_BYTES} bytes`,
    );
  }
  // Must parse, must be an array. Reject non-array shapes so the cache can
  // never hold a raw provider envelope. Element-level validation is the
  // caller's responsibility (the adapter re-runs validators on read).
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("candidatesJson must be valid JSON");
  }
  if (!Array.isArray(parsed)) {
    throw new Error("candidatesJson must encode a JSON array");
  }
  return value;
}

function validateOptionalSha256(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || !SHA256_HEX_PATTERN.test(value)) {
    throw new Error("bodySha256 must be lowercase hex of length 64");
  }
  return value;
}

function validateMetadata(
  value: unknown,
): Record<string, MetadataValue> | null {
  if (value === null || value === undefined) return null;
  if (
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new Error("metadata must be a plain object");
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > METADATA_MAX_KEYS) {
    throw new Error(`metadata exceeds ${METADATA_MAX_KEYS} keys`);
  }
  const out: Record<string, MetadataValue> = {};
  for (const [key, v] of entries) {
    if (!METADATA_KEY_PATTERN.test(key)) {
      throw new Error(
        `metadata key ${JSON.stringify(key)} must match /^[a-z0-9][a-z0-9_-]{0,47}$/`,
      );
    }
    if (METADATA_DENY_KEYS.has(key.toLowerCase())) {
      throw new Error(
        `metadata key ${JSON.stringify(key)} is denylisted (auth/credential-shaped)`,
      );
    }
    if (v === null) {
      out[key] = null;
      continue;
    }
    if (typeof v === "boolean") {
      out[key] = v;
      continue;
    }
    if (typeof v === "number") {
      if (!Number.isFinite(v)) {
        throw new Error(`metadata value for ${JSON.stringify(key)} must be finite`);
      }
      out[key] = v;
      continue;
    }
    if (typeof v === "string") {
      if (v.length > METADATA_STRING_MAX) {
        throw new Error(
          `metadata value for ${JSON.stringify(key)} exceeds ${METADATA_STRING_MAX} chars`,
        );
      }
      out[key] = v;
      continue;
    }
    throw new Error(
      `metadata value for ${JSON.stringify(key)} must be string|number|boolean|null`,
    );
  }
  const serialized = JSON.stringify(out);
  if (Buffer.byteLength(serialized, "utf8") > METADATA_MAX_BYTES) {
    throw new Error(`metadata exceeds ${METADATA_MAX_BYTES} bytes serialized`);
  }
  return out;
}

function rowToFetchLog(row: {
  id: number;
  source_id: string;
  cache_key: string;
  attempted_at: string;
  outcome: string;
  status_code: number | null;
  error_code: string | null;
  duration_ms: number | null;
}): SourceFetchLogRow {
  return {
    id: row.id,
    sourceId: row.source_id,
    cacheKey: row.cache_key,
    attemptedAt: row.attempted_at,
    outcome: row.outcome as SourceFetchOutcome,
    statusCode: row.status_code,
    errorCode: row.error_code,
    durationMs: row.duration_ms,
  };
}

function rowToCacheEntry(row: {
  source_id: string;
  cache_key: string;
  fetched_at: string;
  expires_at: string;
  status: string;
  body_sha256: string | null;
  metadata_json: string | null;
  candidates_json: string | null;
}): SourceCacheEntry {
  let metadata: Record<string, MetadataValue> | null = null;
  if (row.metadata_json !== null) {
    try {
      const parsed = JSON.parse(row.metadata_json) as unknown;
      metadata = validateMetadata(parsed);
    } catch {
      metadata = null;
    }
  }
  return {
    sourceId: row.source_id,
    cacheKey: row.cache_key,
    fetchedAt: row.fetched_at,
    expiresAt: row.expires_at,
    status: row.status as SourceCacheStatus,
    bodySha256: row.body_sha256,
    metadata,
    candidatesJson: row.candidates_json,
  };
}

export function recordSourceFetchAttempt(
  db: Db,
  input: SourceFetchAttemptInput,
  now: string = nowIso(),
): SourceFetchLogRow {
  const sourceId = validateSourceId(input.sourceId);
  const cacheKey = validateCacheKey(input.cacheKey);
  const outcome = validateOutcome(input.outcome);
  const attemptedAt = input.attemptedAt ?? now;
  parseIso(attemptedAt, "attemptedAt");
  const statusCode = validateOptionalStatusCode(input.statusCode);
  const errorCode = validateOptionalErrorCode(input.errorCode);
  const durationMs = validateOptionalDurationMs(input.durationMs);

  const result = db
    .prepare(
      `INSERT INTO source_fetch_log
         (source_id, cache_key, attempted_at, outcome, status_code, error_code, duration_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(sourceId, cacheKey, attemptedAt, outcome, statusCode, errorCode, durationMs);

  const row = db
    .prepare(
      `SELECT id, source_id, cache_key, attempted_at, outcome,
              status_code, error_code, duration_ms
         FROM source_fetch_log WHERE id = ?`,
    )
    .get(Number(result.lastInsertRowid)) as
    | {
        id: number;
        source_id: string;
        cache_key: string;
        attempted_at: string;
        outcome: string;
        status_code: number | null;
        error_code: string | null;
        duration_ms: number | null;
      }
    | undefined;
  if (!row) {
    throw new Error("source_fetch_log row missing after insert");
  }
  return rowToFetchLog(row);
}

export function getLastSourceFetch(
  db: Db,
  sourceId: string,
  cacheKey: string,
): SourceFetchLogRow | null {
  validateSourceId(sourceId);
  validateCacheKey(cacheKey);
  const row = db
    .prepare(
      `SELECT id, source_id, cache_key, attempted_at, outcome,
              status_code, error_code, duration_ms
         FROM source_fetch_log
         WHERE source_id = ? AND cache_key = ?
         ORDER BY attempted_at DESC, id DESC
         LIMIT 1`,
    )
    .get(sourceId, cacheKey) as
    | {
        id: number;
        source_id: string;
        cache_key: string;
        attempted_at: string;
        outcome: string;
        status_code: number | null;
        error_code: string | null;
        duration_ms: number | null;
      }
    | undefined;
  return row ? rowToFetchLog(row) : null;
}

export function canFetchSourceNow(
  db: Db,
  input: CanFetchInput,
  now: string = nowIso(),
): CanFetchDecision {
  const sourceId = validateSourceId(input.sourceId);
  const cacheKey = validateCacheKey(input.cacheKey);
  if (
    typeof input.minIntervalMs !== "number" ||
    !Number.isInteger(input.minIntervalMs) ||
    input.minIntervalMs < 0
  ) {
    throw new Error("minIntervalMs must be a non-negative integer");
  }
  const nowMs = parseIso(now, "now");

  const sourceRow = db
    .prepare(`SELECT 1 AS x FROM coupon_sources WHERE id = ?`)
    .get(sourceId) as { x: number } | undefined;
  if (!sourceRow) {
    return { allowed: false, reason: "unknown_source" };
  }

  const cacheRow = db
    .prepare(
      `SELECT expires_at FROM source_cache
         WHERE source_id = ? AND cache_key = ?`,
    )
    .get(sourceId, cacheKey) as { expires_at: string } | undefined;
  if (cacheRow) {
    const expiresMs = parseIso(cacheRow.expires_at, "expires_at");
    if (expiresMs > nowMs) {
      return {
        allowed: false,
        reason: "cache_fresh",
        retryAfterMs: expiresMs - nowMs,
      };
    }
  }

  const lastRow = db
    .prepare(
      `SELECT attempted_at FROM source_fetch_log
         WHERE source_id = ? AND cache_key = ?
         ORDER BY attempted_at DESC, id DESC
         LIMIT 1`,
    )
    .get(sourceId, cacheKey) as { attempted_at: string } | undefined;
  if (lastRow) {
    const lastMs = parseIso(lastRow.attempted_at, "attempted_at");
    const elapsed = nowMs - lastMs;
    if (elapsed < input.minIntervalMs) {
      return {
        allowed: false,
        reason: "recent_attempt",
        retryAfterMs: input.minIntervalMs - elapsed,
      };
    }
  }

  return { allowed: true };
}

export function upsertSourceCacheEntry(
  db: Db,
  input: SourceCacheUpsertInput,
): SourceCacheEntry {
  const sourceId = validateSourceId(input.sourceId);
  const cacheKey = validateCacheKey(input.cacheKey);
  const fetchedAtMs = parseIso(input.fetchedAt, "fetchedAt");
  const expiresAtMs = parseIso(input.expiresAt, "expiresAt");
  if (expiresAtMs < fetchedAtMs) {
    throw new Error("expiresAt must be >= fetchedAt");
  }
  const status = validateStatus(input.status);
  const bodySha256 = validateOptionalSha256(input.bodySha256);
  const metadata = validateMetadata(input.metadata);
  const metadataJson = metadata === null ? null : JSON.stringify(metadata);
  const candidatesJson = validateOptionalCandidatesJson(input.candidatesJson);

  db.prepare(
    `INSERT INTO source_cache
       (source_id, cache_key, fetched_at, expires_at, status, body_sha256, metadata_json, candidates_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(source_id, cache_key) DO UPDATE SET
         fetched_at = excluded.fetched_at,
         expires_at = excluded.expires_at,
         status = excluded.status,
         body_sha256 = excluded.body_sha256,
         metadata_json = excluded.metadata_json,
         candidates_json = excluded.candidates_json`,
  ).run(
    sourceId,
    cacheKey,
    input.fetchedAt,
    input.expiresAt,
    status,
    bodySha256,
    metadataJson,
    candidatesJson,
  );

  const row = db
    .prepare(
      `SELECT source_id, cache_key, fetched_at, expires_at, status,
              body_sha256, metadata_json, candidates_json
         FROM source_cache
         WHERE source_id = ? AND cache_key = ?`,
    )
    .get(sourceId, cacheKey) as
    | {
        source_id: string;
        cache_key: string;
        fetched_at: string;
        expires_at: string;
        status: string;
        body_sha256: string | null;
        metadata_json: string | null;
        candidates_json: string | null;
      }
    | undefined;
  if (!row) {
    throw new Error("source_cache row missing after upsert");
  }
  return rowToCacheEntry(row);
}

export function getSourceCacheEntry(
  db: Db,
  sourceId: string,
  cacheKey: string,
  now: string = nowIso(),
): SourceCacheLookup | null {
  validateSourceId(sourceId);
  validateCacheKey(cacheKey);
  const nowMs = parseIso(now, "now");
  const row = db
    .prepare(
      `SELECT source_id, cache_key, fetched_at, expires_at, status,
              body_sha256, metadata_json, candidates_json
         FROM source_cache
         WHERE source_id = ? AND cache_key = ?`,
    )
    .get(sourceId, cacheKey) as
    | {
        source_id: string;
        cache_key: string;
        fetched_at: string;
        expires_at: string;
        status: string;
        body_sha256: string | null;
        metadata_json: string | null;
        candidates_json: string | null;
      }
    | undefined;
  if (!row) return null;
  const entry = rowToCacheEntry(row);
  const expiresMs = parseIso(entry.expiresAt, "expires_at");
  const fresh = expiresMs > nowMs;
  return { entry, fresh, expired: !fresh };
}

export function pruneExpiredSourceCache(
  db: Db,
  now: string = nowIso(),
): { deleted: number } {
  parseIso(now, "now");
  const result = db
    .prepare(`DELETE FROM source_cache WHERE expires_at <= ?`)
    .run(now);
  return { deleted: result.changes };
}

export function getSourceCacheSummary(
  db: Db,
  now: string = nowIso(),
): SourceCacheSummaryRow[] {
  parseIso(now, "now");
  const rows = db
    .prepare(
      `SELECT s.id AS source_id,
              COUNT(c.cache_key) AS total,
              SUM(CASE WHEN c.expires_at > ? THEN 1 ELSE 0 END) AS fresh,
              SUM(CASE WHEN c.expires_at <= ? THEN 1 ELSE 0 END) AS expired,
              MAX(c.fetched_at) AS last_fetched_at
         FROM coupon_sources s
         LEFT JOIN source_cache c ON c.source_id = s.id
         GROUP BY s.id
         ORDER BY s.id ASC`,
    )
    .all(now, now) as Array<{
    source_id: string;
    total: number | null;
    fresh: number | null;
    expired: number | null;
    last_fetched_at: string | null;
  }>;
  return rows.map((r) => ({
    sourceId: r.source_id,
    total: Number(r.total ?? 0),
    fresh: Number(r.fresh ?? 0),
    expired: Number(r.expired ?? 0),
    lastFetchedAt: r.last_fetched_at,
  }));
}
