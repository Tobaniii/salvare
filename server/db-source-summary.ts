// Admin source/provenance summary helper (v0.37.0).
//
// Read-only aggregation over `stores`, `coupon_codes`, `coupon_code_sources`,
// and `coupon_sources` so a local admin can inspect which sources claim which
// codes for a domain. Visibility-only: this module executes SELECT statements
// only — no INSERT/UPDATE/DELETE.
//
// Output is built from a strict allowlist of provenance fields. `sourceUrl`
// is deliberately omitted because the column is not yet sanitizer-gated and
// may carry affiliate or tracking content in future writers. Raw provider
// payloads, headers, env vars, DB paths, cookies, API keys, raw HTML, and
// stack traces are never read by this helper and so cannot reach callers.
//
// Bounded by `MAX_CODES = 500` to keep response sizes predictable. If the
// store has more rows the response carries `truncated: true` and the codes
// array stops at the cap (ordered by coupon_codes.id ascending). The
// per-source `sourceSummary` counts reflect the **same truncated slice** so
// the two arrays stay internally consistent; the caller can re-fetch with a
// future paging parameter if/when that lands.

import type { Db } from "./db";
import type { CouponSourceType } from "./db";

export const SOURCE_SUMMARY_CODE_CAP = 500;

export interface SourceSummarySourceClaim {
  sourceId: string;
  sourceName: string;
  sourceType: CouponSourceType;
  discoveredAt: string;
  label?: string;
  expiresAt?: string;
  confidence?: number;
}

export interface SourceSummaryCodeEntry {
  code: string;
  sources: SourceSummarySourceClaim[];
}

export interface SourceSummarySourceCount {
  sourceId: string;
  sourceName: string;
  sourceType: CouponSourceType;
  codeCount: number;
}

export interface SourceSummary {
  domain: string;
  storeId: number | null;
  codeCount: number;
  sourceCount: number;
  truncated: boolean;
  codes: SourceSummaryCodeEntry[];
  sourceSummary: SourceSummarySourceCount[];
}

interface StoreRow {
  id: number;
}

interface JoinRow {
  code_id: number;
  code: string;
  source_id: string | null;
  source_name: string | null;
  source_type: string | null;
  discovered_at: string | null;
  label: string | null;
  expires_at: string | null;
  confidence: number | null;
}

export function getSourceSummaryForDomain(
  db: Db,
  rawDomain: string,
): SourceSummary {
  const domain = rawDomain.trim();
  const storeRow = db
    .prepare(`SELECT id FROM stores WHERE domain = ?`)
    .get(domain) as StoreRow | undefined;

  if (!storeRow) {
    return {
      domain,
      storeId: null,
      codeCount: 0,
      sourceCount: 0,
      truncated: false,
      codes: [],
      sourceSummary: [],
    };
  }

  const totalCodes = (
    db
      .prepare(`SELECT COUNT(*) AS n FROM coupon_codes WHERE store_id = ?`)
      .get(storeRow.id) as { n: number }
  ).n;
  const truncated = totalCodes > SOURCE_SUMMARY_CODE_CAP;
  const includedCodeCount = Math.min(totalCodes, SOURCE_SUMMARY_CODE_CAP);

  // Select coupon_codes (bounded) joined to coupon_code_sources +
  // coupon_sources. LEFT JOIN so codes without any provenance still appear
  // in the result with an empty sources[]. Order: code ascending, source
  // ascending for deterministic output.
  const joinRows = db
    .prepare(
      `WITH bounded_codes AS (
         SELECT id, code
           FROM coupon_codes
          WHERE store_id = ?
          ORDER BY id ASC
          LIMIT ?
       )
       SELECT bc.id           AS code_id,
              bc.code         AS code,
              s.id            AS source_id,
              s.name          AS source_name,
              s.type          AS source_type,
              ccs.discovered_at AS discovered_at,
              ccs.label       AS label,
              ccs.expires_at  AS expires_at,
              ccs.confidence  AS confidence
         FROM bounded_codes bc
         LEFT JOIN coupon_code_sources ccs
                ON ccs.store_id = ? AND ccs.code = bc.code
         LEFT JOIN coupon_sources s
                ON s.id = ccs.source_id
         ORDER BY bc.id ASC, s.id ASC`,
    )
    .all(storeRow.id, SOURCE_SUMMARY_CODE_CAP, storeRow.id) as JoinRow[];

  const codes: SourceSummaryCodeEntry[] = [];
  const byCodeId = new Map<number, SourceSummaryCodeEntry>();
  const sourceCounts = new Map<
    string,
    { sourceName: string; sourceType: CouponSourceType; codeCount: number }
  >();
  const sourceCodeSeen = new Map<string, Set<number>>();

  for (const row of joinRows) {
    let entry = byCodeId.get(row.code_id);
    if (!entry) {
      entry = { code: row.code, sources: [] };
      byCodeId.set(row.code_id, entry);
      codes.push(entry);
    }
    if (row.source_id === null || row.source_name === null || row.source_type === null) {
      continue;
    }
    const claim: SourceSummarySourceClaim = {
      sourceId: row.source_id,
      sourceName: row.source_name,
      sourceType: row.source_type as CouponSourceType,
      discoveredAt: row.discovered_at ?? "",
    };
    if (row.label !== null) claim.label = row.label;
    if (row.expires_at !== null) claim.expiresAt = row.expires_at;
    if (row.confidence !== null) claim.confidence = row.confidence;
    entry.sources.push(claim);

    let seen = sourceCodeSeen.get(row.source_id);
    if (!seen) {
      seen = new Set<number>();
      sourceCodeSeen.set(row.source_id, seen);
    }
    if (!seen.has(row.code_id)) {
      seen.add(row.code_id);
      const existing = sourceCounts.get(row.source_id);
      if (existing) {
        existing.codeCount += 1;
      } else {
        sourceCounts.set(row.source_id, {
          sourceName: row.source_name,
          sourceType: row.source_type as CouponSourceType,
          codeCount: 1,
        });
      }
    }
  }

  const sourceSummary: SourceSummarySourceCount[] = Array.from(
    sourceCounts.entries(),
  )
    .map(([sourceId, info]) => ({
      sourceId,
      sourceName: info.sourceName,
      sourceType: info.sourceType,
      codeCount: info.codeCount,
    }))
    .sort((a, b) => a.sourceId.localeCompare(b.sourceId));

  return {
    domain,
    storeId: storeRow.id,
    codeCount: includedCodeCount,
    sourceCount: sourceSummary.length,
    truncated,
    codes,
    sourceSummary,
  };
}
