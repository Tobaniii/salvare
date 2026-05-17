// SELECT-only provenance reader for the additive, optional /coupons
// `candidateProvenance` field (v0.50.0). Reads a domain's
// coupon_code_sources + coupon_sources rows using **only** the allowlisted
// display fields — the coupon `code`, the source `type` (NOT the internal
// `source_id`), `confidence`, and `discovered_at`. Writes nothing.
//
// `source_id`, `source_url`, `label`, `expires_at`, raw provider payloads,
// API keys, env vars, and DB paths are NOT part of the prepared statement
// and cannot leak into the response even if smuggled into a source row.
// The collapse/allowlist projection lives in coupons.ts (buildSafeProvenance).

import type { Db } from "./db";

export interface RawProvenanceClaim {
  sourceType: string;
  confidence: number | null;
  discoveredAt: string | null;
}

interface ProvenanceRow {
  code: string;
  source_type: string;
  confidence: number | null;
  discovered_at: string | null;
}

export function getCandidateProvenanceForDomain(
  db: Db,
  domain: string,
): Map<string, RawProvenanceClaim[]> {
  const claimsByCode = new Map<string, RawProvenanceClaim[]>();

  const storeRow = db
    .prepare(`SELECT id FROM stores WHERE domain = ?`)
    .get(domain) as { id: number } | undefined;
  if (!storeRow) return claimsByCode;

  const rows = db
    .prepare(
      `SELECT ccs.code          AS code,
              s.type            AS source_type,
              ccs.confidence    AS confidence,
              ccs.discovered_at AS discovered_at
         FROM coupon_code_sources ccs
         JOIN coupon_sources s ON s.id = ccs.source_id
        WHERE ccs.store_id = ?
        ORDER BY ccs.id ASC`,
    )
    .all(storeRow.id) as ProvenanceRow[];

  for (const row of rows) {
    const claim: RawProvenanceClaim = {
      sourceType: row.source_type,
      confidence: row.confidence,
      discoveredAt: row.discovered_at,
    };
    const existing = claimsByCode.get(row.code);
    if (existing) existing.push(claim);
    else claimsByCode.set(row.code, [claim]);
  }

  return claimsByCode;
}
