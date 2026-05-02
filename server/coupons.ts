export type CouponApiSource = "mock-backend" | "none";

export interface CouponApiResponse {
  domain: string;
  candidateCodes: string[];
  source: CouponApiSource;
  updatedAt: string;
}

import seedData from "./coupons.seed.json";

// Seeded independently from the extension's storeProfiles.ts.
// The duplication is intentional for v0.2.0: the extension is not yet wired
// to this backend. A later milestone will collapse the two sources.
const SEED_DATA: Record<string, string[]> =
  seedData && typeof seedData === "object"
    ? (seedData as Record<string, string[]>)
    : {};

export function buildCouponResponse(
  domain: string,
  now: () => Date = () => new Date(),
): CouponApiResponse {
  const codes = SEED_DATA[domain];
  if (codes && codes.length > 0) {
    return {
      domain,
      candidateCodes: codes,
      source: "mock-backend",
      updatedAt: now().toISOString(),
    };
  }
  return {
    domain,
    candidateCodes: [],
    source: "none",
    updatedAt: now().toISOString(),
  };
}
