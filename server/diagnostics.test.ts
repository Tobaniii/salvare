import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { openDatabase } from "./db";
import { upsertCouponCodes } from "./db-coupons";
import { appendResultRecord } from "./db-results";
import {
  buildStartupDiagnostics,
  getDatabaseStatus,
  type DatabaseStatus,
} from "./diagnostics";
import type { ServerConfig } from "./config";

function freshDb() {
  return openDatabase(":memory:");
}

const BASE_CONFIG: ServerConfig = {
  port: 4123,
  dbPath: "server/salvare.db",
  adminToken: null,
  nodeEnv: "development",
};

const EMPTY_BOOTSTRAP = {
  storesImported: 0,
  codesImported: 0,
  resultsImported: 0,
};

describe("getDatabaseStatus", () => {
  it("reports schema initialized + empty data on a fresh openDatabase", () => {
    const db = freshDb();
    expect(getDatabaseStatus(db)).toEqual({
      schemaInitialized: true,
      hasCoupons: false,
      hasResults: false,
    });
  });

  it("reports hasCoupons after upsertCouponCodes", () => {
    const db = freshDb();
    upsertCouponCodes(db, "smoke.test", ["A1"]);
    expect(getDatabaseStatus(db)).toEqual({
      schemaInitialized: true,
      hasCoupons: true,
      hasResults: false,
    });
  });

  it("reports hasResults after appendResultRecord", () => {
    const db = freshDb();
    appendResultRecord(db, {
      domain: "smoke.test",
      code: "A1",
      success: true,
      savingsCents: 100,
      finalTotalCents: 900,
    });
    expect(getDatabaseStatus(db)).toEqual({
      schemaInitialized: true,
      hasCoupons: true,
      hasResults: true,
    });
  });

  it("reports schemaInitialized: false on a raw uninitialized database", () => {
    // Bypass openDatabase so the schema is never applied.
    const raw = new Database(":memory:");
    const status = getDatabaseStatus(raw);
    raw.close();
    expect(status).toEqual({
      schemaInitialized: false,
      hasCoupons: false,
      hasResults: false,
    });
  });
});

describe("buildStartupDiagnostics", () => {
  const status: DatabaseStatus = {
    schemaInitialized: true,
    hasCoupons: true,
    hasResults: false,
  };

  it("renders the canonical lines", () => {
    const out = buildStartupDiagnostics({
      config: BASE_CONFIG,
      status,
      bootstrap: EMPTY_BOOTSTRAP,
      listenUrl: "http://localhost:4123",
    });
    expect(out).toContain("Salvare backend starting...");
    expect(out).toContain("Port: 4123");
    expect(out).toContain("Database: server/salvare.db");
    expect(out).toContain("Schema: initialized");
    expect(out).toContain("Admin auth: DISABLED");
    expect(out).toContain("Coupon data: present");
    expect(out).toContain("Result history: empty");
    expect(out).toContain("Listening: http://localhost:4123");
  });

  it("shows ENABLED when adminToken is set", () => {
    const out = buildStartupDiagnostics({
      config: { ...BASE_CONFIG, adminToken: "super-secret-1234" },
      status,
      bootstrap: EMPTY_BOOTSTRAP,
      listenUrl: "http://localhost:4123",
    });
    expect(out).toContain("Admin auth: ENABLED");
  });

  it("never includes the admin token value", () => {
    const sensitive = "this-must-not-appear-in-output-9c7e1a2b";
    const out = buildStartupDiagnostics({
      config: { ...BASE_CONFIG, adminToken: sensitive },
      status,
      bootstrap: EMPTY_BOOTSTRAP,
      listenUrl: "http://localhost:4123",
    });
    expect(out).not.toContain(sensitive);
    expect(out).not.toMatch(/Bearer/i);
  });

  it("prints schema: missing when database has no schema", () => {
    const out = buildStartupDiagnostics({
      config: BASE_CONFIG,
      status: {
        schemaInitialized: false,
        hasCoupons: false,
        hasResults: false,
      },
      bootstrap: EMPTY_BOOTSTRAP,
      listenUrl: "http://localhost:4123",
    });
    expect(out).toContain("Schema: missing");
  });

  it("includes a Bootstrap line when JSON imports happened", () => {
    const out = buildStartupDiagnostics({
      config: BASE_CONFIG,
      status,
      bootstrap: { storesImported: 3, codesImported: 9, resultsImported: 7 },
      listenUrl: "http://localhost:4123",
    });
    expect(out).toContain(
      "Bootstrap: imported 3 store(s), 9 code(s), 7 result(s) from JSON.",
    );
  });

  it("omits the Bootstrap line when nothing was imported on this start", () => {
    const out = buildStartupDiagnostics({
      config: BASE_CONFIG,
      status,
      bootstrap: EMPTY_BOOTSTRAP,
      listenUrl: "http://localhost:4123",
    });
    expect(out).not.toContain("Bootstrap:");
  });

  it("does not open or read server/salvare.db", () => {
    // Diagnostic generation is pure given an injected status — no file I/O.
    // Building from a fully-injected payload should produce a string with no
    // exception even when the dbPath is bogus.
    const out = buildStartupDiagnostics({
      config: { ...BASE_CONFIG, dbPath: "/this/path/does/not/exist.db" },
      status,
      bootstrap: EMPTY_BOOTSTRAP,
      listenUrl: "http://localhost:4123",
    });
    expect(out).toContain("Database: /this/path/does/not/exist.db");
  });
});
