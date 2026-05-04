import { describe, it, expect } from "vitest";
import {
  combineResults,
  formatVerifyReport,
  verifyProfiles,
} from "./profileVerify";
import type { StoreProfile } from "./storeProfiles";

const validLocalhost: StoreProfile = {
  id: "localhost-react-cart",
  domain: "localhost",
  candidateCodes: ["SAVE10", "TAKE15", "FREESHIP"],
};

function findCheck(checks: ReturnType<typeof verifyProfiles>["checks"], name: string) {
  return checks.find((c) => c.name === name);
}

describe("verifyProfiles — current profile data", () => {
  it("passes for the live STORE_PROFILES module", async () => {
    const mod = await import("./storeProfiles");
    // Reach private array via re-imported helper output: walk known domains.
    const known = [
      "localhost",
      "www.wonderbly.com",
      "salvare-test-store.myshopify.com",
      "salvare-woo-test.local",
    ];
    const profiles = known
      .map((d) => mod.getStoreProfileForDomain(d))
      .filter((p): p is StoreProfile => p !== null);
    const result = verifyProfiles(profiles);
    expect(result.ok).toBe(true);
    expect(result.profileCount).toBe(profiles.length);
    expect(findCheck(result.checks, "localhost_profile_present")?.ok).toBe(true);
    expect(findCheck(result.checks, "localhost_profile_valid")?.ok).toBe(true);
    expect(findCheck(result.checks, "ids_unique")?.ok).toBe(true);
    expect(findCheck(result.checks, "domains_unique")?.ok).toBe(true);
  });
});

describe("verifyProfiles — structural failures", () => {
  it("fails when id is missing", () => {
    const result = verifyProfiles([
      { id: "", domain: "localhost", candidateCodes: ["A"] },
    ] as StoreProfile[]);
    expect(result.ok).toBe(false);
    expect(
      result.checks.some(
        (c) => c.name.endsWith(".id_present") && c.ok === false,
      ),
    ).toBe(true);
  });

  it("fails when ids duplicate", () => {
    const result = verifyProfiles([
      { id: "dup", domain: "a", candidateCodes: ["X"] },
      { id: "dup", domain: "b", candidateCodes: ["Y"] },
      validLocalhost,
    ]);
    expect(result.ok).toBe(false);
    expect(findCheck(result.checks, "ids_unique")?.ok).toBe(false);
  });

  it("fails when domain missing", () => {
    const result = verifyProfiles([
      validLocalhost,
      { id: "no-domain", domain: "", candidateCodes: ["X"] } as StoreProfile,
    ]);
    expect(result.ok).toBe(false);
    expect(
      result.checks.some(
        (c) => c.name.endsWith(".domain_present") && c.ok === false,
      ),
    ).toBe(true);
  });

  it("fails when domains duplicate", () => {
    const result = verifyProfiles([
      validLocalhost,
      { id: "dup-dom-a", domain: "shared.example", candidateCodes: ["A"] },
      { id: "dup-dom-b", domain: "shared.example", candidateCodes: ["B"] },
    ]);
    expect(result.ok).toBe(false);
    expect(findCheck(result.checks, "domains_unique")?.ok).toBe(false);
  });

  it("fails when id format is invalid", () => {
    const result = verifyProfiles([
      validLocalhost,
      { id: "Bad_ID", domain: "x.example", candidateCodes: ["A"] },
    ]);
    expect(result.ok).toBe(false);
    expect(
      result.checks.some(
        (c) => c.name.endsWith(".id_format") && c.ok === false,
      ),
    ).toBe(true);
  });

  it("fails when a selector string is empty", () => {
    const result = verifyProfiles([
      validLocalhost,
      {
        id: "with-empty-sel",
        domain: "empty-sel.example",
        candidateCodes: ["A"],
        selectors: { couponInput: "  " },
      },
    ]);
    expect(result.ok).toBe(false);
    expect(
      result.checks.some(
        (c) =>
          c.name === "profile[with-empty-sel].selector.couponInput_non_empty"
          && c.ok === false,
      ),
    ).toBe(true);
  });

  it("warns on absurdly broad selectors", () => {
    const result = verifyProfiles([
      validLocalhost,
      {
        id: "broad-sel",
        domain: "broad.example",
        candidateCodes: ["A"],
        selectors: { total: "*" },
      },
    ]);
    expect(result.ok).toBe(true);
    expect(
      result.warnings.some((w) => w.name.endsWith(".selector.total_broad")),
    ).toBe(true);
  });

  it("fails when a forbidden substring leaks into a selector", () => {
    const result = verifyProfiles([
      validLocalhost,
      {
        id: "leaky",
        domain: "leaky.example",
        candidateCodes: ["A"],
        selectors: { couponInput: "input[data-token]" },
      },
    ]);
    expect(result.ok).toBe(false);
    const failed = result.checks.find(
      (c) => c.name === "profile[leaky].no_forbidden_substrings",
    );
    expect(failed?.ok).toBe(false);
  });

  it("fails when localhost profile missing entirely", () => {
    const result = verifyProfiles([
      { id: "only-remote", domain: "x.example", candidateCodes: ["A"] },
    ]);
    expect(result.ok).toBe(false);
    expect(findCheck(result.checks, "localhost_profile_present")?.ok).toBe(false);
  });

  it("warns on duplicate candidate codes within a profile", () => {
    const result = verifyProfiles([
      {
        id: "dupcodes",
        domain: "dup.example",
        candidateCodes: ["A", "A", "B"],
      },
      validLocalhost,
    ]);
    expect(result.ok).toBe(true);
    expect(
      result.warnings.some((w) =>
        w.name === "profile[dupcodes].candidate_codes_duplicate",
      ),
    ).toBe(true);
  });
});

describe("formatVerifyReport — redaction", () => {
  it("does not echo selector strings or candidate codes", () => {
    const structural = verifyProfiles([
      validLocalhost,
      {
        id: "leaky",
        domain: "leaky.example",
        candidateCodes: ["SUPERSECRET", "OTHER"],
        selectors: { couponInput: "input[data-token=abc123]" },
      },
    ]);
    const combined = combineResults(structural, { ok: true, checks: [] });
    const text = formatVerifyReport(combined);
    expect(text).not.toContain("SUPERSECRET");
    expect(text).not.toContain("data-token=abc123");
    expect(text).not.toContain("abc123");
    expect(text).toContain("profile[leaky]");
  });
});
