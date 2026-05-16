// Additive provider-candidate import (v0.36.0).
//
// Writes candidate codes for a single store **without** deleting existing
// coupon_codes rows or non-Awin provenance. Used by the admin source-import
// route. Re-import is idempotent: a coupon_codes row already present for the
// store is reused (no duplicate row inserted); a coupon_code_sources row
// already present for (store, code, source_id) is reused (no duplicate
// provenance row inserted). Non-Awin provenance rows for the same code are
// untouched. coupon_results is never read, written, or deleted here.
//
// This module is intentionally narrow: it does not run validation on
// candidate fields — callers must pass already-validated candidates (the
// admin-source-import route does this server-side after re-deriving the
// candidate list from the v0.32/v0.33 Awin adapter, not from client input).
// The helper only enforces structural DB constraints already enforced by
// db-sources.recordCouponCodeSource.
//
// No DB schema change. No new tables. No new indexes.
//
// Per docs/SOURCE_POLICY.md §3.5 and the redaction rules in
// docs/SOURCE_PROVIDER_RESEARCH.md, this module never persists raw provider
// payloads, affiliate/tracking fields, headers, env vars, DB paths, or
// stack traces. Inputs are already-validated, allowlisted candidate fields
// only.

import type { Db, CouponSourceType } from "./db";
import {
  ensureCouponSource,
  recordCouponCodeSource,
  validateSourceId,
} from "./db-sources";
import { validateDomain } from "./source-adapters";

export interface ProviderImportCandidate {
  domain: string;
  code: string;
  label?: string;
  expiresAt?: string;
}

export interface ProviderImportInput {
  sourceId: string;
  sourceName: string;
  sourceType: CouponSourceType;
  domain: string;
  candidates: readonly ProviderImportCandidate[];
  now?: string;
}

export interface ProviderImportStats {
  domain: string;
  sourceId: string;
  candidatesAccepted: number;
  codesImported: number;
  provenanceRecorded: number;
}

function nowIso(): string {
  return new Date().toISOString();
}

export function importProviderCandidates(
  db: Db,
  input: ProviderImportInput,
): ProviderImportStats {
  const now = input.now ?? nowIso();
  const trimmedDomain = input.domain.trim();

  // Dedupe by code in input order; first occurrence wins.
  const dedupedCandidates: ProviderImportCandidate[] = [];
  const seenCodes = new Set<string>();
  for (const candidate of input.candidates) {
    const code = candidate.code.trim();
    if (code.length === 0 || seenCodes.has(code)) continue;
    seenCodes.add(code);
    dedupedCandidates.push({ ...candidate, code });
  }

  const upsertStore = db.prepare(
    `INSERT INTO stores (domain, created_at, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(domain) DO UPDATE SET updated_at = excluded.updated_at`,
  );
  const lookupStore = db.prepare(`SELECT id FROM stores WHERE domain = ?`);
  const lookupCode = db.prepare(
    `SELECT id FROM coupon_codes WHERE store_id = ? AND code = ?`,
  );
  const insertCode = db.prepare(
    `INSERT INTO coupon_codes (store_id, code, created_at, updated_at)
       VALUES (?, ?, ?, ?)`,
  );
  const lookupProvenance = db.prepare(
    `SELECT id FROM coupon_code_sources
       WHERE store_id = ? AND code = ? AND source_id = ?`,
  );

  let codesImported = 0;
  let provenanceRecorded = 0;

  const txn = db.transaction(() => {
    ensureCouponSource(
      db,
      { id: input.sourceId, name: input.sourceName, type: input.sourceType },
      now,
    );

    upsertStore.run(trimmedDomain, now, now);
    const storeRow = lookupStore.get(trimmedDomain) as
      | { id: number }
      | undefined;
    if (!storeRow) {
      throw new Error("store row missing after upsert");
    }

    for (const candidate of dedupedCandidates) {
      const existingCode = lookupCode.get(storeRow.id, candidate.code) as
        | { id: number }
        | undefined;
      if (!existingCode) {
        insertCode.run(storeRow.id, candidate.code, now, now);
        codesImported += 1;
      }

      const existingProvenance = lookupProvenance.get(
        storeRow.id,
        candidate.code,
        input.sourceId,
      ) as { id: number } | undefined;
      if (!existingProvenance) {
        recordCouponCodeSource(db, {
          storeId: storeRow.id,
          code: candidate.code,
          sourceId: input.sourceId,
          discoveredAt: now,
          label: candidate.label ?? null,
          expiresAt: candidate.expiresAt ?? null,
        });
        provenanceRecorded += 1;
      }
    }
  });
  txn();

  return {
    domain: trimmedDomain,
    sourceId: input.sourceId,
    candidatesAccepted: dedupedCandidates.length,
    codesImported,
    provenanceRecorded,
  };
}

