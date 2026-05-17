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
// `discoveredAt`, `expiresAt`) is considered.
//
// `expiresAt` (v0.51.0) is DEPRIORITIZE-ONLY: a code whose every dated claim
// is in the past sorts to the END of the pre-test queue but stays in the set
// and is still tested — never dropped or filtered (§9). A null/absent/empty
// `expiresAt` is NOT expiry and carries no penalty. `expiresAt` is used only
// for this internal test-order tier; it never reaches any response.

import type { CouponSourceType } from "./db";

export interface CandidateSourceClaim {
  sourceId: string;
  sourceType: CouponSourceType;
  confidence?: number;
  discoveredAt?: string;
  /** Deprioritize-only (v0.51.0). Pre-order test-queue tier; never surfaced. */
  expiresAt?: string;
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
  /** v0.51.0 deprioritize tier. Debug/test only (`withExplanations`). */
  expired: boolean;
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

// Deprioritize-only expiry tier (v0.51.0). A code is expired ONLY when every
// claim carries a parseable PAST `expiresAt`. null/absent/empty/garbage values
// are treated as never-expires (+Infinity) so a mixed null+past code stays
// non-expired ("absence is not expiry; no penalty"). `Math.max` over claim
// expiry — not `Math.min` — so we deprioritize only when even the latest-
// claiming source is past (a `min` would over-deprioritize a code a
// trustworthy source still vouches for). Strict `<`: `expiresAt === now` is
// NOT expired. Never drops a code — only feeds the pre-order sort tier.
function isCodeExpired(
  claims: readonly CandidateSourceClaim[],
  now: Date,
): boolean {
  if (claims.length === 0) return false;
  let maxExpiry = Number.NEGATIVE_INFINITY;
  for (const claim of claims) {
    let value = Number.POSITIVE_INFINITY;
    const iso = claim.expiresAt;
    if (typeof iso === "string" && iso.length > 0) {
      const t = Date.parse(iso);
      if (Number.isFinite(t)) value = t;
    }
    if (value > maxExpiry) maxExpiry = value;
  }
  return Number.isFinite(maxExpiry) && maxExpiry < now.getTime();
}

function scoreCodeClaims(
  claims: readonly CandidateSourceClaim[],
  now: Date,
): Omit<CandidateExplanation, "code" | "expired"> {
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
    return {
      code,
      expired: isCodeExpired(claims, now),
      ...scoreCodeClaims(claims, now),
    };
  });

  // Two-tier stable sort: non-expired group first, then expired group; within
  // each, score descending with input order as the stable tiebreak. When no
  // claim carries `expiresAt`, every `expired` is false, the first clause is
  // always 0, and this reduces to the exact v0.38 two-clause comparator —
  // byte-identical output. A sort never drops a code (§9 set equality).
  const indexed = explanations.map((e, i) => ({ e, i }));
  indexed.sort((a, b) => {
    if (a.e.expired !== b.e.expired) return a.e.expired ? 1 : -1;
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
