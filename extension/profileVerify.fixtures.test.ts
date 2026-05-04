// @vitest-environment happy-dom

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_FIXTURE_EXPECTATIONS,
  verifyFixtureCompatibility,
  type FixtureSource,
} from "./profileVerify";
import type { ScanContext } from "./checkoutScan";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = resolve(TEST_DIR, "..", "public", "fixtures");

function makeSource(name: string): FixtureSource {
  return {
    name,
    loadContext(): ScanContext | null {
      const html = readFileSync(resolve(FIXTURES_DIR, name), "utf8");
      const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
      document.body.innerHTML = bodyMatch ? bodyMatch[1] : html;
      return { root: document, view: window };
    },
  };
}

describe("verifyFixtureCompatibility — current fixtures map to expected reasons", () => {
  it("all default expectations pass", () => {
    const sources = DEFAULT_FIXTURE_EXPECTATIONS.map((e) => makeSource(e.name));
    const result = verifyFixtureCompatibility(sources);
    expect(result.ok).toBe(true);
    for (const c of result.checks) {
      expect(c.ok).toBe(true);
    }
  });

  it("flags a missing fixture as a failure", () => {
    const result = verifyFixtureCompatibility(
      [],
      [{ name: "nope.html", expected: "ready" } as never],
    );
    expect(result.ok).toBe(false);
    expect(
      result.checks.some(
        (c) => c.name === "fixture[nope.html].present" && c.ok === false,
      ),
    ).toBe(true);
  });

  it("flags an unexpected reason as a failure", () => {
    const sources = [makeSource("alt-coupon.html")];
    const result = verifyFixtureCompatibility(sources, [
      { name: "alt-coupon.html", expected: "total_missing" } as never,
    ]);
    expect(result.ok).toBe(false);
    expect(
      result.checks.some(
        (c) =>
          c.name === "fixture[alt-coupon.html].reason_total_missing"
          && c.ok === false,
      ),
    ).toBe(true);
  });
});
