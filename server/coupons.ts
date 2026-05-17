import type { RawProvenanceClaim } from "./db-coupon-provenance";

export type CouponApiSource = "mock-backend" | "none";

// Additive, optional per-code provenance (v0.50.0). STRICT allowlist:
// only these four display fields ever leave the server. NEVER sourceId,
// sourceUrl, label, expiresAt, affiliate/tracking/payout, raw payloads,
// API keys, env vars, or DB paths.
export interface CandidateProvenanceEntry {
  code: string;
  sourceType: string;
  discoveredAt?: string;
  confidence?: number;
}

export interface CouponApiResponse {
  domain: string;
  candidateCodes: string[];
  source: CouponApiSource;
  updatedAt: string;
  // Omitted entirely when no candidate code has any source claim.
  candidateProvenance?: CandidateProvenanceEntry[];
}

// Tiebreak-only priority (mirrors the v0.38 source-type ordering). Never a
// ranking input — provenance is display-only and §7-irrelevant.
const SOURCE_TYPE_PRIORITY: Record<string, number> = {
  manual: 5,
  import: 4,
  api: 3,
  feed: 3,
  seed: 2,
  html_adapter: 1,
};

function safeConfidence(value: number | null): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  if (value < 0 || value > 100) return undefined;
  return value;
}

function pickBestClaim(claims: RawProvenanceClaim[]): RawProvenanceClaim {
  // Deterministic collapse: highest confidence -> most recent discoveredAt
  // -> source-type priority -> first (input is ORDER BY ccs.id ASC, stable).
  return claims.reduce((best, c) => {
    const bc = safeConfidence(best.confidence) ?? -1;
    const cc = safeConfidence(c.confidence) ?? -1;
    if (cc !== bc) return cc > bc ? c : best;
    const bd = best.discoveredAt ?? "";
    const cd = c.discoveredAt ?? "";
    if (cd !== bd) return cd > bd ? c : best;
    const bp = SOURCE_TYPE_PRIORITY[best.sourceType] ?? 0;
    const cp = SOURCE_TYPE_PRIORITY[c.sourceType] ?? 0;
    if (cp !== bp) return cp > bp ? c : best;
    return best;
  });
}

/**
 * Collapse raw per-code source claims into ONE allowlisted provenance entry
 * per code, in `candidateCodes` order. Hard-coded field projection (no
 * spread) — the same buildSafe discipline the admin routes use. Returns
 * `undefined` when no code has any claim, so the response field is omitted.
 */
export function buildSafeProvenance(
  codes: readonly string[],
  claimsByCode: ReadonlyMap<string, RawProvenanceClaim[]>,
): CandidateProvenanceEntry[] | undefined {
  const entries: CandidateProvenanceEntry[] = [];
  for (const code of codes) {
    const claims = claimsByCode.get(code);
    if (!claims || claims.length === 0) continue;
    const best = pickBestClaim(claims);
    const entry: CandidateProvenanceEntry = {
      code,
      sourceType: String(best.sourceType),
    };
    if (typeof best.discoveredAt === "string" && best.discoveredAt.length > 0) {
      entry.discoveredAt = best.discoveredAt;
    }
    const confidence = safeConfidence(best.confidence);
    if (confidence !== undefined) entry.confidence = confidence;
    entries.push(entry);
  }
  return entries.length > 0 ? entries : undefined;
}

export function buildCouponResponse(
  domain: string,
  candidateCodes: string[],
  now: () => Date = () => new Date(),
): CouponApiResponse {
  const updatedAt = now().toISOString();
  if (candidateCodes.length > 0) {
    return {
      domain,
      candidateCodes,
      source: "mock-backend",
      updatedAt,
    };
  }
  return {
    domain,
    candidateCodes: [],
    source: "none",
    updatedAt,
  };
}

export interface AdminCouponsBody {
  domain: string;
  candidateCodes: string[];
}

export type AdminBodyValidation =
  | { ok: true; domain: string; candidateCodes: string[] }
  | { ok: false; error: string };

export function validateAdminBody(body: unknown): AdminBodyValidation {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "body must be an object" };
  }
  const b = body as Record<string, unknown>;
  if (typeof b.domain !== "string" || b.domain.trim().length === 0) {
    return { ok: false, error: "domain must be a non-empty string" };
  }
  if (!Array.isArray(b.candidateCodes)) {
    return { ok: false, error: "candidateCodes must be an array" };
  }
  for (const code of b.candidateCodes) {
    if (typeof code !== "string" || code.trim().length === 0) {
      return {
        ok: false,
        error: "candidateCodes must contain only non-empty strings",
      };
    }
  }
  return {
    ok: true,
    domain: b.domain.trim(),
    candidateCodes: b.candidateCodes as string[],
  };
}

export type DomainParamValidation =
  | { ok: true; domain: string }
  | { ok: false; error: string };

export function validateDomainParam(
  raw: string | null | undefined,
): DomainParamValidation {
  if (typeof raw !== "string") {
    return { ok: false, error: "missing domain" };
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { ok: false, error: "missing domain" };
  }
  return { ok: true, domain: trimmed };
}
