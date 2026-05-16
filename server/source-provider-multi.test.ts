// v0.49.0 — Multi-provider correctness BY TEST (not user-visible).
//
// Proves Awin + Impact candidates for the SAME domain:
//  - dedupe correctly at the import layer (an overlapping code is inserted
//    once into coupon_codes; the second provider's import reuses it),
//  - preserve per-provider `coupon_code_sources` provenance (one row per
//    (code, source_id) — an overlapping code carries BOTH providers'
//    provenance),
//  - record `import_history.provider_id` per provider.
//
// Impact is reached via the INTERNAL adapter/registry path only — it stays
// `userExposed:false` / `importEnabled:false`, so `resolveProvider` still
// denies it on the user surface (asserted here, unchanged from v0.48). No
// live HTTP: both providers are fixture-driven with injected fetchers.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { openDatabase, type Db } from "./db";
import {
  createAwinAdapter,
  type AwinFetcher,
  type AwinAdapterClock,
} from "./source-provider-awin";
import {
  createImpactAdapter,
  type ImpactFetcher,
  type ImpactAdapterClock,
} from "./source-provider-impact";
import type {
  AwinProviderConfig,
  ImpactProviderConfig,
} from "./source-provider-config";
import {
  importProviderCandidates,
  recordProviderImportAttempt,
} from "./db-source-import";
import { createProviderRegistry } from "./source-provider-registry";
import type { SourceAdapterCandidate } from "./source-adapters";

const AWIN_NOW_MS = Date.parse("2026-05-11T12:00:00.000Z");
const IMPACT_NOW_MS = Date.parse("2026-05-15T12:00:00.000Z");

function awinClock(): AwinAdapterClock {
  let calls = 0;
  return {
    nowIso: () => new Date(AWIN_NOW_MS + calls).toISOString(),
    nowMs: () => AWIN_NOW_MS + calls++,
  };
}

function impactClock(): ImpactAdapterClock {
  let calls = 0;
  return {
    nowIso: () => new Date(IMPACT_NOW_MS + calls).toISOString(),
    nowMs: () => IMPACT_NOW_MS + calls++,
  };
}

function loadFixture(name: string): string {
  const url = new URL(`./fixtures/${name}`, import.meta.url);
  return readFileSync(fileURLToPath(url), "utf8");
}

function makeDb(): Db {
  return openDatabase(":memory:");
}

const awinConfig: AwinProviderConfig = {
  enabled: true,
  providerId: "awin",
  apiKey: "multi-awin-key-not-real",
  publisherId: "pub-multi",
};

const impactConfig: ImpactProviderConfig = {
  enabled: true,
  providerId: "impact",
  apiKey: "multi-impact-token-not-real",
  accountSid: "MULTI-IMPACT-SID-NOT-REAL",
};

function awinFetcher(body: string): AwinFetcher {
  return async () => ({ status: 200, body });
}
function impactFetcher(body: string): ImpactFetcher {
  return async () => ({ status: 200, body });
}

function forDomain(
  candidates: SourceAdapterCandidate[],
  domain: string,
): { domain: string; code: string; label?: string; expiresAt?: string }[] {
  return candidates
    .filter((c) => c.domain === domain)
    .map((c) => ({
      domain: c.domain,
      code: c.code,
      label: c.label,
      expiresAt: c.expiresAt,
    }));
}

