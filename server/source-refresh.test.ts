import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { openDatabase, type Db } from "./db";
import {
  parseSourceRefreshArgs,
  runSourceRefresh,
  type SourceRefreshArgs,
} from "./source-refresh";
import type {
  AwinAdapterClock,
  AwinFetcher,
} from "./source-provider-awin";

const API_KEY = "secret-key-shhh";
const FIXED_NOW_MS = Date.parse("2026-05-14T12:00:00.000Z");

function fixedClock(): AwinAdapterClock {
  let calls = 0;
  return {
    nowIso: () => new Date(FIXED_NOW_MS + calls).toISOString(),
    nowMs: () => FIXED_NOW_MS + calls++,
  };
}

function loadFixture(name: string): string {
  const url = new URL(`./fixtures/${name}`, import.meta.url);
  return readFileSync(fileURLToPath(url), "utf8");
}

function fixtureFetcher(body: string, status = 200): AwinFetcher {
  return async () => ({ status, body });
}

function trapFetcher(): AwinFetcher {
  return async () => {
    throw new Error("fetcher must not be called");
  };
}

function enabledEnv(): NodeJS.ProcessEnv {
  return {
    SALVARE_SOURCE_PROVIDER_ENABLED: "true",
    SALVARE_SOURCE_PROVIDER: "awin",
    SALVARE_AWIN_API_KEY: API_KEY,
    SALVARE_AWIN_PUBLISHER_ID: "pub-42",
  };
}

function makeDb(): Db {
  return openDatabase(":memory:");
}

function counts(db: Db): {
  coupons: number;
  results: number;
  awinProvenance: number;
  allProvenance: number;
} {
  const coupons = (
    db.prepare("SELECT COUNT(*) AS n FROM coupon_codes").get() as { n: number }
  ).n;
  const results = (
    db.prepare("SELECT COUNT(*) AS n FROM coupon_results").get() as {
      n: number;
    }
  ).n;
  const awinProvenance = (
    db
      .prepare(
        "SELECT COUNT(*) AS n FROM coupon_code_sources WHERE source_id = 'awin'",
      )
      .get() as { n: number }
  ).n;
  const allProvenance = (
    db.prepare("SELECT COUNT(*) AS n FROM coupon_code_sources").get() as {
      n: number;
    }
  ).n;
  return { coupons, results, awinProvenance, allProvenance };
}

function previewArgs(overrides: Partial<SourceRefreshArgs> = {}): SourceRefreshArgs {
  return {
    provider: "awin",
    domain: "shop.example",
    import: false,
    confirm: null,
    ...overrides,
  };
}

function importArgs(overrides: Partial<SourceRefreshArgs> = {}): SourceRefreshArgs {
  return {
    provider: "awin",
    domain: "shop.example",
    import: true,
    confirm: "IMPORT",
    ...overrides,
  };
}

function expectNoSecrets(output: unknown): void {
  const text = JSON.stringify(output);
  expect(text).not.toContain(API_KEY);
  expect(text.toLowerCase()).not.toContain("authorization");
  expect(text.toLowerCase()).not.toContain("bearer");
  expect(text).not.toMatch(/awin1\.com/);
  expect(text).not.toContain("clickThroughUrl");
  expect(text).not.toContain("trackingUrl");
  expect(text).not.toContain("commissionRate");
  expect(text).not.toContain("deepLink");
  expect(text).not.toContain("SALVARE_AWIN_API_KEY");
}

describe("parseSourceRefreshArgs", () => {
  it("parses provider + domain (preview default)", () => {
    const r = parseSourceRefreshArgs([
      "--provider",
      "awin",
      "--domain",
      "shop.example",
    ]);
    expect(r).toEqual({
      ok: true,
      args: {
        provider: "awin",
        domain: "shop.example",
        import: false,
        confirm: null,
      },
    });
  });

  it("parses --import and --confirm", () => {
    const r = parseSourceRefreshArgs([
      "--provider",
      "awin",
      "--domain",
      "shop.example",
      "--import",
      "--confirm",
      "IMPORT",
    ]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.args.import).toBe(true);
      expect(r.args.confirm).toBe("IMPORT");
    }
  });

  it("rejects unknown flags", () => {
    const r = parseSourceRefreshArgs(["--zap"]);
    expect(r.ok).toBe(false);
  });

  it("rejects missing flag values", () => {
    const r = parseSourceRefreshArgs(["--provider"]);
    expect(r.ok).toBe(false);
  });

  it("rejects when --provider missing", () => {
    const r = parseSourceRefreshArgs(["--domain", "shop.example"]);
    expect(r.ok).toBe(false);
  });

  it("rejects when --domain missing", () => {
    const r = parseSourceRefreshArgs(["--provider", "awin"]);
    expect(r.ok).toBe(false);
  });
});

