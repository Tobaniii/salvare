import { getStoreProfileForDomain } from "./storeProfiles";

const BACKEND_URL = "http://localhost:4123/coupons";
const BACKEND_TIMEOUT_MS = 750;

interface BackendResponse {
  domain: string;
  candidateCodes: string[];
  source: "mock-backend" | "none";
  updatedAt: string;
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
  return true;
}

async function fetchFromBackend(domain: string): Promise<string[] | null> {
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
    return body.candidateCodes;
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

export async function fetchCandidateCodes(domain: string): Promise<string[]> {
  const fromBackend = await fetchFromBackend(domain);
  if (fromBackend !== null) return fromBackend;
  return getMockCandidateCodes(domain);
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
