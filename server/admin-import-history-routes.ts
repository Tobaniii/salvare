// Admin provider import-history boundary (v0.46.0).
//
// Read-only, admin-protected GET /admin/import-history. Surfaces the
// append-only `import_history` audit rows written by the v0.36/v0.45 import
// route. The handler executes zero writes and exposes no mutation verb.
//
// Per docs/SOURCE_POLICY.md §6 and the redaction rules in
// docs/SOURCE_PROVIDER_RESEARCH.md §5, the response is built from an explicit
// allowlist below: id, providerId, sourceId, domain, attemptedAt, outcome,
// candidatesAccepted, codesImported, provenanceRecorded, rejectedCount,
// errorCode, durationMs. The table has no body/header/credential/token/URL
// columns by construction; `outcome` is re-checked against a fixed set and
// `errorCode` against the short-token pattern as defence-in-depth, mirroring
// admin-source-status-routes.ts.
//
// Optional query filters: `provider` (must be a known registry provider id —
// unknown fails closed 400), `from`/`to` (ISO timestamps, invalid → 400).

import { sendJson, type RouteContext } from "./http-helpers";
import {
  getImportHistory,
  type ProviderImportLogRow,
} from "./db-source-import";

export type IsKnownProvider = (providerId: string) => boolean;

const ALLOWED_OUTCOMES = new Set(["ok", "empty", "error"]);
const ERROR_CODE_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;

function safeOutcome(value: string): ProviderImportLogRow["outcome"] | null {
  return ALLOWED_OUTCOMES.has(value)
    ? (value as ProviderImportLogRow["outcome"])
    : null;
}

function safeErrorCode(value: string | null): string | null {
  if (value === null) return null;
  return ERROR_CODE_PATTERN.test(value) ? value : null;
}

function buildSafeRow(row: ProviderImportLogRow): ProviderImportLogRow {
  return {
    id: Number(row.id),
    providerId: row.providerId,
    sourceId: row.sourceId,
    domain: row.domain,
    attemptedAt: row.attemptedAt,
    outcome:
      (safeOutcome(row.outcome) as ProviderImportLogRow["outcome"]) ??
      "error",
    candidatesAccepted: Number(row.candidatesAccepted),
    codesImported: Number(row.codesImported),
    provenanceRecorded: Number(row.provenanceRecorded),
    rejectedCount: Number(row.rejectedCount),
    errorCode: safeErrorCode(row.errorCode),
    durationMs: row.durationMs === null ? null : Number(row.durationMs),
  };
}

function isValidIso(value: string): boolean {
  return !Number.isNaN(Date.parse(value));
}

export function handleAdminImportHistoryRoute(
  ctx: RouteContext,
  isKnownProvider: IsKnownProvider,
): boolean {
  const { db, req, res, url, requireAuth } = ctx;

  if (req.method !== "GET" || url.pathname !== "/admin/import-history") {
    return false;
  }
  if (!requireAuth(req, res)) return true;

  const providerParam = url.searchParams.get("provider");
  const fromParam = url.searchParams.get("from");
  const toParam = url.searchParams.get("to");

  if (providerParam !== null && !isKnownProvider(providerParam)) {
    // Fail closed — unknown provider filter never reaches the query and the
    // raw value is not echoed.
    sendJson(res, 400, { ok: false, error: "invalid provider" });
    return true;
  }
  if (fromParam !== null && !isValidIso(fromParam)) {
    sendJson(res, 400, { ok: false, error: "invalid from" });
    return true;
  }
  if (toParam !== null && !isValidIso(toParam)) {
    sendJson(res, 400, { ok: false, error: "invalid to" });
    return true;
  }

  const result = getImportHistory(db, {
    provider: providerParam ?? undefined,
    from: fromParam ?? undefined,
    to: toParam ?? undefined,
  });

  sendJson(res, 200, {
    rows: result.rows.map(buildSafeRow),
    truncated: result.truncated,
  });
  return true;
}
