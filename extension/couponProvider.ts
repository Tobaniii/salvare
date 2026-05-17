import { getStoreProfileForDomain } from "./storeProfiles";

export type CouponProviderMode = "mock" | "backend-with-fallback";

const COUPON_PROVIDER_MODE: CouponProviderMode = "backend-with-fallback";

const BACKEND_URL = "http://localhost:4123/coupons";
const BACKEND_TIMEOUT_MS = 750;

// Allowlisted display-only provenance entry (v0.50.0). Mirrors the server's
// strict /coupons allowlist; the client re-sanitizes defensively so a
// malformed/extra field can never reach the popup render.
export interface CandidateProvenanceEntry {
  code: string;
  sourceType: string;
  discoveredAt?: string;
  confidence?: number;
}

interface BackendResponse {
  domain: string;
  candidateCodes: string[];
  source: "mock-backend" | "none";
  updatedAt: string;
  // Optional + additive. Absence or malformed shape must NOT reject the
  // response — codes still flow, provenance is simply dropped.
  candidateProvenance?: unknown;
}

export interface CandidateCodeFetch {
  candidateCodes: string[];
  candidateProvenance?: CandidateProvenanceEntry[];
}

function isValidBackendResponse(body: unknown): body is BackendResponse {
  if (!body || typeof body !== "object") return false;
  const candidate = body as Record<string, unknown>;
  if (typeof candidate.domain !== "string") return false;
  if (!Array.isArray(candidate.candidateCodes)) return false;
  if (!candidate.candidateCodes.every((c) => typeof c === "string")) {
    return false;
  }
  if (candidate.source !== "mock-backend" && candidate.source !== "none") {
    return false;
  }
  if (typeof candidate.updatedAt !== "string") return false;
  // candidateProvenance is intentionally NOT validated here — it is
  // additive and defensively sanitized separately.
  return true;
}

// Client-side allowlist: keep only the four display fields, and only when
// well-typed. Anything else (sourceId, sourceUrl, affiliate/tracking, raw)
// is dropped even if the server were to regress and send it.
function sanitizeProvenance(
  value: unknown,
): CandidateProvenanceEntry[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: CandidateProvenanceEntry[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    if (typeof r.code !== "string" || typeof r.sourceType !== "string") {
      continue;
    }
    const entry: CandidateProvenanceEntry = {
      code: r.code,
      sourceType: r.sourceType,
    };
    if (typeof r.discoveredAt === "string" && r.discoveredAt.length > 0) {
      entry.discoveredAt = r.discoveredAt;
    }
    if (
      typeof r.confidence === "number" &&
      Number.isFinite(r.confidence) &&
      r.confidence >= 0 &&
      r.confidence <= 100
    ) {
      entry.confidence = r.confidence;
    }
    out.push(entry);
  }
  return out.length > 0 ? out : undefined;
}

async function fetchFromBackend(
  domain: string,
): Promise<CandidateCodeFetch | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), BACKEND_TIMEOUT_MS);

  try {
    const url = `${BACKEND_URL}?domain=${encodeURIComponent(domain)}`;
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return null;

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return null;
    }

    if (!isValidBackendResponse(body)) return null;
    return {
      candidateCodes: body.candidateCodes,
      candidateProvenance: sanitizeProvenance(body.candidateProvenance),
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function getMockCandidateCodes(domain: string): string[] {
  const profile = getStoreProfileForDomain(domain);
  return profile?.candidateCodes ?? [];
}

// Object path (v0.50.0): carries optional provenance. Mock fallback has no
// provenance (returns codes only) — identical resolved codes to before.
export async function fetchCandidateCodesWithProvenance(
  domain: string,
  mode: CouponProviderMode = COUPON_PROVIDER_MODE,
): Promise<CandidateCodeFetch> {
  if (mode === "mock") {
    return { candidateCodes: getMockCandidateCodes(domain) };
  }
  const fromBackend = await fetchFromBackend(domain);
  if (fromBackend !== null) return fromBackend;
  return { candidateCodes: getMockCandidateCodes(domain) };
}

// String[] path — UNCHANGED contract. Used by the support-check flow and
// existing callers/tests. Resolves identical codes pre/post.
export async function fetchCandidateCodesWithMode(
  domain: string,
  mode: CouponProviderMode,
): Promise<string[]> {
  const { candidateCodes } = await fetchCandidateCodesWithProvenance(
    domain,
    mode,
  );
  return candidateCodes;
}

export async function fetchCandidateCodes(domain: string): Promise<string[]> {
  return fetchCandidateCodesWithMode(domain, COUPON_PROVIDER_MODE);
}

export interface CandidateCodeResult {
  domain: string;
  candidateCodes: string[];
  source: "mock-profile";
  fetchedAt: string;
}

export async function fetchCandidateCodeResult(
  domain: string,
): Promise<CandidateCodeResult> {
  const candidateCodes = await fetchCandidateCodes(domain);
  return {
    domain,
    candidateCodes,
    source: "mock-profile",
    fetchedAt: new Date().toISOString(),
  };
}
