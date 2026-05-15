import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  createProviderRegistry,
  REGISTERED_PROVIDER_IDS,
} from "./source-provider-registry";
import type { AwinFetcher } from "./source-provider-awin";
import type { ImpactFetcher } from "./source-provider-impact";

const AWIN_API_KEY = "registry-test-awin-key-not-real";
const IMPACT_API_KEY = "registry-test-impact-key-not-real";
const IMPACT_ACCOUNT_SID = "registry-test-impact-sid-not-real";

const SECRET_TOKENS: readonly string[] = [
  AWIN_API_KEY,
  IMPACT_API_KEY,
  IMPACT_ACCOUNT_SID,
  "SALVARE_AWIN_API_KEY",
  "SALVARE_IMPACT_API_KEY",
  "SALVARE_IMPACT_ACCOUNT_SID",
  "SALVARE_SOURCE_PROVIDER",
  "SALVARE_SOURCE_PROVIDER_ENABLED",
  "SALVARE_IMPACT_ENABLED",
  "SALVARE_AWIN_PUBLISHER_ID",
];

const DENIED_FIELD_NAMES: readonly string[] = [
  "Authorization",
  "Bearer",
  "apiKey",
  "accountSid",
  "authToken",
  "clickThroughUrl",
  "trackingUrl",
  "deepLink",
  "affiliateUrl",
  "commissionRate",
  "payout",
  "publisherId",
  "advertiserId",
  "partnerId",
  "EarningsPerClick",
];

function loadFixture(name: string): string {
  const url = new URL(`./fixtures/${name}`, import.meta.url);
  return readFileSync(fileURLToPath(url), "utf8");
}

function awinEnabledEnv(): NodeJS.ProcessEnv {
  return {
    SALVARE_SOURCE_PROVIDER_ENABLED: "true",
    SALVARE_SOURCE_PROVIDER: "awin",
    SALVARE_AWIN_API_KEY: AWIN_API_KEY,
    SALVARE_AWIN_PUBLISHER_ID: "registry-test-publisher",
  };
}

function impactEnabledEnv(): NodeJS.ProcessEnv {
  return {
    SALVARE_IMPACT_ENABLED: "true",
    SALVARE_IMPACT_API_KEY: IMPACT_API_KEY,
    SALVARE_IMPACT_ACCOUNT_SID: IMPACT_ACCOUNT_SID,
  };
}

function awinFetcher(body: string, status = 200): AwinFetcher {
  return async () => ({ status, body });
}

function impactFetcher(body: string, status = 200): ImpactFetcher {
  return async () => ({ status, body });
}

describe("createProviderRegistry — descriptors and listing", () => {
  it("lists awin and impact descriptors in stable order", () => {
    const registry = createProviderRegistry();
    const ids = registry.list().map((d) => d.providerId);
    expect(ids).toEqual(["awin", "impact"]);
    expect(REGISTERED_PROVIDER_IDS).toEqual(["awin", "impact"]);
  });

  it("exposes safe metadata only on list()", () => {
    const registry = createProviderRegistry();
    for (const meta of registry.list()) {
      expect(typeof meta.providerId).toBe("string");
      expect(typeof meta.sourceId).toBe("string");
      expect(typeof meta.displayName).toBe("string");
      expect(meta.sourceType).toBe("api");
      expect(typeof meta.capabilities.preview).toBe("boolean");
      expect(typeof meta.capabilities.importSupported).toBe("boolean");
      expect(typeof meta.capabilities.cacheSupported).toBe("boolean");
      expect(typeof meta.userExposed).toBe("boolean");
      // No live closures, no config readers, no env values.
      expect(Object.keys(meta)).toEqual([
        "providerId",
        "sourceId",
        "displayName",
        "sourceType",
        "capabilities",
        "userExposed",
      ]);
    }
  });

  it("awin descriptor has full capabilities and is user-exposed", () => {
    const registry = createProviderRegistry();
    const awin = registry.get("awin");
    expect(awin).not.toBeNull();
    expect(awin!.providerId).toBe("awin");
    expect(awin!.sourceId).toBe("awin");
    expect(awin!.capabilities).toEqual({
      preview: true,
      importSupported: true,
      cacheSupported: true,
    });
    expect(awin!.userExposed).toBe(true);
  });

  it("impact descriptor has limited capabilities and is NOT user-exposed", () => {
    const registry = createProviderRegistry();
    const impact = registry.get("impact");
    expect(impact).not.toBeNull();
    expect(impact!.providerId).toBe("impact");
    expect(impact!.sourceId).toBe("impact");
    expect(impact!.capabilities).toEqual({
      preview: true,
      importSupported: false,
      cacheSupported: false,
    });
    expect(impact!.userExposed).toBe(false);
  });

  it("unknown provider returns null (fails closed)", () => {
    const registry = createProviderRegistry();
    expect(registry.get("unknown")).toBeNull();
    expect(registry.get("")).toBeNull();
    expect(registry.get("AWIN")).toBeNull();
    expect(registry.get("../etc/passwd")).toBeNull();
  });
});

