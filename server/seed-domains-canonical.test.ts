// Canonical-data guard (v0.50.0): the v0.50.0 lookup-key normalization is
// inbound-only and assumes stored/seed domains are already canonical
// (lowercase, no leading "www.", trimmed). This pins that assumption so a
// future non-canonical seed key fails here instead of silently shifting
// which store a normalized lookup resolves to.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { normalizeLookupDomain } from "./domain-normalize";

describe("coupons.seed.json domains are already canonical", () => {
  it("every seed domain equals its normalized form", () => {
    const seedPath = resolve(__dirname, "coupons.seed.json");
    const seed = JSON.parse(readFileSync(seedPath, "utf8")) as Record<
      string,
      unknown
    >;
    const domains = Object.keys(seed);
    expect(domains.length).toBeGreaterThan(0);
    for (const domain of domains) {
      expect(domain).toBe(normalizeLookupDomain(domain));
    }
  });
});
