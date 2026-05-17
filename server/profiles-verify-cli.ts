// Local-only profile verification CLI.
//
// Validates extension store profile definitions for structural issues,
// uniqueness, selector sanity, and local fixture compatibility against the
// committed `public/fixtures/*.html` pages. Output is intentionally redacted:
// it never includes selector strings, candidate codes, fixture HTML, env
// vars, headers, cookies, DB paths, or tokens — only profile ids and check
// names with short safe details.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Window } from "happy-dom";

import {
  combineResults,
  DEFAULT_FIXTURE_EXPECTATIONS,
  formatVerifyReport,
  verifyFixtureCompatibility,
  verifyProfiles,
  type FixtureSource,
} from "../extension/profileVerify";
import type { ScanContext } from "../extension/checkoutScan";
import {
  getStoreProfileForDomain,
  type StoreProfile,
} from "../extension/storeProfiles";
import { normalizeLookupDomain } from "./domain-normalize";

const KNOWN_DOMAINS = [
  "localhost",
  "www.wonderbly.com",
  "salvare-test-store.myshopify.com",
  "salvare-woo-test.local",
];

function loadProfiles(): StoreProfile[] {
  const profiles: StoreProfile[] = [];
  for (const domain of KNOWN_DOMAINS) {
    const profile = getStoreProfileForDomain(domain);
    if (profile) profiles.push(profile);
  }
  return profiles;
}

function fixturesDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, "..", "public", "fixtures");
}

function buildFixtureSources(): FixtureSource[] {
  const dir = fixturesDir();
  return DEFAULT_FIXTURE_EXPECTATIONS.map((exp) => ({
    name: exp.name,
    loadContext(): ScanContext | null {
      const html = readFileSync(resolve(dir, exp.name), "utf8");
      const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
      const bodyHtml = bodyMatch ? bodyMatch[1] : html;
      const win = new Window();
      win.document.body.innerHTML = bodyHtml;
      return {
        root: win.document as unknown as ScanContext["root"],
        view: win as unknown as ScanContext["view"],
      };
    },
  }));
}

function main(): void {
  const profiles = loadProfiles();
  const structural = verifyProfiles(profiles);
  const fixtures = verifyFixtureCompatibility(buildFixtureSources());
  const combined = combineResults(structural, fixtures);

  // Canonical-data guard (v0.50.0): every profile's stored domain must
  // already equal its normalized form, so the symmetric lookup-key
  // normalization can never silently change which profile a host resolves
  // to. Only profile ids are printed (no domains/selectors/codes).
  const nonCanonical = profiles.filter(
    (p) => p.domain !== normalizeLookupDomain(p.domain),
  );

  console.log("Salvare profiles:verify");
  console.log(formatVerifyReport(combined));
  for (const p of nonCanonical) {
    console.log(`profile domain not canonical: ${p.id}`);
  }

  if (!combined.ok || nonCanonical.length > 0) {
    process.exit(1);
  }
}

main();
