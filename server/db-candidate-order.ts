// SELECT-only DB wrapper that feeds the v0.38.0 source-aware ordering
// helper. Reads coupon_codes for a domain plus their coupon_code_sources +
// coupon_sources claims, builds a per-code claim list using **only**
// the allowlisted scoring fields (`sourceId`, `sourceType`, `confidence`,
// `discoveredAt`), and returns the reordered code list. Writes nothing.
//
// The route-level caller passes the result into the existing
// `rankCandidateCodes` so past-result history continues to dominate. This
// module never reads `source_url`, raw provider payloads, env vars, or
// API keys — those columns are not part of the prepared statement.

import type { Db } from "./db";
import type { CouponSourceType } from "./db";
import {
  orderCandidatesBySource,
  type CandidateOrderOptions,
  type CandidateSourceClaim,
} from "./candidate-order";

interface ClaimRow {
  code: string;
  source_id: string;
  source_type: string;
  confidence: number | null;
  discovered_at: string | null;
}

export function getSourceAwareCandidateOrder(
  db: Db,
  domain: string,
  codes: readonly string[],
  options: CandidateOrderOptions = {},
): string[] {
  if (codes.length === 0) return [];

  const storeRow = db
    .prepare(`SELECT id FROM stores WHERE domain = ?`)
    .get(domain) as { id: number } | undefined;
  if (!storeRow) {
    return [...codes];
  }

  const rows = db
    .prepare(
      `SELECT ccs.code         AS code,
              ccs.source_id    AS source_id,
              s.type           AS source_type,
              ccs.confidence   AS confidence,
              ccs.discovered_at AS discovered_at
         FROM coupon_code_sources ccs
         JOIN coupon_sources s ON s.id = ccs.source_id
        WHERE ccs.store_id = ?`,
    )
    .all(storeRow.id) as ClaimRow[];

  const claimsByCode = new Map<string, CandidateSourceClaim[]>();
  for (const row of rows) {
    const claim: CandidateSourceClaim = {
      sourceId: row.source_id,
      sourceType: row.source_type as CouponSourceType,
    };
    if (row.confidence !== null) claim.confidence = row.confidence;
    if (row.discovered_at !== null) claim.discoveredAt = row.discovered_at;

    const existing = claimsByCode.get(row.code);
    if (existing) existing.push(claim);
    else claimsByCode.set(row.code, [claim]);
  }

  return orderCandidatesBySource(codes, claimsByCode, options).orderedCodes;
}
