import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { EXPECTED_SCHEMA_VERSION, initSchema, openDatabase } from "./db";

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

  it("creates schema_meta and stores the expected version", () => {
    const db = makeMemoryDb();
    const tables = listTables(db);
    expect(tables).toContain("schema_meta");
    const row = db
      .prepare("SELECT value FROM schema_meta WHERE key = 'version'")
      .get() as { value: string } | undefined;
    expect(row?.value).toBe(EXPECTED_SCHEMA_VERSION);
  });

  it("schema_meta version upsert is idempotent", () => {
    const db = makeMemoryDb();
    initSchema(db);
    initSchema(db);
    const rows = db
      .prepare("SELECT value FROM schema_meta WHERE key = 'version'")
      .all() as Array<{ value: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].value).toBe(EXPECTED_SCHEMA_VERSION);
  });

  it("creates coupon_sources and coupon_code_sources tables", () => {
    const db = makeMemoryDb();
    const tables = listTables(db);
    expect(tables).toContain("coupon_sources");
    expect(tables).toContain("coupon_code_sources");
  });

  it("creates the expected coupon_code_sources indexes", () => {
    const db = makeMemoryDb();
    const indexes = listIndexes(db);
    expect(indexes).toContain("idx_coupon_code_sources_store_code");
    expect(indexes).toContain("idx_coupon_code_sources_source");
  });

  it("seeds default coupon_sources rows (seed, admin, import)", () => {
    const db = makeMemoryDb();
    const rows = db
      .prepare("SELECT id, type, enabled FROM coupon_sources ORDER BY id ASC")
      .all() as Array<{ id: string; type: string; enabled: number }>;
    const ids = rows.map((r) => r.id);
    expect(ids).toEqual(["admin", "import", "seed"]);
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get("seed")?.type).toBe("seed");
    expect(byId.get("admin")?.type).toBe("manual");
    expect(byId.get("import")?.type).toBe("import");
    for (const r of rows) {
      expect(r.enabled).toBe(1);
    }
  });

  it("default coupon_sources rows are not duplicated on repeated initSchema", () => {
    const db = makeMemoryDb();
    initSchema(db);
    initSchema(db);
    const count = (
      db
        .prepare(
          "SELECT COUNT(*) AS c FROM coupon_sources WHERE id IN ('seed','admin','import')",
        )
        .get() as { c: number }
    ).c;
    expect(count).toBe(3);
  });

  it("EXPECTED_SCHEMA_VERSION reflects the v0.29.0 bump", () => {
    expect(EXPECTED_SCHEMA_VERSION).toBe("3");
  });

  it("creates source_cache and source_fetch_log tables (v0.29.0)", () => {
    const db = makeMemoryDb();
    const tables = listTables(db);
    expect(tables).toContain("source_cache");
    expect(tables).toContain("source_fetch_log");
  });

  it("creates the expected source cache/log indexes", () => {
    const db = makeMemoryDb();
    const indexes = listIndexes(db);
    expect(indexes).toContain("idx_source_cache_expires_at");
    expect(indexes).toContain("idx_source_fetch_log_source_attempt");
    expect(indexes).toContain("idx_source_fetch_log_source_key_attempt");
  });

  it("source_cache rejects an invalid source_id reference", () => {
    const db = makeMemoryDb();
    expect(() =>
      db
        .prepare(
          `INSERT INTO source_cache
             (source_id, cache_key, fetched_at, expires_at, status)
             VALUES (?, ?, ?, ?, ?)`,
        )
        .run(
          "no-such-source",
          "k",
          "2026-05-09T00:00:00.000Z",
          "2026-05-09T01:00:00.000Z",
          "ok",
        ),
    ).toThrow();
  });

  it("source_fetch_log rejects an invalid source_id reference", () => {
    const db = makeMemoryDb();
    expect(() =>
      db
        .prepare(
          `INSERT INTO source_fetch_log
             (source_id, cache_key, attempted_at, outcome)
             VALUES (?, ?, ?, ?)`,
        )
        .run("no-such-source", "k", "2026-05-09T00:00:00.000Z", "ok"),
    ).toThrow();
  });

  it("coupon_sources delete is restricted while source_cache references it", () => {
    const db = makeMemoryDb();
    db.prepare(
      `INSERT INTO source_cache
         (source_id, cache_key, fetched_at, expires_at, status)
         VALUES (?, ?, ?, ?, ?)`,
    ).run(
      "seed",
      "k",
      "2026-05-09T00:00:00.000Z",
      "2026-05-09T01:00:00.000Z",
      "ok",
    );
    expect(() =>
      db.prepare("DELETE FROM coupon_sources WHERE id = 'seed'").run(),
    ).toThrow();
  });

  it("coupon_sources delete is restricted while source_fetch_log references it", () => {
    const db = makeMemoryDb();
    db.prepare(
      `INSERT INTO source_fetch_log
         (source_id, cache_key, attempted_at, outcome)
         VALUES (?, ?, ?, ?)`,
    ).run("seed", "k", "2026-05-09T00:00:00.000Z", "ok");
    expect(() =>
      db.prepare("DELETE FROM coupon_sources WHERE id = 'seed'").run(),
    ).toThrow();
  });

  it("coupon_code_sources rejects an invalid source_id reference", () => {
    const db = makeMemoryDb();
    db.prepare(
      "INSERT INTO stores (domain, created_at, updated_at) VALUES ('a.com', '', '')",
    ).run();
    const storeId = (
      db.prepare("SELECT id FROM stores WHERE domain = 'a.com'").get() as {
        id: number;
      }
    ).id;
    expect(() =>
      db
        .prepare(
          `INSERT INTO coupon_code_sources
             (store_id, code, source_id, discovered_at)
             VALUES (?, ?, ?, ?)`,
        )
        .run(storeId, "WELCOME10", "no-such-source", "2026-05-04T00:00:00.000Z"),
    ).toThrow();
  });

  it("coupon_code_sources cascades on store deletion", () => {
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
      `INSERT INTO coupon_code_sources
         (store_id, code, source_id, discovered_at)
         VALUES (?, ?, 'seed', ?)`,
    ).run(storeId, "WELCOME10", "2026-05-04T00:00:00.000Z");
    db.prepare("DELETE FROM stores WHERE id = ?").run(storeId);
    const remaining = (
      db
        .prepare("SELECT COUNT(*) AS c FROM coupon_code_sources")
        .get() as { c: number }
    ).c;
    expect(remaining).toBe(0);
  });

  it("coupon_sources delete is restricted while provenance references it", () => {
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
      `INSERT INTO coupon_code_sources
         (store_id, code, source_id, discovered_at)
         VALUES (?, ?, 'seed', ?)`,
    ).run(storeId, "WELCOME10", "2026-05-04T00:00:00.000Z");
    expect(() =>
      db.prepare("DELETE FROM coupon_sources WHERE id = 'seed'").run(),
    ).toThrow();
  });
});
