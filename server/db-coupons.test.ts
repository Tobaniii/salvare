import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase, type Db } from "./db";
import {
  bootstrapIfEmpty,
  deleteCouponDomain,
  getAllSeedData,
  getCandidateCodesForDomain,
  upsertCouponCodes,
} from "./db-coupons";

function memoryDb(): Db {
  return openDatabase(":memory:");
}

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function tempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "salvare-test-"));
  tempDirs.push(dir);
  return join(dir, "salvare.db");
}

describe("getCandidateCodesForDomain", () => {
  it("returns codes for a domain in seed insertion order", () => {
    const db = memoryDb();
    upsertCouponCodes(db, "a.com", ["FIRST", "SECOND", "THIRD"]);
    expect(getCandidateCodesForDomain(db, "a.com")).toEqual([
      "FIRST",
      "SECOND",
      "THIRD",
    ]);
  });

  it("returns [] for an unsupported domain", () => {
    const db = memoryDb();
    upsertCouponCodes(db, "a.com", ["A1"]);
    expect(getCandidateCodesForDomain(db, "missing.com")).toEqual([]);
  });
});

describe("getAllSeedData", () => {
  it("groups codes by domain", () => {
    const db = memoryDb();
    upsertCouponCodes(db, "a.com", ["A1", "A2"]);
    upsertCouponCodes(db, "b.com", ["B1"]);
    expect(getAllSeedData(db)).toEqual({
      "a.com": ["A1", "A2"],
      "b.com": ["B1"],
    });
  });

  it("returns {} for an empty database", () => {
    const db = memoryDb();
    expect(getAllSeedData(db)).toEqual({});
  });
});

describe("upsertCouponCodes", () => {
  it("adds a new domain with the given codes", () => {
    const db = memoryDb();
    const result = upsertCouponCodes(db, "a.com", ["A1"]);
    expect(result).toEqual({
      domain: "a.com",
      candidateCodes: ["A1"],
    });
    expect(getCandidateCodesForDomain(db, "a.com")).toEqual(["A1"]);
  });

  it("replaces existing codes for a domain", () => {
    const db = memoryDb();
    upsertCouponCodes(db, "a.com", ["A1", "A2"]);
    upsertCouponCodes(db, "a.com", ["NEW1"]);
    expect(getCandidateCodesForDomain(db, "a.com")).toEqual(["NEW1"]);
  });

  it("trims and dedupes codes", () => {
    const db = memoryDb();
    const result = upsertCouponCodes(db, "  a.com  ", [
      " A ",
      "A",
      "B",
      "B",
      " C",
    ]);
    expect(result).toEqual({
      domain: "a.com",
      candidateCodes: ["A", "B", "C"],
    });
    expect(getCandidateCodesForDomain(db, "a.com")).toEqual(["A", "B", "C"]);
  });
});

describe("deleteCouponDomain", () => {
  it("removes the domain and cascades to coupon_codes", () => {
    const db = memoryDb();
    upsertCouponCodes(db, "a.com", ["A1", "A2"]);
    const result = deleteCouponDomain(db, "a.com");
    expect(result).toEqual({ deleted: true, domain: "a.com" });
    expect(getCandidateCodesForDomain(db, "a.com")).toEqual([]);
  });

  it("returns deleted: false for a missing domain", () => {
    const db = memoryDb();
    const result = deleteCouponDomain(db, "missing.com");
    expect(result).toEqual({ deleted: false, domain: "missing.com" });
  });

  it("trims whitespace before deleting", () => {
    const db = memoryDb();
    upsertCouponCodes(db, "a.com", ["A1"]);
    const result = deleteCouponDomain(db, "  a.com  ");
    expect(result).toEqual({ deleted: true, domain: "a.com" });
  });
});

describe("bootstrapIfEmpty", () => {
  it("imports the seed when stores is empty", () => {
    const db = memoryDb();
    const stats = bootstrapIfEmpty(db, { "a.com": ["A1", "A2"] });
    expect(stats).toEqual({
      bootstrapped: true,
      storesImported: 1,
      codesImported: 2,
    });
    expect(getCandidateCodesForDomain(db, "a.com")).toEqual(["A1", "A2"]);
  });

  it("no-ops when the database already has data", () => {
    const db = memoryDb();
    upsertCouponCodes(db, "existing.com", ["X1"]);
    const stats = bootstrapIfEmpty(db, { "a.com": ["A1"] });
    expect(stats).toEqual({
      bootstrapped: false,
      storesImported: 0,
      codesImported: 0,
    });
    expect(getCandidateCodesForDomain(db, "a.com")).toEqual([]);
    expect(getCandidateCodesForDomain(db, "existing.com")).toEqual(["X1"]);
  });
});

describe("persistence across reopen", () => {
  it("persists upsert/delete changes to the database file", () => {
    const path = tempDbPath();

    let db = openDatabase(path);
    upsertCouponCodes(db, "a.com", ["A1", "A2"]);
    upsertCouponCodes(db, "b.com", ["B1"]);
    db.close();

    db = openDatabase(path);
    expect(getCandidateCodesForDomain(db, "a.com")).toEqual(["A1", "A2"]);
    expect(getAllSeedData(db)).toEqual({
      "a.com": ["A1", "A2"],
      "b.com": ["B1"],
    });
    deleteCouponDomain(db, "a.com");
    db.close();

    db = openDatabase(path);
    expect(getCandidateCodesForDomain(db, "a.com")).toEqual([]);
    expect(getAllSeedData(db)).toEqual({ "b.com": ["B1"] });
    db.close();
  });
});