describe("runSourceRefresh — validation", () => {
  it("unknown provider fails closed without calling fetcher", async () => {
    const db = makeDb();
    try {
      const r = await runSourceRefresh(
        previewArgs({ provider: "fmtc" }),
        { db, env: enabledEnv(), fetcher: trapFetcher() },
      );
      expect(r.exitCode).toBe(1);
      expect(r.output).toMatchObject({ ok: false, reason: "unknown_provider" });
      expect(counts(db)).toMatchObject({ coupons: 0, results: 0 });
    } finally {
      db.close();
    }
  });

  it("invalid domain fails closed without calling fetcher", async () => {
    const db = makeDb();
    try {
      const r = await runSourceRefresh(
        previewArgs({ domain: "   " }),
        { db, env: enabledEnv(), fetcher: trapFetcher() },
      );
      expect(r.exitCode).toBe(1);
      expect(r.output).toMatchObject({ ok: false, reason: "invalid_domain" });
    } finally {
      db.close();
    }
  });

  it("import without --confirm IMPORT fails closed without calling fetcher", async () => {
    const db = makeDb();
    try {
      const r = await runSourceRefresh(
        importArgs({ confirm: null }),
        { db, env: enabledEnv(), fetcher: trapFetcher() },
      );
      expect(r.exitCode).toBe(1);
      expect(r.output).toMatchObject({
        ok: false,
        reason: "confirmation_required",
      });
      expect(counts(db)).toMatchObject({ coupons: 0, awinProvenance: 0 });
    } finally {
      db.close();
    }
  });

  it("import with wrong confirm phrase fails closed", async () => {
    const db = makeDb();
    try {
      const r = await runSourceRefresh(
        importArgs({ confirm: "import" }),
        { db, env: enabledEnv(), fetcher: trapFetcher() },
      );
      expect(r.exitCode).toBe(1);
      expect(r.output).toMatchObject({
        ok: false,
        reason: "confirmation_required",
      });
    } finally {
      db.close();
    }
  });

  it("disabled/missing config fails closed without calling fetcher", async () => {
    const db = makeDb();
    try {
      const r = await runSourceRefresh(
        previewArgs(),
        { db, env: {}, fetcher: trapFetcher() },
      );
      expect(r.exitCode).toBe(1);
      expect(r.output).toMatchObject({
        ok: false,
        reason: "flag_off",
        disabled: true,
      });
    } finally {
      db.close();
    }
  });

  it("missing API key fails closed without calling fetcher", async () => {
    const db = makeDb();
    try {
      const r = await runSourceRefresh(previewArgs(), {
        db,
        env: {
          SALVARE_SOURCE_PROVIDER_ENABLED: "true",
          SALVARE_SOURCE_PROVIDER: "awin",
        },
        fetcher: trapFetcher(),
      });
      expect(r.exitCode).toBe(1);
      expect(r.output).toMatchObject({
        ok: false,
        reason: "missing_api_key",
        disabled: true,
      });
    } finally {
      db.close();
    }
  });
});

describe("runSourceRefresh — preview (dry-run default)", () => {
  it("returns safe candidate summary and writes no coupon_codes or coupon_results", async () => {
    const db = makeDb();
    try {
      const r = await runSourceRefresh(previewArgs(), {
        db,
        env: enabledEnv(),
        fetcher: fixtureFetcher(loadFixture("awin-offers-ok.json")),
        clock: fixedClock(),
      });
      expect(r.exitCode).toBe(0);
      expect(r.output.ok).toBe(true);
      if (r.output.ok && r.output.mode === "preview") {
        expect(r.output.provider).toBe("awin");
        expect(r.output.domain).toBe("shop.example");
        expect(r.output.candidateCount).toBeGreaterThanOrEqual(2);
        for (const c of r.output.candidates) {
          expect(c.sourceId).toBe("awin");
          expect(Object.keys(c)).not.toContain("clickThroughUrl");
          expect(Object.keys(c)).not.toContain("trackingUrl");
          expect(Object.keys(c)).not.toContain("commissionRate");
          expect(Object.keys(c)).not.toContain("publisherId");
        }
      }
      expectNoSecrets(r.output);

      const c = counts(db);
      expect(c.coupons).toBe(0);
      expect(c.results).toBe(0);
      expect(c.awinProvenance).toBe(0);
    } finally {
      db.close();
    }
  });

  it("surfaces adapter http_4xx failure without echoing payload", async () => {
    const db = makeDb();
    try {
      const r = await runSourceRefresh(previewArgs(), {
        db,
        env: enabledEnv(),
        fetcher: fixtureFetcher('{"error":"not found","secret":"leak-me"}', 404),
        clock: fixedClock(),
      });
      expect(r.exitCode).toBe(1);
      expect(r.output).toMatchObject({ ok: false, reason: "http_4xx" });
      expect(JSON.stringify(r.output)).not.toContain("leak-me");
    } finally {
      db.close();
    }
  });
});

