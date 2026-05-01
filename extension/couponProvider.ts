import { getStoreProfileForDomain } from "./storeProfiles";

export async function fetchCandidateCodes(domain: string): Promise<string[]> {
  const profile = getStoreProfileForDomain(domain);
  return profile?.candidateCodes ?? [];
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
