import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  createHtmlFixtureAdapter,
  createJsonFixtureAdapter,
  SOURCE_ADAPTER_CANDIDATE_KEYS,
  type SourceAdapter,
  type SourceAdapterCandidate,
  type SourceAdapterResult,
} from "./source-adapters";

const FIXED_NOW = "2026-05-10T00:00:00.000Z";
const fixedNow = () => FIXED_NOW;

const JSON_FIXTURE_PATH = fileURLToPath(
  new URL("./fixtures/source-json-example.json", import.meta.url),
);
const HTML_FIXTURE_PATH = fileURLToPath(
  new URL("./fixtures/source-html-example.html", import.meta.url),
);
const SOURCE_FILE_PATH = fileURLToPath(
  new URL("./source-adapters.ts", import.meta.url),
);

function readJson(): string {
  return readFileSync(JSON_FIXTURE_PATH, "utf8");
}

function readHtml(): string {
  return readFileSync(HTML_FIXTURE_PATH, "utf8");
}

function makeJsonAdapter(): SourceAdapter {
  return createJsonFixtureAdapter({
    id: "fixture-json",
    sourceId: "fixture-json-example",
  });
}

function makeHtmlAdapter(): SourceAdapter {
  return createHtmlFixtureAdapter({
    id: "fixture-html",
    sourceId: "fixture-html-example",
  });
}