// ---------------------------------------------------------------------------
// Provider import history / audit trail (v0.46.0).
//
// Append-only, redacted-by-construction record of REAL import attempts only
// (passed auth + provider resolution). Modeled on recordSourceFetchAttempt
// (db-source-cache.ts): every field is validated and allowlisted; no raw
// payloads, headers, credentials, tokens, URLs, or free-text error messages
// ever reach the table. `error_code` is an allowlisted short token only.
// `source_id` is nullable: a resolved-but-failed attempt logs provider_id
// alone (the adapter may not have registered the coupon_sources row yet).
// ---------------------------------------------------------------------------

const IMPORT_OUTCOMES = ["ok", "empty", "error"] as const;
export type ProviderImportOutcome = (typeof IMPORT_OUTCOMES)[number];

const IMPORT_ERROR_CODE_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const PROVIDER_ID_PATTERN = /^[a-z0-9-]{1,32}$/;
const IMPORT_HISTORY_LIMIT = 500;

export interface ProviderImportAttemptInput {
  providerId: string;
  sourceId?: string | null;
  domain: string;
  outcome: ProviderImportOutcome;
  candidatesAccepted: number;
  codesImported: number;
  provenanceRecorded: number;
  rejectedCount: number;
  errorCode?: string | null;
  durationMs?: number | null;
  attemptedAt?: string;
}

export interface ProviderImportLogRow {
  id: number;
  providerId: string;
  sourceId: string | null;
  domain: string;
  attemptedAt: string;
  outcome: ProviderImportOutcome;
  candidatesAccepted: number;
  codesImported: number;
  provenanceRecorded: number;
  rejectedCount: number;
  errorCode: string | null;
  durationMs: number | null;
}

export interface ImportHistoryFilters {
  provider?: string;
  from?: string;
  to?: string;
}

export interface ImportHistoryResult {
  rows: ProviderImportLogRow[];
  truncated: boolean;
}

function parseIso(value: string, field: string): number {
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) {
    throw new Error(`invalid ${field}`);
  }
  return ms;
}

function validateProviderId(value: unknown): string {
  if (typeof value !== "string" || !PROVIDER_ID_PATTERN.test(value)) {
    throw new Error("invalid providerId");
  }
  return value;
}

function validateOutcome(value: unknown): ProviderImportOutcome {
  if (
    typeof value !== "string" ||
    !(IMPORT_OUTCOMES as readonly string[]).includes(value)
  ) {
    throw new Error("invalid outcome");
  }
  return value as ProviderImportOutcome;
}

function validateCount(value: unknown, field: string): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 0
  ) {
    throw new Error(`invalid ${field}`);
  }
  return value;
}

function validateOptionalErrorCode(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || !IMPORT_ERROR_CODE_PATTERN.test(value)) {
    throw new Error("invalid errorCode");
  }
  return value;
}

function validateOptionalDurationMs(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 0
  ) {
    throw new Error("invalid durationMs");
  }
  return value;
}

function rowToImportLog(row: {
  id: number;
  provider_id: string;
  source_id: string | null;
  domain: string;
  attempted_at: string;
  outcome: string;
  candidates_accepted: number;
  codes_imported: number;
  provenance_recorded: number;
  rejected_count: number;
  error_code: string | null;
  duration_ms: number | null;
}): ProviderImportLogRow {
  return {
    id: row.id,
    providerId: row.provider_id,
    sourceId: row.source_id,
    domain: row.domain,
    attemptedAt: row.attempted_at,
    outcome: row.outcome as ProviderImportOutcome,
    candidatesAccepted: row.candidates_accepted,
    codesImported: row.codes_imported,
    provenanceRecorded: row.provenance_recorded,
    rejectedCount: row.rejected_count,
    errorCode: row.error_code,
    durationMs: row.duration_ms,
  };
}

