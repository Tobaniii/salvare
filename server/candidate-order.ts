// Source-aware candidate test-order helper (v0.38.0).
//
// Pure, deterministic, IO-free. Takes the existing string[] of candidate
// codes (in DB-insertion order) plus a per-code list of normalized source
// claims, and returns a re-ordered string[] where higher-scoring codes come
// earlier. Score is bounded and only ever influences **test order**:
// downstream code (server/ranking.ts → rankCandidateCodes) still re-orders
// by past-result bucket with `seedIndex` as the tie-break, so source order
// only affects untested or history-tied codes. Final winner selection at
// checkout still uses observed `finalTotalCents` — this helper cannot
// override a verified checkout result.
//
// Affiliate/tracking fields, source URLs, API keys, env vars, DB paths,
// raw provider payloads, and stack traces are **not** read by this module
// and cannot influence ordering even if smuggled into the input — only
// the explicit allowlist (`sourceId`, `sourceType`, `confidence`,
// `discoveredAt`) is considered.

import type { CouponSourceType } from "./db";

export interface CandidateSourceClaim {
  sourceId: string;
  sourceType: CouponSourceType;
  confidence?: number;
  discoveredAt?: string;
}

export interface CandidateOrderOptions {
  /** Injectable clock so tests are deterministic. Defaults to wall time. */
  now?: () => Date;
  /** When true, return per-code scoring explanations for debug/tests only. */
  withExplanations?: boolean;
}

export interface CandidateExplanation {
  code: string;
  score: number;
  confidence: number;
  sourceTypeScore: number;
  multiSourceBonus: number;
  freshnessScore: number;
  distinctSources: number;
}

export interface CandidateOrderResult {
  orderedCodes: string[];
  explanations?: CandidateExplanation[];
}

const SOURCE_TYPE_SCORE: Record<CouponSourceType, number> = {
  manual: 30,
  import: 20,
  api: 15,
  feed: 15,
  seed: 10,
};

const MULTI_SOURCE_BONUS_PER_EXTRA = 5;
const MULTI_SOURCE_BONUS_CAP = 15;
const FRESHNESS_MAX = 10;
const FRESHNESS_DECAY_DAYS = 10;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function safeConfidence(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 100) return 100;
  return value;
}

function safeSourceTypeScore(type: CouponSourceType | undefined): number {
  if (type === undefined) return 0;
  return SOURCE_TYPE_SCORE[type] ?? 0;
}

function freshnessFromDate(
  iso: string | undefined,
  now: Date,
): number {
  if (typeof iso !== "string" || iso.length === 0) return 0;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return 0;
  const days = Math.max(0, (now.getTime() - t) / MS_PER_DAY);
  if (days >= FRESHNESS_DECAY_DAYS) return 0;
  return FRESHNESS_MAX - days;
}

function scoreCodeClaims(
  claims: readonly CandidateSourceClaim[],
  now: Date,
): Omit<CandidateExplanation, "code"> {
  if (claims.length === 0) {
    return {
      score: 0,
      confidence: 0,
      sourceTypeScore: 0,
      multiSourceBonus: 0,
      freshnessScore: 0,
      distinctSources: 0,
    };
  }
  let maxConfidence = 0;
  let maxSourceTypeScore = 0;
  let maxFreshness = 0;
  const distinct = new Set<string>();
  for (const claim of claims) {
    distinct.add(claim.sourceId);
    const c = safeConfidence(claim.confidence);
    if (c > maxConfidence) maxConfidence = c;
    const t = safeSourceTypeScore(claim.sourceType);
    if (t > maxSourceTypeScore) maxSourceTypeScore = t;
    const f = freshnessFromDate(claim.discoveredAt, now);
    if (f > maxFreshness) maxFreshness = f;
  }
  const distinctSources = distinct.size;
  const multiSourceBonus = Math.min(
    Math.max(0, distinctSources - 1) * MULTI_SOURCE_BONUS_PER_EXTRA,
    MULTI_SOURCE_BONUS_CAP,
  );
  const score =
    maxConfidence + maxSourceTypeScore + multiSourceBonus + maxFreshness;
  return {
    score,
    confidence: maxConfidence,
    sourceTypeScore: maxSourceTypeScore,
    multiSourceBonus,
    freshnessScore: maxFreshness,
    distinctSources,
  };
}

/**
 * Re-order `codes` so higher-scoring source-claimed codes come earlier.
 * The score is built from an explicit allowlist of claim fields only —
 * affiliate metadata, source URLs, raw payloads, etc. are ignored even if
 * present in the input. Ties preserve input order (stable sort), and codes
 * not present in `claimsByCode` (or with empty claim lists) score 0 and
 * keep their original position relative to other zero-score codes.
 */
export function orderCandidatesBySource(
  codes: readonly string[],
  claimsByCode: ReadonlyMap<string, readonly CandidateSourceClaim[]>,
  options: CandidateOrderOptions = {},
): CandidateOrderResult {
  const now = (options.now ?? (() => new Date()))();
  const explanations: CandidateExplanation[] = codes.map((code) => {
    const claims = claimsByCode.get(code) ?? [];
    return { code, ...scoreCodeClaims(claims, now) };
  });

  // Stable sort by score descending; ties keep input order via index.
  const indexed = explanations.map((e, i) => ({ e, i }));
  indexed.sort((a, b) => {
    if (a.e.score !== b.e.score) return b.e.score - a.e.score;
    return a.i - b.i;
  });

  const orderedCodes = indexed.map((entry) => entry.e.code);
  if (options.withExplanations) {
    return {
      orderedCodes,
      explanations: indexed.map((entry) => entry.e),
    };
  }
  return { orderedCodes };
}