describe("createProviderRegistry — redaction", () => {
  it("JSON.stringify(list()) contains no secrets, headers, env names, or denied fields", () => {
    const registry = createProviderRegistry();
    const text = JSON.stringify(registry.list());
    for (const secret of SECRET_TOKENS) {
      expect(text).not.toContain(secret);
    }
    for (const field of DENIED_FIELD_NAMES) {
      expect(text).not.toContain(field);
    }
    expect(text.toLowerCase()).not.toContain("authorization");
    expect(text.toLowerCase()).not.toContain("bearer");
  });

  it("descriptor exposes no admin URL strings", () => {
    const registry = createProviderRegistry();
    for (const meta of registry.list()) {
      const text = JSON.stringify(meta);
      expect(text).not.toContain("/admin/");
      expect(text).not.toContain("Mediapartners");
      expect(text).not.toContain("api.awin.com");
      expect(text).not.toContain("api.impact.com");
    }
  });

  it("statusFor returns booleans only — no env values or credentials", () => {
    const registry = createProviderRegistry();
    const status = registry.statusFor("awin", awinEnabledEnv());
    expect(status).toEqual({ featureEnabled: true, configured: true });
    expect(Object.keys(status)).toEqual(["featureEnabled", "configured"]);
    const text = JSON.stringify(status);
    expect(text).not.toContain(AWIN_API_KEY);
    expect(text).not.toContain("SALVARE_AWIN_API_KEY");
  });
});

describe("createProviderRegistry — statusFor", () => {
  it("returns false/false for unknown / non-provider source ids (fails closed)", () => {
    const registry = createProviderRegistry();
    expect(registry.statusFor("seed", {})).toEqual({
      featureEnabled: false,
      configured: false,
    });
    expect(registry.statusFor("admin", awinEnabledEnv())).toEqual({
      featureEnabled: false,
      configured: false,
    });
    expect(registry.statusFor("import", impactEnabledEnv())).toEqual({
      featureEnabled: false,
      configured: false,
    });
  });

  it("awin: empty env → flag off → false/false", () => {
    const registry = createProviderRegistry();
    expect(registry.statusFor("awin", {})).toEqual({
      featureEnabled: false,
      configured: false,
    });
  });

  it("awin: flag on + provider set + missing key → featureEnabled=true, configured=false", () => {
    const registry = createProviderRegistry();
    expect(
      registry.statusFor("awin", {
        SALVARE_SOURCE_PROVIDER_ENABLED: "true",
        SALVARE_SOURCE_PROVIDER: "awin",
      }),
    ).toEqual({ featureEnabled: true, configured: false });
  });

  it("awin: fully configured → true/true", () => {
    const registry = createProviderRegistry();
    expect(registry.statusFor("awin", awinEnabledEnv())).toEqual({
      featureEnabled: true,
      configured: true,
    });
  });

  it("impact: fully configured → true/true", () => {
    const registry = createProviderRegistry();
    expect(registry.statusFor("impact", impactEnabledEnv())).toEqual({
      featureEnabled: true,
      configured: true,
    });
  });

  it("impact: flag on + missing key → featureEnabled=true, configured=false", () => {
    const registry = createProviderRegistry();
    expect(
      registry.statusFor("impact", { SALVARE_IMPACT_ENABLED: "true" }),
    ).toEqual({ featureEnabled: true, configured: false });
  });

  it("asProviderStatusFn binds env at construction time", () => {
    const registry = createProviderRegistry();
    const fn = registry.asProviderStatusFn(awinEnabledEnv());
    expect(fn("awin")).toEqual({ featureEnabled: true, configured: true });
    expect(fn("impact")).toEqual({ featureEnabled: false, configured: false });
    expect(fn("seed")).toEqual({ featureEnabled: false, configured: false });
  });
});

