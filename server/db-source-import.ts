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

import type { Db } from "./db";
import {
  ensureCouponSource,
  recordCouponCodeSource,
  type CouponSourceType,
} from "./db-sources";

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
