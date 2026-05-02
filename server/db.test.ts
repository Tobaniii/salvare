import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { initSchema, openDatabase } from "./db";

function makeMemoryDb() {
  return openDatabase(":memory:");
}

function listTables(db: Database.Database): string[] {
  return db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
    )
    .all()
    .map((row) => (row as { name: string }).name);
}

function listIndexes(db: Database.Database): string[] {
  return db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all()
    .map((row) => (row as { name: string }).name);
}

describe("initSchema", () => {
  it("creates the three tables", () => {
    const db = makeMemoryDb();
    const tables = listTables(db);
    expect(tables).toContain("stores");
    expect(tables).toContain("coupon_codes");
    expect(tables).toContain("coupon_results");
  });

  it("enforces UNIQUE on stores.domain", () => {
    const db = makeMemoryDb();
    const insert = db.prepare(
      "INSERT INTO stores (domain, created_at, updated_at) VALUES (?, ?, ?)",
    );
    insert.run("example.com", "2026-05-02T00:00:00.000Z", "2026-05-02T00:00:00.000Z");
    expect(() =>
      insert.run("example.com", "2026-05-02T00:00:00.000Z", "2026-05-02T00:00:00.000Z"),
    ).toThrow();
  });

  it("enforces UNIQUE(store_id, code) on coupon_codes", () => {
    const db = makeMemoryDb();
    db.prepare(
      "INSERT INTO stores (domain, created_at, updated_at) VALUES ('a.com', '', '')",
    ).run();
    const storeId = (
      db.prepare("SELECT id FROM stores WHERE domain = 'a.com'").get() as {
        id: number;
      }
    ).id;
    const insertCode = db.prepare(
      "INSERT INTO coupon_codes (store_id, code, created_at, updated_at) VALUES (?, ?, '', '')",
    );
    insertCode.run(storeId, "WELCOME10");
    expect(() => insertCode.run(storeId, "WELCOME10")).toThrow();
  });

  it("cascades deletes from stores into coupon_codes", () => {
    const db = makeMemoryDb();
    db.prepare(
      "INSERT INTO stores (domain, created_at, updated_at) VALUES ('a.com', '', '')",
    ).run();
    const storeId = (
      db.prepare("SELECT id FROM stores WHERE domain = 'a.com'").get() as {
        id: number;
      }
    ).id;
    db.prepare(
      "INSERT INTO coupon_codes (store_id, code, created_at, updated_at) VALUES (?, ?, '', '')",
    ).run(storeId, "WELCOME10");
    db.prepare("DELETE FROM stores WHERE id = ?").run(storeId);
    const remaining = db
      .prepare("SELECT COUNT(*) AS c FROM coupon_codes")
      .get() as { c: number };
    expect(remaining.c).toBe(0);
  });

  it("cascades deletes from stores into coupon_results", () => {
    const db = makeMemoryDb();
    db.prepare(
      "INSERT INTO stores (domain, created_at, updated_at) VALUES ('a.com', '', '')",
    ).run();
    const storeId = (
      db.prepare("SELECT id FROM stores WHERE domain = 'a.com'").get() as {
        id: number;
      }
    ).id;
    db.prepare(
      "INSERT INTO coupon_results (store_id, code, success, savings_cents, final_total_cents, tested_at) VALUES (?, 'A', 1, 100, 900, '2026-05-02T00:00:00.000Z')",
    ).run(storeId);
    db.prepare("DELETE FROM stores WHERE id = ?").run(storeId);
    const remaining = db
      .prepare("SELECT COUNT(*) AS c FROM coupon_results")
      .get() as { c: number };
    expect(remaining.c).toBe(0);
  });

  it("creates the expected indexes", () => {
    const db = makeMemoryDb();
    const indexes = listIndexes(db);
    expect(indexes).toContain("idx_coupon_results_store_code");
    expect(indexes).toContain("idx_coupon_results_tested_at");
  });

  it("is idempotent across repeated runs", () => {
    const db = makeMemoryDb();
    expect(() => initSchema(db)).not.toThrow();
    expect(() => initSchema(db)).not.toThrow();
    const tables = listTables(db);
    expect(tables.filter((t) => t === "stores")).toHaveLength(1);
  });
});
