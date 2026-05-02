import type { Db } from "./db";
import {
  importSeed,
  readSeedFromDisk,
  type SeedData,
} from "./db-bootstrap";

function nowIso(): string {
  return new Date().toISOString();
}

export function getCandidateCodesForDomain(
  db: Db,
  domain: string,
): string[] {
  const trimmed = domain.trim();
  const rows = db
    .prepare(
      `SELECT c.code AS code
         FROM coupon_codes c
         JOIN stores s ON s.id = c.store_id
        WHERE s.domain = ?
        ORDER BY c.id ASC`,
    )
    .all(trimmed) as Array<{ code: string }>;
  return rows.map((r) => r.code);
}

export function getAllSeedData(db: Db): Record<string, string[]> {
  const rows = db
    .prepare(
      `SELECT s.domain AS domain, c.code AS code
         FROM stores s
         LEFT JOIN coupon_codes c ON c.store_id = s.id
        ORDER BY s.id ASC, c.id ASC`,
    )
    .all() as Array<{ domain: string; code: string | null }>;

  const result: Record<string, string[]> = {};
  for (const row of rows) {
    if (!result[row.domain]) result[row.domain] = [];
    if (row.code !== null) result[row.domain].push(row.code);
  }
  return result;
}

export function upsertCouponCodes(
  db: Db,
  domain: string,
  codes: string[],
): { domain: string; candidateCodes: string[] } {
  const trimmedDomain = domain.trim();
  const normalizedCodes = [...new Set(codes.map((c) => c.trim()))];
  const now = nowIso();

  const upsertStore = db.prepare(
    `INSERT INTO stores (domain, created_at, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(domain) DO UPDATE SET updated_at = excluded.updated_at`,
  );
  const lookupStore = db.prepare(
    `SELECT id FROM stores WHERE domain = ?`,
  );
  const deleteCodes = db.prepare(
    `DELETE FROM coupon_codes WHERE store_id = ?`,
  );
  const insertCode = db.prepare(
    `INSERT INTO coupon_codes (store_id, code, created_at, updated_at)
       VALUES (?, ?, ?, ?)`,
  );

  const txn = db.transaction(() => {
    upsertStore.run(trimmedDomain, now, now);
    const storeRow = lookupStore.get(trimmedDomain) as
      | { id: number }
      | undefined;
    if (!storeRow) {
      throw new Error("store row missing after upsert");
    }
    deleteCodes.run(storeRow.id);
    for (const code of normalizedCodes) {
      insertCode.run(storeRow.id, code, now, now);
    }
  });
  txn();

  return { domain: trimmedDomain, candidateCodes: normalizedCodes };
}

export function deleteCouponDomain(
  db: Db,
  domain: string,
): { deleted: boolean; domain: string } {
  const trimmed = domain.trim();
  const result = db
    .prepare(`DELETE FROM stores WHERE domain = ?`)
    .run(trimmed);
  return { deleted: result.changes > 0, domain: trimmed };
}

export function bootstrapIfEmpty(
  db: Db,
  seedOverride?: SeedData,
): { bootstrapped: boolean; storesImported: number; codesImported: number } {
  const count = (
    db.prepare(`SELECT COUNT(*) AS c FROM stores`).get() as { c: number }
  ).c;
  if (count > 0) {
    return { bootstrapped: false, storesImported: 0, codesImported: 0 };
  }
  const seed = seedOverride ?? readSeedFromDisk();
  const stats = importSeed(db, seed);
  return {
    bootstrapped: true,
    storesImported: stats.storesImported,
    codesImported: stats.codesImported,
  };
}
