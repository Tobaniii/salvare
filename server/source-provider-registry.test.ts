import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  createProviderRegistry,
  classifyActivation,
  REGISTERED_PROVIDER_IDS,
  type ProviderActivation,
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
      expect(typeof meta.activation.enabled).toBe("boolean");
      expect(typeof meta.activation.previewEnabled).toBe("boolean");
      expect(typeof meta.activation.importEnabled).toBe("boolean");
      expect(typeof meta.activation.userExposed).toBe("boolean");
      expect(typeof meta.activation.cacheSupported).toBe("boolean");
      expect(typeof meta.activation.schedulerSupported).toBe("boolean");
      // No live closures, no config readers, no env values.
      expect(Object.keys(meta)).toEqual([
        "providerId",
        "sourceId",
        "displayName",
        "sourceType",
        "activation",
      ]);
      expect(Object.keys(meta.activation)).toEqual([
        "enabled",
        "previewEnabled",
        "importEnabled",
        "userExposed",
        "cacheSupported",
        "schedulerSupported",
      ]);
    }
  });

  it("awin descriptor has full activation and is user-exposed", () => {
    const registry = createProviderRegistry();
    const awin = registry.get("awin");
    expect(awin).not.toBeNull();
    expect(awin!.providerId).toBe("awin");
    expect(awin!.sourceId).toBe("awin");
    expect(awin!.activation).toEqual({
      enabled: true,
      previewEnabled: true,
      importEnabled: true,
      userExposed: true,
      cacheSupported: true,
      schedulerSupported: true,
    });
  });

  it("impact descriptor has cache parity but stays NOT user-exposed", () => {
    const registry = createProviderRegistry();
    const impact = registry.get("impact");
    expect(impact).not.toBeNull();
    expect(impact!.providerId).toBe("impact");
    expect(impact!.sourceId).toBe("impact");
    // v0.48.0 — Impact keeps internal cache-read parity
    // (`cacheSupported: true`) and ships `enabled: true`;
    // `importEnabled`/`userExposed` stay false (v0.49).
    expect(impact!.activation).toEqual({
      enabled: true,
      previewEnabled: true,
      importEnabled: false,
      userExposed: false,
      cacheSupported: true,
      schedulerSupported: false,
    });
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
  it("only awin satisfies importEnabled (impact stays internal)", () => {
    const registry = createProviderRegistry();
    const importCapable = registry
      .list()
      .filter((d) => d.activation.importEnabled)
      .map((d) => d.providerId);
    expect(importCapable).toEqual(["awin"]);
  });

  it("only awin is user-exposed in v0.48", () => {
    const registry = createProviderRegistry();
    const exposed = registry
      .list()
      .filter((d) => d.activation.userExposed)
      .map((d) => d.providerId);
    expect(exposed).toEqual(["awin"]);
  });

  it("awin and impact both advertise cacheSupported (v0.47 parity)", () => {
    const registry = createProviderRegistry();
    const cacheCapable = registry
      .list()
      .filter((d) => d.activation.cacheSupported)
      .map((d) => d.providerId);
    expect(cacheCapable).toEqual(["awin", "impact"]);
  });

  it("both providers ship enabled:true (disabled path is test-double only)", () => {
    const registry = createProviderRegistry();
    const enabled = registry
      .list()
      .filter((d) => d.activation.enabled)
      .map((d) => d.providerId);
    expect(enabled).toEqual(["awin", "impact"]);
  });

  it("only Awin advertises schedulerSupported (v0.52.0 — impact never scheduled)", () => {
    const registry = createProviderRegistry();
    const sched = registry
      .list()
      .filter((d) => d.activation.schedulerSupported)
      .map((d) => d.providerId);
    expect(sched).toEqual(["awin"]);
  });
});

describe("createProviderRegistry — resolveProvider (v0.45.0)", () => {
  const awinDeps = () => ({
    fetcher: awinFetcher(loadFixture("awin-offers-ok.json")),
  });

  it("resolves awin for preview and import (user-exposed, both capabilities)", () => {
    const registry = createProviderRegistry();
    for (const purpose of ["preview", "import"] as const) {
      const r = registry.resolveProvider("awin", purpose, awinDeps());
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.descriptor.providerId).toBe("awin");
        expect(r.descriptor.sourceId).toBe("awin");
        expect(r.descriptor.displayName).toBe("Awin Offers API");
        expect(typeof r.closure).toBe("function");
      }
    }
  });

  it("denies impact for BOTH purposes — not_user_exposed (unreachable on user surface)", () => {
    const registry = createProviderRegistry();
    const prev = registry.resolveProvider("impact", "preview", awinDeps());
    const imp = registry.resolveProvider("impact", "import", awinDeps());
    expect(prev).toEqual({ ok: false, reason: "not_user_exposed" });
    expect(imp).toEqual({ ok: false, reason: "not_user_exposed" });
  });

  it("denies unknown provider ids fail-closed (no throw, no raw)", () => {
    const registry = createProviderRegistry();
    for (const id of ["bogus", "", "AWIN", "awin/../impact", "impact "]) {
      const r = registry.resolveProvider(id, "preview", awinDeps());
      expect(r).toEqual({ ok: false, reason: "unknown_provider" });
    }
  });

  it("never throws raw for any resolve input", () => {
    const registry = createProviderRegistry();
    expect(() =>
      registry.resolveProvider("bogus", "import", awinDeps()),
    ).not.toThrow();
    expect(() =>
      registry.resolveProvider("impact", "import", awinDeps()),
    ).not.toThrow();
  });

  it("resolved awin closure runs the adapter and returns a generic result", async () => {
    const registry = createProviderRegistry();
    const r = registry.resolveProvider("awin", "preview", {
      fetcher: awinFetcher(loadFixture("awin-offers-ok.json")),
      env: awinEnabledEnv(),
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const out = await r.closure({ domain: "shop.example" });
      expect(out.providerId).toBe("awin");
      expect(out.sourceId).toBe("awin");
      expect(Array.isArray(out.candidates)).toBe(true);
    }
  });
});