describe("runSourceRefresh — import (confirmed)", () => {
  it("writes coupon_codes and Awin provenance and never writes coupon_results", async () => {
    const db = makeDb();
    try {
      const r = await runSourceRefresh(importArgs(), {
        db,
        env: enabledEnv(),
        fetcher: fixtureFetcher(loadFixture("awin-offers-ok.json")),
        clock: fixedClock(),
      });
      expect(r.exitCode).toBe(0);
      expect(r.output.ok).toBe(true);
      if (r.output.ok && r.output.mode === "import") {
        expect(r.output.provider).toBe("awin");
        expect(r.output.domain).toBe("shop.example");
        expect(r.output.codesImported).toBeGreaterThan(0);
        expect(r.output.provenanceRecorded).toBeGreaterThan(0);
        // Fixture has 3 voucher candidates: 2 for shop.example, 1 for
        // other.example. The runner must reject the off-domain candidate.
        expect(r.output.rejected).toBe(1);
      }

      const c = counts(db);
      expect(c.coupons).toBeGreaterThan(0);
      expect(c.awinProvenance).toBe(c.coupons);
      expect(c.results).toBe(0);

      expectNoSecrets(r.output);
    } finally {
      db.close();
    }
  });

  it("is idempotent on repeat import", async () => {
    const db = makeDb();
    try {
      const deps = {
        db,
        env: enabledEnv(),
        fetcher: fixtureFetcher(loadFixture("awin-offers-ok.json")),
        clock: fixedClock(),
      };
      const first = await runSourceRefresh(importArgs(), deps);
      expect(first.exitCode).toBe(0);
      const c1 = counts(db);
      expect(c1.coupons).toBeGreaterThan(0);
      expect(c1.awinProvenance).toBe(c1.coupons);

      const second = await runSourceRefresh(importArgs(), {
        ...deps,
        fetcher: fixtureFetcher(loadFixture("awin-offers-ok.json")),
        clock: fixedClock(),
      });
      expect(second.exitCode).toBe(0);
      if (second.output.ok && second.output.mode === "import") {
        expect(second.output.codesImported).toBe(0);
        expect(second.output.provenanceRecorded).toBe(0);
      }

      const c2 = counts(db);
      expect(c2.coupons).toBe(c1.coupons);
      expect(c2.awinProvenance).toBe(c1.awinProvenance);
      expect(c2.results).toBe(0);
    } finally {
      db.close();
    }
  });

  it("import does not delete existing seed/admin/import provenance for same code", async () => {
    const db = makeDb();
    try {
      // Seed an existing coupon code for shop.example through the standard
      // additive writer so it carries a non-Awin provenance row.
      const { upsertCouponCodes } = await import("./db-coupons");
      upsertCouponCodes(db, "shop.example", ["AWIN10"]);
      const before = counts(db);
      expect(before.coupons).toBe(1);
      expect(before.awinProvenance).toBe(0);
      expect(before.allProvenance).toBeGreaterThanOrEqual(1);

      const r = await runSourceRefresh(importArgs(), {
        db,
        env: enabledEnv(),
        fetcher: fixtureFetcher(loadFixture("awin-offers-ok.json")),
        clock: fixedClock(),
      });
      expect(r.exitCode).toBe(0);

      const after = counts(db);
      // Existing code reused (no duplicate); a second voucher gets imported.
      expect(after.coupons).toBeGreaterThan(before.coupons);
      // Existing seed provenance is preserved alongside new Awin provenance.
      expect(after.allProvenance).toBeGreaterThan(before.allProvenance);
      expect(after.awinProvenance).toBeGreaterThan(0);
      expect(after.results).toBe(0);
    } finally {
      db.close();
    }
  });

  it("import surfaces adapter failure without writing", async () => {
    const db = makeDb();
    try {
      const r = await runSourceRefresh(importArgs(), {
        db,
        env: enabledEnv(),
        fetcher: fixtureFetcher("{}", 503),
        clock: fixedClock(),
      });
      expect(r.exitCode).toBe(1);
      expect(r.output).toMatchObject({ ok: false, reason: "http_5xx" });
      expect(counts(db).coupons).toBe(0);
      expect(counts(db).awinProvenance).toBe(0);
      expect(counts(db).results).toBe(0);
    } finally {
      db.close();
    }
  });

  it("import surfaces fetcher exception without writing", async () => {
    const db = makeDb();
    try {
      const fetcher: AwinFetcher = async () => {
        throw new Error(`network down with ${API_KEY} embedded`);
      };
      const r = await runSourceRefresh(importArgs(), {
        db,
        env: enabledEnv(),
        fetcher,
        clock: fixedClock(),
      });
      expect(r.exitCode).toBe(1);
      expect(r.output).toMatchObject({ ok: false, reason: "fetch_error" });
      expectNoSecrets(r.output);
      expect(counts(db).coupons).toBe(0);
      expect(counts(db).awinProvenance).toBe(0);
    } finally {
      db.close();
    }
  });
});

describe("source-refresh package script wiring", () => {
  it("exposes build:source-refresh and source:refresh scripts", () => {
    const url = new URL("../package.json", import.meta.url);
    const pkg = JSON.parse(readFileSync(fileURLToPath(url), "utf8")) as {
      scripts?: Record<string, string>;
      version?: string;
    };
    expect(pkg.scripts?.["build:source-refresh"]).toBeTypeOf("string");
    expect(pkg.scripts?.["source:refresh"]).toBeTypeOf("string");
    expect(pkg.version).toBe("0.44.0");
  });
});
