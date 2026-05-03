import { describe, it, expect } from "vitest";
import { parseServerConfig } from "./config";

const DEFAULTS = { port: 4123, dbPath: "/tmp/test-default.db" };

function ok(result: ReturnType<typeof parseServerConfig>) {
  if (!result.ok) throw new Error(`expected ok result, got error: ${result.error}`);
  return result.config;
}

describe("parseServerConfig — PORT", () => {
  it("uses default when PORT is unset", () => {
    expect(ok(parseServerConfig({}, DEFAULTS)).port).toBe(4123);
  });

  it("uses default when PORT is empty string", () => {
    expect(ok(parseServerConfig({ PORT: "" }, DEFAULTS)).port).toBe(4123);
  });

  it("uses default when PORT is whitespace only", () => {
    expect(ok(parseServerConfig({ PORT: "   " }, DEFAULTS)).port).toBe(4123);
  });

  it("accepts a valid PORT value", () => {
    expect(ok(parseServerConfig({ PORT: "4200" }, DEFAULTS)).port).toBe(4200);
  });

  it("trims surrounding whitespace on a valid PORT", () => {
    expect(ok(parseServerConfig({ PORT: "  8080  " }, DEFAULTS)).port).toBe(8080);
  });

  it("rejects non-numeric PORT", () => {
    const result = parseServerConfig({ PORT: "abc" }, DEFAULTS);
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.error).toContain("PORT");
  });

  it("rejects negative PORT", () => {
    expect(parseServerConfig({ PORT: "-1" }, DEFAULTS)).toMatchObject({
      ok: false,
    });
  });

  it("rejects PORT 0", () => {
    expect(parseServerConfig({ PORT: "0" }, DEFAULTS)).toMatchObject({
      ok: false,
    });
  });

  it("rejects PORT above 65535", () => {
    expect(parseServerConfig({ PORT: "65536" }, DEFAULTS)).toMatchObject({
      ok: false,
    });
  });

  it("rejects fractional PORT", () => {
    expect(parseServerConfig({ PORT: "8080.5" }, DEFAULTS)).toMatchObject({
      ok: false,
    });
  });

  it("rejects hex-style PORT", () => {
    expect(parseServerConfig({ PORT: "0x1f90" }, DEFAULTS)).toMatchObject({
      ok: false,
    });
  });

  it("includes the offending value in the error message", () => {
    const result = parseServerConfig({ PORT: "nope" }, DEFAULTS);
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.error).toContain("'nope'");
  });
});

describe("parseServerConfig — SALVARE_DB_PATH", () => {
  it("uses default when unset", () => {
    expect(ok(parseServerConfig({}, DEFAULTS)).dbPath).toBe(DEFAULTS.dbPath);
  });

  it("uses default when empty/whitespace", () => {
    expect(ok(parseServerConfig({ SALVARE_DB_PATH: "" }, DEFAULTS)).dbPath).toBe(
      DEFAULTS.dbPath,
    );
    expect(
      ok(parseServerConfig({ SALVARE_DB_PATH: "   " }, DEFAULTS)).dbPath,
    ).toBe(DEFAULTS.dbPath);
  });

  it("trims a provided value", () => {
    expect(
      ok(parseServerConfig({ SALVARE_DB_PATH: "  /tmp/x.db  " }, DEFAULTS))
        .dbPath,
    ).toBe("/tmp/x.db");
  });
});

describe("parseServerConfig — SALVARE_ADMIN_TOKEN", () => {
  it("disables auth when unset", () => {
    expect(ok(parseServerConfig({}, DEFAULTS)).adminToken).toBeNull();
  });

  it("disables auth when empty", () => {
    expect(
      ok(parseServerConfig({ SALVARE_ADMIN_TOKEN: "" }, DEFAULTS)).adminToken,
    ).toBeNull();
  });

  it("disables auth when whitespace", () => {
    expect(
      ok(parseServerConfig({ SALVARE_ADMIN_TOKEN: "  \t  " }, DEFAULTS))
        .adminToken,
    ).toBeNull();
  });

  it("trims a provided token", () => {
    expect(
      ok(
        parseServerConfig({ SALVARE_ADMIN_TOKEN: "  abc-123  " }, DEFAULTS),
      ).adminToken,
    ).toBe("abc-123");
  });
});

describe("parseServerConfig — NODE_ENV", () => {
  it("defaults to 'development' when unset", () => {
    expect(ok(parseServerConfig({}, DEFAULTS)).nodeEnv).toBe("development");
  });

  it("preserves a provided value", () => {
    expect(ok(parseServerConfig({ NODE_ENV: "production" }, DEFAULTS)).nodeEnv).toBe(
      "production",
    );
  });
});