describe("createJsonFixtureAdapter", () => {
  it("parses two valid candidates from the JSON fixture", () => {
    const adapter = makeJsonAdapter();
    const result = adapter.parse(readJson(), { now: fixedNow });
    expect(result.ok).toBe(true);
    expect(result.adapterId).toBe("fixture-json");
    expect(result.sourceId).toBe("fixture-json-example");
    expect(result.errors).toEqual([]);
    expect(result.candidates).toHaveLength(2);
    expect(result.candidates[0]).toEqual({
      domain: "example.com",
      code: "WELCOME10",
      sourceId: "fixture-json-example",
      discoveredAt: FIXED_NOW,
      label: "10% off your first order",
      expiresAt: "2026-12-31",
      sourceUrl: "https://example.com/promo",
      confidence: 0.7,
    });
    expect(result.candidates[1].domain).toBe("shop.example.org");
    expect(result.candidates[1].code).toBe("FREESHIP");
  });

  it("trims codes and lowercases domains", () => {
    const adapter = makeJsonAdapter();
    const payload = JSON.stringify({
      sourceId: "fixture-json-example",
      items: [{ domain: "Example.COM", code: "  TRIM10  " }],
    });
    const result = adapter.parse(payload, { now: fixedNow });
    expect(result.ok).toBe(true);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].domain).toBe("example.com");
    expect(result.candidates[0].code).toBe("TRIM10");
  });

  it("dedupes duplicate (sourceId, domain, code) entries", () => {
    const adapter = makeJsonAdapter();
    const payload = JSON.stringify({
      sourceId: "fixture-json-example",
      items: [
        { domain: "example.com", code: "DUP" },
        { domain: "example.com", code: "DUP" },
      ],
    });
    const result = adapter.parse(payload, { now: fixedNow });
    expect(result.ok).toBe(true);
    expect(result.candidates).toHaveLength(1);
    expect(result.errors).toEqual([{ index: 1, reason: "duplicate" }]);
  });

  it("rejects invalid domain shapes", () => {
    const adapter = makeJsonAdapter();
    const payload = JSON.stringify({
      sourceId: "fixture-json-example",
      items: [
        { domain: "not a domain", code: "OK1" },
        { domain: "", code: "OK2" },
        { domain: "no-tld", code: "OK3" },
      ],
    });
    const result = adapter.parse(payload, { now: fixedNow });
    expect(result.ok).toBe(true);
    expect(result.candidates).toEqual([]);
    expect(result.errors).toEqual([
      { index: 0, reason: "invalid_domain" },
      { index: 1, reason: "invalid_domain" },
      { index: 2, reason: "invalid_domain" },
    ]);
  });

  it("rejects invalid code shapes", () => {
    const adapter = makeJsonAdapter();
    const payload = JSON.stringify({
      sourceId: "fixture-json-example",
      items: [
        { domain: "example.com", code: "" },
        { domain: "example.com", code: "   " },
        { domain: "example.com", code: "WITH SPACE" },
        { domain: "example.com", code: "WITH\tTAB" },
        { domain: "example.com", code: "x".repeat(65) },
      ],
    });
    const result = adapter.parse(payload, { now: fixedNow });
    expect(result.ok).toBe(true);
    expect(result.candidates).toEqual([]);
    expect(result.errors.every((e) => e.reason === "invalid_code")).toBe(true);
  });

  it("rejects missing required fields", () => {
    const adapter = makeJsonAdapter();
    const payload = JSON.stringify({
      sourceId: "fixture-json-example",
      items: [{ domain: "example.com" }, { code: "ALONE" }],
    });
    const result = adapter.parse(payload, { now: fixedNow });
    expect(result.ok).toBe(true);
    expect(result.candidates).toEqual([]);
    expect(result.errors).toEqual([
      { index: 0, reason: "missing_field" },
      { index: 1, reason: "missing_field" },
    ]);
  });

  it("rejects out-of-range confidence", () => {
    const adapter = makeJsonAdapter();
    const payload = JSON.stringify({
      sourceId: "fixture-json-example",
      items: [
        { domain: "example.com", code: "C1", confidence: 2 },
        { domain: "example.com", code: "C2", confidence: -0.1 },
        { domain: "example.com", code: "C3", confidence: "high" },
      ],
    });
    const result = adapter.parse(payload, { now: fixedNow });
    expect(result.ok).toBe(true);
    expect(result.candidates).toEqual([]);
    expect(result.errors.every((e) => e.reason === "invalid_confidence")).toBe(
      true,
    );
  });

  it("strips unknown unsafe fields from the output candidate", () => {
    const adapter = makeJsonAdapter();
    const malicious = {
      sourceId: "fixture-json-example",
      items: [
        {
          domain: "example.com",
          code: "SAFE1",
          cookie: "session=abc",
          apiKey: "sk-test-XYZ",
          bearer: "Bearer secret",
          headers: { Authorization: "Bearer secret" },
          dbPath: "/var/lib/salvare/secret.db",
          envVar: process.env.HOME ?? "x",
          rawHtml: "<script>alert(1)</script>",
          __proto__: { polluted: true },
          constructor: { prototype: { polluted: true } },
        },
      ],
    };
    const result = adapter.parse(JSON.stringify(malicious), { now: fixedNow });
    expect(result.ok).toBe(true);
    expect(result.candidates).toHaveLength(1);
    const candidate = result.candidates[0];
    const keys = Object.keys(candidate).sort();
    expect(keys).toEqual(["code", "discoveredAt", "domain", "sourceId"]);
    expect(
      ({} as { polluted?: boolean }).polluted,
    ).toBeUndefined();
    expect((Object.prototype as { polluted?: boolean }).polluted).toBeUndefined();
  });

  it("redacted errors do not echo raw payload values or secrets", () => {
    const adapter = makeJsonAdapter();
    const payload = JSON.stringify({
      sourceId: "fixture-json-example",
      items: [
        {
          domain: "PAYLOAD-LEAK-DOMAIN",
          code: "PAYLOAD-LEAK-CODE",
          cookie: "session=PAYLOAD-LEAK-COOKIE",
          apiKey: "sk-PAYLOAD-LEAK-APIKEY",
          bearer: "Bearer PAYLOAD-LEAK-BEARER",
        },
      ],
    });
    const result = adapter.parse(payload, { now: fixedNow });
    const serialized = JSON.stringify(result.errors);
    expect(serialized).not.toMatch(/PAYLOAD-LEAK/);
    expect(serialized).not.toMatch(/cookie/i);
    expect(serialized).not.toMatch(/bearer/i);
    expect(serialized).not.toMatch(/apikey/i);
  });

  it("returns ok=false with malformed_input for invalid JSON", () => {
    const adapter = makeJsonAdapter();
    const result = adapter.parse("{not valid json", { now: fixedNow });
    expect(result.ok).toBe(false);
    expect(result.candidates).toEqual([]);
    expect(result.errors).toEqual([{ index: -1, reason: "malformed_input" }]);
  });

  it("returns ok=false when items is not an array", () => {
    const adapter = makeJsonAdapter();
    const result = adapter.parse(JSON.stringify({ items: "nope" }), {
      now: fixedNow,
    });
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual([{ index: -1, reason: "malformed_input" }]);
  });

  it("does not throw on unreadable inputs", () => {
    const adapter = makeJsonAdapter();
    expect(() => adapter.parse("", { now: fixedNow })).not.toThrow();
    expect(() => adapter.parse("[]", { now: fixedNow })).not.toThrow();
    expect(() => adapter.parse("null", { now: fixedNow })).not.toThrow();
  });
});