describe("createProviderRegistry — preview factories (no live network)", () => {
  it("awin preview closure parses fixture body without leaking the api key", async () => {
    const registry = createProviderRegistry();
    const preview = registry.getAwin().createPreview({
      fetcher: awinFetcher(loadFixture("awin-offers-ok.json")),
      env: awinEnabledEnv(),
    });
    const result = await preview({ domain: "shop.example" });
    expect(result.ok).toBe(true);
    expect(result.providerId).toBe("awin");
    const text = JSON.stringify(result);
    expect(text).not.toContain(AWIN_API_KEY);
    expect(text.toLowerCase()).not.toContain("authorization");
    expect(text.toLowerCase()).not.toContain("bearer");
    expect(text).not.toContain("clickThroughUrl");
    expect(text).not.toContain("trackingUrl");
  });

  it("awin preview closure fails closed when env is empty (disabled)", async () => {
    const registry = createProviderRegistry();
    let called = false;
    const fetcher: AwinFetcher = async () => {
      called = true;
      return { status: 200, body: "{}" };
    };
    const preview = registry.getAwin().createPreview({ fetcher, env: {} });
    const result = await preview({ domain: "shop.example" });
    expect(called).toBe(false);
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe("disabled");
  });

  it("awin preview closure fails closed when api key missing (config disabled)", async () => {
    // `readAwinConfig` returns `{ enabled: false, reason: "missing_api_key" }`
    // when the key is blank; the adapter sees `enabled: false` and reports
    // `disabled` without distinguishing the reason. The registry must still
    // never call the fetcher.
    const registry = createProviderRegistry();
    let called = false;
    const fetcher: AwinFetcher = async () => {
      called = true;
      return { status: 200, body: "{}" };
    };
    const preview = registry.getAwin().createPreview({
      fetcher,
      env: {
        SALVARE_SOURCE_PROVIDER_ENABLED: "true",
        SALVARE_SOURCE_PROVIDER: "awin",
      },
    });
    const result = await preview({ domain: "shop.example" });
    expect(called).toBe(false);
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe("disabled");
    // statusFor surfaces the configured=false distinction so callers can
    // differentiate at a status layer without leaking config details.
    expect(
      registry.statusFor("awin", {
        SALVARE_SOURCE_PROVIDER_ENABLED: "true",
        SALVARE_SOURCE_PROVIDER: "awin",
      }),
    ).toEqual({ featureEnabled: true, configured: false });
  });

  it("impact preview closure (registry-internal) parses fixture body without leaking secrets", async () => {
    const registry = createProviderRegistry();
    const preview = registry.getImpact().createPreview({
      fetcher: impactFetcher(loadFixture("impact-offers-ok.json")),
      env: impactEnabledEnv(),
    });
    const result = await preview({ domain: "shop.example" });
    expect(result.ok).toBe(true);
    expect(result.providerId).toBe("impact");
    const text = JSON.stringify(result);
    expect(text).not.toContain(IMPACT_API_KEY);
    expect(text).not.toContain(IMPACT_ACCOUNT_SID);
    expect(text.toLowerCase()).not.toContain("authorization");
    expect(text.toLowerCase()).not.toContain("bearer");
    expect(text).not.toContain("TrackingUrl");
    expect(text).not.toContain("PartnerId");
    expect(text).not.toContain("Payout");
  });

  it("impact preview closure fails closed when env is empty", async () => {
    const registry = createProviderRegistry();
    let called = false;
    const fetcher: ImpactFetcher = async () => {
      called = true;
      return { status: 200, body: "{}" };
    };
    const preview = registry.getImpact().createPreview({ fetcher, env: {} });
    const result = await preview({ domain: "shop.example" });
    expect(called).toBe(false);
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe("disabled");
  });
});

describe("createProviderRegistry — capability gating", () => {
  it("only awin satisfies importSupported (impact stays internal)", () => {
    const registry = createProviderRegistry();
    const importCapable = registry
      .list()
      .filter((d) => d.capabilities.importSupported)
      .map((d) => d.providerId);
    expect(importCapable).toEqual(["awin"]);
  });

  it("only awin is user-exposed in v0.43", () => {
    const registry = createProviderRegistry();
    const exposed = registry
      .list()
      .filter((d) => d.userExposed)
      .map((d) => d.providerId);
    expect(exposed).toEqual(["awin"]);
  });

  it("only awin advertises cacheSupported (v0.33 short-circuit) in v0.43", () => {
    const registry = createProviderRegistry();
    const cacheCapable = registry
      .list()
      .filter((d) => d.capabilities.cacheSupported)
      .map((d) => d.providerId);
    expect(cacheCapable).toEqual(["awin"]);
  });
});