export function recordProviderImportAttempt(
  db: Db,
  input: ProviderImportAttemptInput,
  now: string = nowIso(),
): ProviderImportLogRow {
  const providerId = validateProviderId(input.providerId);
  const sourceId =
    input.sourceId === undefined || input.sourceId === null
      ? null
      : validateSourceId(input.sourceId);
  const domain = validateDomain(input.domain);
  if (domain === null) {
    throw new Error("invalid domain");
  }
  const outcome = validateOutcome(input.outcome);
  const candidatesAccepted = validateCount(
    input.candidatesAccepted,
    "candidatesAccepted",
  );
  const codesImported = validateCount(input.codesImported, "codesImported");
  const provenanceRecorded = validateCount(
    input.provenanceRecorded,
    "provenanceRecorded",
  );
  const rejectedCount = validateCount(input.rejectedCount, "rejectedCount");
  const errorCode = validateOptionalErrorCode(input.errorCode);
  const durationMs = validateOptionalDurationMs(input.durationMs);
  const attemptedAt = input.attemptedAt ?? now;
  parseIso(attemptedAt, "attemptedAt");

  const result = db
    .prepare(
      `INSERT INTO import_history
         (provider_id, source_id, domain, attempted_at, outcome,
          candidates_accepted, codes_imported, provenance_recorded,
          rejected_count, error_code, duration_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      providerId,
      sourceId,
      domain,
      attemptedAt,
      outcome,
      candidatesAccepted,
      codesImported,
      provenanceRecorded,
      rejectedCount,
      errorCode,
      durationMs,
    );

  const row = db
    .prepare(
      `SELECT id, provider_id, source_id, domain, attempted_at, outcome,
              candidates_accepted, codes_imported, provenance_recorded,
              rejected_count, error_code, duration_ms
         FROM import_history WHERE id = ?`,
    )
    .get(Number(result.lastInsertRowid)) as
    | {
        id: number;
        provider_id: string;
        source_id: string | null;
        domain: string;
        attempted_at: string;
        outcome: string;
        candidates_accepted: number;
        codes_imported: number;
        provenance_recorded: number;
        rejected_count: number;
        error_code: string | null;
        duration_ms: number | null;
      }
    | undefined;
  if (!row) {
    throw new Error("import_history row missing after insert");
  }
  return rowToImportLog(row);
}

/**
 * SELECT-only history reader for `GET /admin/import-history`. Filters are
 * pre-validated by the caller (provider against the registry; from/to ISO);
 * this function additionally re-validates ISO bounds and caps the result at
 * IMPORT_HISTORY_LIMIT, setting `truncated` when more rows exist.
 */
export function getImportHistory(
  db: Db,
  filters: ImportHistoryFilters = {},
): ImportHistoryResult {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filters.provider !== undefined) {
    where.push("provider_id = ?");
    params.push(validateProviderId(filters.provider));
  }
  if (filters.from !== undefined) {
    parseIso(filters.from, "from");
    where.push("attempted_at >= ?");
    params.push(filters.from);
  }
  if (filters.to !== undefined) {
    parseIso(filters.to, "to");
    where.push("attempted_at <= ?");
    params.push(filters.to);
  }
  const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
  const rows = db
    .prepare(
      `SELECT id, provider_id, source_id, domain, attempted_at, outcome,
              candidates_accepted, codes_imported, provenance_recorded,
              rejected_count, error_code, duration_ms
         FROM import_history
         ${whereSql}
         ORDER BY attempted_at DESC, id DESC
         LIMIT ?`,
    )
    .all(...params, IMPORT_HISTORY_LIMIT + 1) as Array<
    Parameters<typeof rowToImportLog>[0]
  >;
  const truncated = rows.length > IMPORT_HISTORY_LIMIT;
  return {
    rows: rows.slice(0, IMPORT_HISTORY_LIMIT).map(rowToImportLog),
    truncated,
  };
}