describe("createHtmlFixtureAdapter", () => {
  it("parses two valid candidates from the HTML fixture", () => {
    const adapter = makeHtmlAdapter();
    const result = adapter.parse(readHtml(), { now: fixedNow });
    expect(result.ok).toBe(true);
    expect(result.adapterId).toBe("fixture-html");
    expect(result.sourceId).toBe("fixture-html-example");
    expect(result.errors).toEqual([]);
    expect(result.candidates).toHaveLength(2);
    expect(result.candidates[0]).toEqual({
      domain: "example.com",
      code: "HTML10",
      sourceId: "fixture-html-example",
      discoveredAt: FIXED_NOW,
      label: "10% off (HTML fixture)",
      expiresAt: "2026-12-31",
      sourceUrl: "https://example.com/html-promo",
      confidence: 0.6,
    });
  });

  it("dedupes duplicate HTML rows", () => {
    const adapter = makeHtmlAdapter();
    const html = `
      <li class="salvare-coupon" data-domain="example.com" data-code="DUP"></li>
      <li class="salvare-coupon" data-domain="example.com" data-code="DUP"></li>
    `;
    const result = adapter.parse(html, { now: fixedNow });
    expect(result.ok).toBe(true);
    expect(result.candidates).toHaveLength(1);
    expect(result.errors).toEqual([{ index: 1, reason: "duplicate" }]);
  });

  it("ignores elements without the salvare-coupon class", () => {
    const adapter = makeHtmlAdapter();
    const html = `
      <li class="salvare-coupon" data-domain="example.com" data-code="OK"></li>
      <li class="other-class" data-domain="example.com" data-code="NOPE"></li>
      <div data-domain="example.com" data-code="NOPE"></div>
    `;
    const result = adapter.parse(html, { now: fixedNow });
    expect(result.ok).toBe(true);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].code).toBe("OK");
  });

  it("returns ok=false when no salvare-coupon elements are present", () => {
    const adapter = makeHtmlAdapter();
    const result = adapter.parse("<html><body><p>nothing</p></body></html>", {
      now: fixedNow,
    });
    expect(result.ok).toBe(false);
    expect(result.candidates).toEqual([]);
    expect(result.errors).toEqual([{ index: -1, reason: "malformed_input" }]);
  });

  it("returns ok=false on empty input", () => {
    const adapter = makeHtmlAdapter();
    const result = adapter.parse("", { now: fixedNow });
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual([{ index: -1, reason: "malformed_input" }]);
  });
});

