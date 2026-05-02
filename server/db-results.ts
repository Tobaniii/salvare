import type { Db } from "./db";
import { readResultsFromDisk, type ResultsEnvelope } from "./db-bootstrap";
import type { ResultRecord } from "./results";

function nowIso(): string {
  return new Date().toISOString();
}

interface ResultRow {
  domain: string;
  code: string;
  success: number;
  savings_cents: number;
  final_total_cents: number;
  tested_at: string;
}

function rowToRecord(row: ResultRow): ResultRecord {
  return {
    domain: row.domain,
    code: row.code,
    success: row.success === 1,
    savingsCents: row.savings_cents,
    finalTotalCents: row.final_total_cents,
    testedAt: row.tested_at,
  };
}

export function appendResultRecord(
  db: Db,
  record: Omit<ResultRecord, "testedAt">,
  now: () => Date = () => new Date(),
): ResultRecord {
  const testedAt = now().toISOString();
  const upsertStore = db.prepare(
    `INSERT INTO stores (domain, created_at, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(domain) DO UPDATE SET updated_at = excluded.updated_at`,
  );
  const lookupStore = db.prepare(`SELECT id FROM stores WHERE domain = ?`);
  const insertResult = db.prepare(
    `INSERT INTO coupon_results
       (store_id, code, success, savings_cents, final_total_cents, tested_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );

  const txn = db.transaction(() => {
    upsertStore.run(record.domain, testedAt, testedAt);
    const storeRow = lookupStore.get(record.domain) as
      | { id: number }
      | undefined;
    if (!storeRow) {
      throw new Error("store row missing after upsert");
    }
    insertResult.run(
      storeRow.id,
      record.code,
      record.success ? 1 : 0,
      record.savingsCents,
      record.finalTotalCents,
      testedAt,
    );
  });
  txn();

  return { ...record, testedAt };
}

export function getResultsForDomain(
  db: Db,
  domain: string,
): ResultRecord[] {
  const trimmed = domain.trim();
  const rows = db
    .prepare(
      `SELECT s.domain AS domain,
              r.code AS code,
              r.success AS success,
              r.savings_cents AS savings_cents,
              r.final_total_cents AS final_total_cents,
              r.tested_at AS tested_at
         FROM coupon_results r
         JOIN stores s ON s.id = r.store_id
        WHERE s.domain = ?
        ORDER BY r.id ASC`,
    )
    .all(trimmed) as ResultRow[];
  return rows.map(rowToRecord);
}

export function deleteResultsForDomain(
  db: Db,
  domain: string,
): { domain: string; deletedCount: number } {
  const trimmed = domain.trim();
  const result = db
    .prepare(
      `DELETE FROM coupon_results
        WHERE store_id IN (SELECT id FROM stores WHERE domain = ?)`,
    )
    .run(trimmed);
  return { domain: trimmed, deletedCount: result.changes };
}

export function getAllResults(db: Db): ResultRecord[] {
  const rows = db
    .prepare(
      `SELECT s.domain AS domain,
              r.code AS code,
              r.success AS success,
              r.savings_cents AS savings_cents,
              r.final_total_cents AS final_total_cents,
              r.tested_at AS tested_at
         FROM coupon_results r
         JOIN stores s ON s.id = r.store_id
        ORDER BY r.id ASC`,
    )
    .all() as ResultRow[];
  return rows.map(rowToRecord);
}

export function bootstrapResultsIfEmpty(
  db: Db,
  envelopeOverride?: ResultsEnvelope,
): { bootstrapped: boolean; resultsImported: number } {
  const count = (
    db.prepare(`SELECT COUNT(*) AS c FROM coupon_results`).get() as {
      c: number;
    }
  ).c;
  if (count > 0) {
    return { bootstrapped: false, resultsImported: 0 };
  }

  const envelope = envelopeOverride ?? readResultsFromDisk();
  const records = Array.isArray(envelope?.results) ? envelope.results : [];
  if (records.length === 0) {
    return { bootstrapped: false, resultsImported: 0 };
  }

  const now = nowIso();
  const upsertStore = db.prepare(
    `INSERT OR IGNORE INTO stores (domain, created_at, updated_at)
       VALUES (?, ?, ?)`,
  );
  const lookupStore = db.prepare(`SELECT id FROM stores WHERE domain = ?`);
  const insertResult = db.prepare(
    `INSERT INTO coupon_results
       (store_id, code, success, savings_cents, final_total_cents, tested_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );

  let resultsImported = 0;
  const txn = db.transaction(() => {
    for (const r of records) {
      upsertStore.run(r.domain, now, now);
      const storeRow = lookupStore.get(r.domain) as
        | { id: number }
        | undefined;
      if (!storeRow) continue;
      insertResult.run(
        storeRow.id,
        r.code,
        r.success ? 1 : 0,
        r.savingsCents,
        r.finalTotalCents,
        r.testedAt,
      );
      resultsImported++;
    }
  });
  txn();

  return { bootstrapped: true, resultsImported };
}
