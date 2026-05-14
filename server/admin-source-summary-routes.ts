// Admin source/provenance summary boundary (v0.37.0).
//
// Read-only admin endpoint that surfaces which sources claim which codes for
// a given domain. Wraps `getSourceSummaryForDomain` and a strict response
// allowlist so the route cannot accidentally leak the API key, the
// `Authorization` header, raw provider payloads, raw HTML, env vars, the DB
// path, stack traces, affiliate/tracking fields, or `sourceUrl`.
//
// This route writes nothing. It executes SELECTs through the helper only.

import { sendJson, type RouteContext } from "./http-helpers";
import { validateDomain } from "./source-adapters";
import {
  getSourceSummaryForDomain,
  type SourceSummary,
  type SourceSummaryCodeEntry,
  type SourceSummarySourceClaim,
  type SourceSummarySourceCount,
} from "./db-source-summary";

function buildSafeClaim(
  claim: SourceSummarySourceClaim,
): SourceSummarySourceClaim {
  const out: SourceSummarySourceClaim = {
    sourceId: claim.sourceId,
    sourceName: claim.sourceName,
    sourceType: claim.sourceType,
    discoveredAt: claim.discoveredAt,
  };
  if (claim.label !== undefined) out.label = claim.label;
  if (claim.expiresAt !== undefined) out.expiresAt = claim.expiresAt;
  if (claim.confidence !== undefined) out.confidence = claim.confidence;
  return out;
}

function buildSafeCodes(
  entries: SourceSummaryCodeEntry[],
): SourceSummaryCodeEntry[] {
  return entries.map((entry) => ({
    code: entry.code,
    sources: entry.sources.map(buildSafeClaim),
  }));
}

function buildSafeSourceSummary(
  rows: SourceSummarySourceCount[],
): SourceSummarySourceCount[] {
  return rows.map((row) => ({
    sourceId: row.sourceId,
    sourceName: row.sourceName,
    sourceType: row.sourceType,
    codeCount: row.codeCount,
  }));
}

function buildSafeResponse(summary: SourceSummary): SourceSummary {
  return {
    domain: summary.domain,
    storeId: summary.storeId,
    codeCount: summary.codeCount,
    sourceCount: summary.sourceCount,
    truncated: summary.truncated,
    codes: buildSafeCodes(summary.codes),
    sourceSummary: buildSafeSourceSummary(summary.sourceSummary),
  };
}

export function handleAdminSourceSummaryRoute(ctx: RouteContext): boolean {
  const { db, req, res, url, requireAuth } = ctx;

  if (req.method !== "GET" || url.pathname !== "/admin/source-summary") {
    return false;
  }
  if (!requireAuth(req, res)) return true;

  const rawDomain = url.searchParams.get("domain");
  if (typeof rawDomain !== "string") {
    sendJson(res, 400, { ok: false, error: "invalid domain" });
    return true;
  }
  const domain = validateDomain(rawDomain);
  if (domain === null) {
    sendJson(res, 400, { ok: false, error: "invalid domain" });
    return true;
  }

  const summary = getSourceSummaryForDomain(db, domain);
  sendJson(res, 200, buildSafeResponse(summary));
  return true;
}
