import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createAwinAdapter } from "./source-provider-awin";
import { createImpactAdapter } from "./source-provider-impact";
import type { AwinProviderConfig } from "./source-provider-config";
import type { ImpactProviderConfig } from "./source-provider-config";
import type {
  ProviderAdapter,
  ProviderAdapterResult,
} from "./source-provider-types";

function loadFixture(name: string): string {
  const url = new URL(`./fixtures/${name}`, import.meta.url);
  return readFileSync(fileURLToPath(url), "utf8");
}

// Compile-time proof: if either concrete adapter drifts from the generic
// contract these typed bindings fail to build. The runtime assertions below
// additionally prove the shapes line up at execution time.
function asGenericAdapter(a: ProviderAdapter): ProviderAdapter {
  return a;
}

function assertGenericResult(r: ProviderAdapterResult): void {
  expect(typeof r.ok).toBe("boolean");
  expect(typeof r.providerId).toBe("string");
  expect(typeof r.sourceId).toBe("string");
  expect(Array.isArray(r.candidates)).toBe(true);
  expect(Array.isArray(r.errors)).toBe(true);
  expect(typeof r.fetched).toBe("boolean");
  expect(typeof r.durationMs).toBe("number");
}

describe("generic ProviderAdapter contract (v0.45.0)", () => {
  it("the Awin adapter satisfies ProviderAdapter and yields a generic result", async () => {
    const config: AwinProviderConfig = {
      enabled: true,
      providerId: "awin",
      apiKey: "types-test-awin-key",
      publisherId: "pub-1",
    };
    const adapter = createAwinAdapter({
      config,
      fetcher: async () => ({
        status: 200,
        body: loadFixture("awin-offers-ok.json"),
      }),
    });
    const generic = asGenericAdapter(adapter);
    expect(generic.providerId).toBe("awin");
    const result = await generic.fetchAndParse({ domain: "shop.example" });
    assertGenericResult(result);
    expect(result.providerId).toBe("awin");
  });

  it("the Impact adapter satisfies ProviderAdapter and yields a generic result", async () => {
    const config: ImpactProviderConfig = {
      enabled: true,
      providerId: "impact",
      apiKey: "types-test-impact-key",
      accountSid: "types-test-sid",
    };
    const adapter = createImpactAdapter({
      config,
      fetcher: async () => ({
        status: 200,
        body: loadFixture("impact-offers-ok.json"),
      }),
    });
    const generic = asGenericAdapter(adapter);
    expect(generic.providerId).toBe("impact");
    const result = await generic.fetchAndParse({ domain: "shop.example" });
    assertGenericResult(result);
    expect(result.providerId).toBe("impact");
    // Impact omits cacheHit; the generic contract treats it as optional.
    expect(result.cacheHit ?? false).toBe(false);
  });
});
