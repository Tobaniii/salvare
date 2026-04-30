export interface StoreSelectors {
  couponInput?: string;
  applyButton?: string;
  subtotal?: string;
  total?: string;
}

export interface StoreProfile {
  domain: string;
  candidateCodes: string[];
  selectors?: StoreSelectors;
}

const STORE_PROFILES: StoreProfile[] = [
  {
    domain: "localhost",
    candidateCodes: ["SAVE10", "TAKE15", "FREESHIP"],
  },
  {
    domain: "www.wonderbly.com",
    candidateCodes: ["WELCOME10", "SAVE15", "FREESHIP"],
  },
];

export function getStoreProfileForDomain(
  domain: string,
): StoreProfile | null {
  return STORE_PROFILES.find((profile) => profile.domain === domain) ?? null;
}