describe("multi-provider correctness (Awin + Impact, internal path)", () => {
  async function deriveBoth() {
    const awin = await createAwinAdapter({
      config: awinConfig,
      fetcher: awinFetcher(loadFixture("awin-offers-ok.json")),
      clock: awinClock(),
    }).fetchAndParse({ domain: "shop.example" });
    const impact = await createImpactAdapter({
      config: impactConfig,
      fetcher: impactFetcher(loadFixture("impact-offers-ok.json")),
      clock: impactClock(),
    }).fetchAndParse({ domain: "shop.example" });
    expect(awin.ok).toBe(true);
    expect(impact.ok).toBe(true);
    return {
      awinShop: forDomain(awin.candidates, "shop.example"),
      impactShop: forDomain(impact.candidates, "shop.example"),
    };
  }

  it("fixtures overlap on exactly one code for shop.example (FREESHIP)", async () => {
    const { awinShop, impactShop } = await deriveBoth();
    const awinCodes = awinShop.map((c) => c.code).sort();
    const impactCodes = impactShop.map((c) => c.code).sort();
    expect(awinCodes).toEqual(["AWIN10", "FREESHIP"]);
    expect(impactCodes).toEqual(["FREESHIP", "IMPACT10"]);
  });

  it("overlapping code inserted once into coupon_codes; second import reuses it", async () => {
    const db = makeDb();
    const { awinShop, impactShop } = await deriveBoth();

    const awinStats = importProviderCandidates(db, {
      sourceId: "awin",
      sourceName: "Awin Offers API",
      sourceType: "api",
      domain: "shop.example",
      candidates: awinShop,
    });
    const impactStats = importProviderCandidates(db, {
      sourceId: "impact",
      sourceName: "impact.com Promotions API",
      sourceType: "api",
      domain: "shop.example",
      candidates: impactShop,
    });

    expect(awinStats.codesImported).toBe(2); // AWIN10, FREESHIP
    expect(impactStats.codesImported).toBe(1); // IMPACT10 only; FREESHIP reused

    const codeRows = db
      .prepare(
        `SELECT cc.code FROM coupon_codes cc
           JOIN stores s ON s.id = cc.store_id
          WHERE s.domain = ? ORDER BY cc.code`,
      )
      .all("shop.example") as Array<{ code: string }>;
    expect(codeRows.map((r) => r.code)).toEqual([
      "AWIN10",
      "FREESHIP",
      "IMPACT10",
    ]);
  });

  it("per-provider provenance preserved — overlapping code has both providers' rows", async () => {
    const db = makeDb();
    const { awinShop, impactShop } = await deriveBoth();
    importProviderCandidates(db, {
      sourceId: "awin",
      sourceName: "Awin Offers API",
      sourceType: "api",
      domain: "shop.example",
      candidates: awinShop,
    });
    importProviderCandidates(db, {
      sourceId: "impact",
      sourceName: "impact.com Promotions API",
      sourceType: "api",
      domain: "shop.example",
      candidates: impactShop,
    });

    const prov = db
      .prepare(
        `SELECT ccs.code, ccs.source_id FROM coupon_code_sources ccs
           JOIN stores s ON s.id = ccs.store_id
          WHERE s.domain = ? ORDER BY ccs.code, ccs.source_id`,
      )
      .all("shop.example") as Array<{ code: string; source_id: string }>;

    expect(prov).toEqual([
      { code: "AWIN10", source_id: "awin" },
      { code: "FREESHIP", source_id: "awin" },
      { code: "FREESHIP", source_id: "impact" },
      { code: "IMPACT10", source_id: "impact" },
    ]);
  });

  it("import_history records provider_id per provider", async () => {
    const db = makeDb();
    const { awinShop, impactShop } = await deriveBoth();

    const a = importProviderCandidates(db, {
      sourceId: "awin",
      sourceName: "Awin Offers API",
      sourceType: "api",
      domain: "shop.example",
      candidates: awinShop,
    });
    recordProviderImportAttempt(db, {
      providerId: "awin",
      sourceId: "awin",
      domain: "shop.example",
      outcome: "ok",
      candidatesAccepted: a.candidatesAccepted,
      codesImported: a.codesImported,
      provenanceRecorded: a.provenanceRecorded,
      rejectedCount: 0,
    });

    const i = importProviderCandidates(db, {
      sourceId: "impact",
      sourceName: "impact.com Promotions API",
      sourceType: "api",
      domain: "shop.example",
      candidates: impactShop,
    });
    recordProviderImportAttempt(db, {
      providerId: "impact",
      sourceId: "impact",
      domain: "shop.example",
      outcome: "ok",
      candidatesAccepted: i.candidatesAccepted,
      codesImported: i.codesImported,
      provenanceRecorded: i.provenanceRecorded,
      rejectedCount: 0,
    });

    const hist = db
      .prepare(
        "SELECT provider_id, domain, outcome FROM import_history ORDER BY provider_id",
      )
      .all() as Array<{ provider_id: string; domain: string; outcome: string }>;
    expect(hist).toEqual([
      { provider_id: "awin", domain: "shop.example", outcome: "ok" },
      { provider_id: "impact", domain: "shop.example", outcome: "ok" },
    ]);
  });

  it("Impact stays hidden — resolveProvider denies preview AND import (v0.48 parity)", () => {
    const registry = createProviderRegistry();
    const deps = {
      fetcher: (async () => ({ status: 200, body: "{}" })) as ImpactFetcher,
    };
    expect(
      registry.resolveProvider("impact", "preview", deps),
    ).toEqual({ ok: false, reason: "not_user_exposed" });
    expect(
      registry.resolveProvider("impact", "import", deps),
    ).toEqual({ ok: false, reason: "not_user_exposed" });
    // Awin (user-exposed) still resolves for both purposes.
    expect(registry.resolveProvider("awin", "preview", deps).ok).toBe(true);
    expect(registry.resolveProvider("awin", "import", deps).ok).toBe(true);
  });
});