describe("classifyActivation — precedence matrix (v0.48.0)", () => {
  const bools = [true, false] as const;
  const purposes = ["preview", "import"] as const;

  // Independent oracle of the documented precedence:
  // unknown_provider > provider_disabled > not_user_exposed >
  // capability_unsupported. Strict !== true (fail-closed).
  function expected(
    a: ProviderActivation | null,
    purpose: "preview" | "import",
  ): string {
    if (a === null) return "unknown_provider";
    if (a.enabled !== true) return "provider_disabled";
    if (a.userExposed !== true) return "not_user_exposed";
    const cap =
      purpose === "preview"
        ? a.previewEnabled === true
        : a.importEnabled === true;
    return cap ? "ok" : "capability_unsupported";
  }

  it("null activation === unknown_provider for both purposes", () => {
    for (const purpose of purposes) {
      expect(classifyActivation(null, purpose)).toBe("unknown_provider");
    }
  });

  it("full cartesian of enabled×userExposed×previewEnabled×importEnabled × purpose", () => {
    for (const enabled of bools)
      for (const userExposed of bools)
        for (const previewEnabled of bools)
          for (const importEnabled of bools)
            for (const purpose of purposes) {
              const activation: ProviderActivation = {
                enabled,
                previewEnabled,
                importEnabled,
                userExposed,
                cacheSupported: false,
                schedulerSupported: false,
              };
              expect(classifyActivation(activation, purpose)).toBe(
                expected(activation, purpose),
              );
            }
  });

  it("precedence: provider_disabled wins over not_user_exposed and capability", () => {
    const a: ProviderActivation = {
      enabled: false,
      previewEnabled: false,
      importEnabled: false,
      userExposed: false,
      cacheSupported: false,
      schedulerSupported: false,
    };
    expect(classifyActivation(a, "preview")).toBe("provider_disabled");
    expect(classifyActivation(a, "import")).toBe("provider_disabled");
  });

  it("precedence: not_user_exposed wins over capability_unsupported", () => {
    const a: ProviderActivation = {
      enabled: true,
      previewEnabled: false,
      importEnabled: false,
      userExposed: false,
      cacheSupported: false,
      schedulerSupported: false,
    };
    expect(classifyActivation(a, "preview")).toBe("not_user_exposed");
    expect(classifyActivation(a, "import")).toBe("not_user_exposed");
  });

  it("capability downgrade: previewEnabled:false denies preview, importEnabled:false denies import", () => {
    const a: ProviderActivation = {
      enabled: true,
      previewEnabled: false,
      importEnabled: true,
      userExposed: true,
      cacheSupported: false,
      schedulerSupported: false,
    };
    expect(classifyActivation(a, "preview")).toBe("capability_unsupported");
    expect(classifyActivation(a, "import")).toBe("ok");
    const b: ProviderActivation = { ...a, previewEnabled: true, importEnabled: false };
    expect(classifyActivation(b, "preview")).toBe("ok");
    expect(classifyActivation(b, "import")).toBe("capability_unsupported");
  });

  it("fail-closed: missing/undefined flags deny (not coerced truthy)", () => {
    // Simulate a tampered/partial descriptor missing the boolean fields.
    const missingEnabled = {
      previewEnabled: true,
      importEnabled: true,
      userExposed: true,
      cacheSupported: false,
      schedulerSupported: false,
    } as unknown as ProviderActivation;
    expect(classifyActivation(missingEnabled, "preview")).toBe(
      "provider_disabled",
    );
    const missingUserExposed = {
      enabled: true,
      previewEnabled: true,
      importEnabled: true,
      cacheSupported: false,
      schedulerSupported: false,
    } as unknown as ProviderActivation;
    expect(classifyActivation(missingUserExposed, "import")).toBe(
      "not_user_exposed",
    );
    const missingPreview = {
      enabled: true,
      importEnabled: true,
      userExposed: true,
      cacheSupported: false,
      schedulerSupported: false,
    } as unknown as ProviderActivation;
    expect(classifyActivation(missingPreview, "preview")).toBe(
      "capability_unsupported",
    );
    expect(classifyActivation(missingPreview, "import")).toBe("ok");
  });
});