describe("source-adapter cross-cutting guarantees", () => {
  it("rejects adapter ids and source ids that fail the allowlist gate", () => {
    expect(() =>
      createJsonFixtureAdapter({
        id: "Bad Id",
        sourceId: "fixture-json-example",
      }),
    ).toThrow();
    expect(() =>
      createJsonFixtureAdapter({
        id: "fixture-json",
        sourceId: "https://evil.example.com/feed",
      }),
    ).toThrow();
    expect(() =>
      createHtmlFixtureAdapter({
        id: "fixture-html",
        sourceId: "Bearer token",
      }),
    ).toThrow();
  });

  it("output candidate keys are limited to the allowlisted set", () => {
    const adapter = makeJsonAdapter();
    const result = adapter.parse(readJson(), { now: fixedNow });
    const allowed = new Set<string>(SOURCE_ADAPTER_CANDIDATE_KEYS);
    for (const candidate of result.candidates) {
      for (const key of Object.keys(candidate)) {
        expect(allowed.has(key)).toBe(true);
      }
    }
  });

  it("result shape is stable across adapters and inputs", () => {
    const json = makeJsonAdapter().parse(readJson(), { now: fixedNow });
    const html = makeHtmlAdapter().parse(readHtml(), { now: fixedNow });
    for (const result of [json, html] as SourceAdapterResult[]) {
      expect(Object.keys(result).sort()).toEqual([
        "adapterId",
        "candidates",
        "errors",
        "ok",
        "sourceId",
      ]);
    }
  });

  it("source-adapters.ts contains no network or fetch usage", () => {
    const source = readFileSync(SOURCE_FILE_PATH, "utf8");
    const banned = [
      /\bfetch\s*\(/,
      /\bXMLHttpRequest\b/,
      /from\s+["']node:http["']/,
      /from\s+["']node:https["']/,
      /from\s+["']http["']/,
      /from\s+["']https["']/,
      /\bimport\s*\(\s*["']node:https?["']/,
      /\brequire\s*\(\s*["']node:https?["']/,
      /\bnew\s+URL\s*\(/,
    ];
    for (const pattern of banned) {
      expect(pattern.test(source)).toBe(false);
    }
  });

  it("source-adapters.ts contains no fs or process reads", () => {
    const source = readFileSync(SOURCE_FILE_PATH, "utf8");
    expect(/from\s+["']node:fs["']/.test(source)).toBe(false);
    expect(/\bprocess\.env\b/.test(source)).toBe(false);
  });

  it("does not surface raw payload values, headers, cookies, or paths", () => {
    const adapter = makeJsonAdapter();
    const payload = JSON.stringify({
      sourceId: "fixture-json-example",
      items: [
        {
          domain: "example.com",
          code: "SAFE",
          rawPayload: "FULL-RAW-HTML-PAYLOAD-CONTENT",
          headers: { authorization: "Bearer LEAK" },
          cookies: "session=LEAK",
          envHome: "/Users/leak/secret",
          dbPath: "/var/lib/salvare/secret.db",
        },
      ],
    });
    const result = adapter.parse(payload, { now: fixedNow });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toMatch(/FULL-RAW-HTML-PAYLOAD-CONTENT/);
    expect(serialized).not.toMatch(/LEAK/);
    expect(serialized).not.toMatch(/secret\.db/);
    expect(serialized).not.toMatch(/Bearer/);
  });

  it("uses the injected now() clock for discoveredAt", () => {
    const adapter = makeJsonAdapter();
    const payload = JSON.stringify({
      sourceId: "fixture-json-example",
      items: [{ domain: "example.com", code: "WHEN" }],
    });
    const result = adapter.parse(payload, {
      now: () => "2030-01-01T00:00:00.000Z",
    });
    expect(result.candidates[0].discoveredAt).toBe("2030-01-01T00:00:00.000Z");
  });

  it("candidate type metadata describes the source type", () => {
    expect(makeJsonAdapter().type).toBe("json");
    expect(makeHtmlAdapter().type).toBe("html");
  });

  it("candidates returned from JSON and HTML carry the expected sourceId", () => {
    const json = makeJsonAdapter().parse(readJson(), { now: fixedNow });
    const html = makeHtmlAdapter().parse(readHtml(), { now: fixedNow });
    for (const c of json.candidates as SourceAdapterCandidate[]) {
      expect(c.sourceId).toBe("fixture-json-example");
    }
    for (const c of html.candidates as SourceAdapterCandidate[]) {
      expect(c.sourceId).toBe("fixture-html-example");
    }
  });
});
