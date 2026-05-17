// Enforces that the duplicated server + extension normalizers stay
// byte-identical in behavior. They are intentionally separate modules
// (separate esbuild bundles, no cross-tree import) so this test is the
// contract that keeps them in lockstep.

import { describe, it, expect } from "vitest";
import { normalizeLookupDomain as serverNorm } from "./domain-normalize";
import { normalizeLookupDomain as extNorm } from "../extension/domainNormalize";

const CASES = [
  "localhost",
  "LOCALHOST",
  "  localhost  ",
  "www.wonderbly.com",
  "WWW.Wonderbly.com",
  "wonderbly.com",
  "salvare-test-store.myshopify.com",
  "www.salvare-test-store.myshopify.com",
  "salvare-woo-test.local",
  "example.com",
  "example.org",
  "www.www.example.com",
  "wwww.example.com",
  "shop.www.example.com",
  "a.example.com",
  "b.example.com",
  "",
  "www.",
];

describe("domain-normalize server/extension parity", () => {
  it("produces identical output for every case", () => {
    for (const input of CASES) {
      expect(extNorm(input)).toBe(serverNorm(input));
    }
  });
});
