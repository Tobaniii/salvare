import { describe, it, expect } from "vitest";
import { openDatabase, type Db } from "./db";
import {
  recordProviderImportAttempt,
  getImportHistory,
} from "./db-source-import";

function makeDb(): Db {
  return openDatabase(":memory:");
}

function countHistory(db: Db): number {
  return (
    db.prepare("SELECT COUNT(*) AS n FROM import_history").get() as {
      n: number;
    }
  ).n;
}

describe("recordProviderImportAttempt (v0.46.0)", () => {
  it("inserts and returns an allowlisted row (nullable source_id omitted)", () => {
    const db = makeDb();
    const row = recordProviderImportAttempt(db, {
      providerId: "awin",
      domain: "shop.example",
      outcome: "error",
      candidatesAccepted: 0,
      codesImported: 0,
      provenanceRecorded: 0,
      rejectedCount: 0,
      errorCode: "fetch_error",
      durationMs: 12,
    });
    expect(row.id).toBeGreaterThan(0);
    expect(row.providerId).toBe("awin");
    expect(row.sourceId).toBeNull();
    expect(row.domain).toBe("shop.example");
    expect(row.outcome).toBe("error");
    expect(row.errorCode).toBe("fetch_error");
    expect(row.durationMs).toBe(12);
    expect(countHistory(db)).toBe(1);
  });

  it("accepts a non-null source_id that references an existing coupon_sources row", () => {
    const db = makeDb();
    // 'import' is a default-seeded coupon_sources id.
    const row = recordProviderImportAttempt(db, {
      providerId: "awin",
      sourceId: "import",
      domain: "shop.example",
      outcome: "ok",
      candidatesAccepted: 3,
      codesImported: 2,
      provenanceRecorded: 2,
      rejectedCount: 1,
      errorCode: null,
      durationMs: 8,
    });
    expect(row.sourceId).toBe("import");
    expect(row.outcome).toBe("ok");
    expect(row.codesImported).toBe(2);
  });

  it("rejects a disallowed outcome", () => {
    const db = makeDb();
    expect(() =>
      recordProviderImportAttempt(db, {
        providerId: "awin",
        domain: "shop.example",
        // @ts-expect-error intentional invalid outcome
        outcome: "rate_limited",
        candidatesAccepted: 0,
        codesImported: 0,
        provenanceRecorded: 0,
        rejectedCount: 0,
      }),
    ).toThrow();
    expect(countHistory(db)).toBe(0);
  });

  it("rejects a free-text error message (allowlist pattern only)", () => {
    const db = makeDb();
    expect(() =>
      recordProviderImportAttempt(db, {
        providerId: "awin",
        domain: "shop.example",
        outcome: "error",
        candidatesAccepted: 0,
        codesImported: 0,
        provenanceRecorded: 0,
        rejectedCount: 0,
        errorCode: "Something went wrong: TypeError at line 5",
      }),
    ).toThrow();
    expect(countHistory(db)).toBe(0);
  });

  it("rejects an invalid providerId and negative counters", () => {
    const db = makeDb();
    expect(() =>
      recordProviderImportAttempt(db, {
        providerId: "AW!N",
        domain: "shop.example",
        outcome: "ok",
        candidatesAccepted: 0,
        codesImported: 0,
        provenanceRecorded: 0,
        rejectedCount: 0,
      }),
    ).toThrow();
    expect(() =>
      recordProviderImportAttempt(db, {
        providerId: "awin",
        domain: "shop.example",
        outcome: "ok",
        candidatesAccepted: -1,
        codesImported: 0,
        provenanceRecorded: 0,
        rejectedCount: 0,
      }),
    ).toThrow();
    expect(countHistory(db)).toBe(0);
  });

  it("rejects an invalid domain", () => {
    const db = makeDb();
    expect(() =>
      recordProviderImportAttempt(db, {
        providerId: "awin",
        domain: "  ",
        outcome: "ok",
        candidatesAccepted: 0,
        codesImported: 0,
        provenanceRecorded: 0,
        rejectedCount: 0,
      }),
    ).toThrow();
  });
});

describe("getImportHistory (v0.46.0)", () => {
  function seed(db: Db): void {
    recordProviderImportAttempt(db, {
      providerId: "awin",
      sourceId: "import",
      domain: "a.example",
      outcome: "ok",
      candidatesAccepted: 1,
      codesImported: 1,
      provenanceRecorded: 1,
      rejectedCount: 0,
      attemptedAt: "2026-05-10T00:00:00.000Z",
    });
    recordProviderImportAttempt(db, {
      providerId: "awin",
      domain: "b.example",
      outcome: "error",
      candidatesAccepted: 0,
      codesImported: 0,
      provenanceRecorded: 0,
      rejectedCount: 0,
      errorCode: "disabled",
      attemptedAt: "2026-05-12T00:00:00.000Z",
    });
  }

  it("returns rows newest-first", () => {
    const db = makeDb();
    seed(db);
    const { rows, truncated } = getImportHistory(db);
    expect(truncated).toBe(false);
    expect(rows.map((r) => r.domain)).toEqual(["b.example", "a.example"]);
  });

  it("filters by provider and by from/to", () => {
    const db = makeDb();
    seed(db);
    expect(
      getImportHistory(db, { provider: "awin" }).rows.length,
    ).toBe(2);
    const windowed = getImportHistory(db, {
      from: "2026-05-11T00:00:00.000Z",
      to: "2026-05-13T00:00:00.000Z",
    });
    expect(windowed.rows.map((r) => r.domain)).toEqual(["b.example"]);
  });

  it("rejects an invalid provider filter and invalid ISO bounds", () => {
    const db = makeDb();
    expect(() => getImportHistory(db, { provider: "BAD!" })).toThrow();
    expect(() => getImportHistory(db, { from: "not-a-date" })).toThrow();
  });
});
