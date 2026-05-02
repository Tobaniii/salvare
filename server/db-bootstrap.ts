import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Db } from "./db";

export interface SeedData {
  [domain: string]: string[];
}

export interface ResultsEnvelope {
  results: Array<{
    domain: string;
    code: string;
    success: boolean;
    savingsCents: number;
    finalTotalCents: number;
    testedAt: string;
  }>;
}

export interface BootstrapStats {
  storesImported: number;
  codesImported: number;
  resultsImported: number;
}

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const SEED_PATH = join(SERVER_DIR, "coupons.seed.json");
const RESULTS_PATH = join(SERVER_DIR, "coupon-results.json");

export function importSeed(
  db: Db,
  seed: SeedData,
  now: string = new Date().toISOString(),
): { storesImported: number; codesImported: number } {
  const storeInsert = db.prepare(
    `INSERT OR IGNORE INTO stores (domain, created_at, updated_at) VALUES (?, ?, ?)`,
  );
  const storeLookup = db.prepare(`SELECT id FROM stores WHERE domain = ?`);
  const codeInsert = db.prepare(
    `INSERT OR IGNORE INTO coupon_codes (store_id, code, created_at, updated_at) VALUES (?, ?, ?, ?)`,
  );

  let storesImported = 0;
  let codesImported = 0;

  const txn = db.transaction((data: SeedData) => {
    for (const [domain, codeList] of Object.entries(data)) {
      const storeResult = storeInsert.run(domain, now, now);
      if (storeResult.changes > 0) storesImported++;
      const storeRow = storeLookup.get(domain) as { id: number } | undefined;
      if (!storeRow) continue;
      const storeId = storeRow.id;
      for (const code of codeList) {
        const codeResult = codeInsert.run(storeId, code, now, now);
        if (codeResult.changes > 0) codesImported++;
      }
    }
  });

  txn(seed);
  return { storesImported, codesImported };
}

// Result history is cleared and reimported from JSON. Phase 2 assumption:
// the JSON file is the only writer of result history. When routes start
// writing directly to the DB (Phase 4), this strategy must be revisited.
export function importResults(
  db: Db,
  envelope: ResultsEnvelope,
  now: string = new Date().toISOString(),
): { resultsImported: number } {
  const records = Array.isArray(envelope?.results) ? envelope.results : [];

  const storeInsert = db.prepare(
    `INSERT OR IGNORE INTO stores (domain, created_at, updated_at) VALUES (?, ?, ?)`,
  );
  const storeLookup = db.prepare(`SELECT id FROM stores WHERE domain = ?`);
  const resultInsert = db.prepare(
    `INSERT INTO coupon_results
       (store_id, code, success, savings_cents, final_total_cents, tested_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const clearResults = db.prepare(`DELETE FROM coupon_results`);

  const txn = db.transaction(() => {
    clearResults.run();
    for (const r of records) {
      storeInsert.run(r.domain, now, now);
      const storeRow = storeLookup.get(r.domain) as
        | { id: number }
        | undefined;
      if (!storeRow) continue;
      resultInsert.run(
        storeRow.id,
        r.code,
        r.success ? 1 : 0,
        r.savingsCents,
        r.finalTotalCents,
        r.testedAt,
      );
    }
  });

  txn();
  return { resultsImported: records.length };
}

export function readSeedFromDisk(): SeedData {
  try {
    const raw = readFileSync(SEED_PATH, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as SeedData;
    }
  } catch {
    // Fall through to empty default.
  }
  return {};
}

export function readResultsFromDisk(): ResultsEnvelope {
  try {
    const raw = readFileSync(RESULTS_PATH, "utf8");
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === "object" &&
      Array.isArray((parsed as { results?: unknown }).results)
    ) {
      return parsed as ResultsEnvelope;
    }
  } catch {
    // Fall through to empty default.
  }
  return { results: [] };
}

export function bootstrapFromJson(db: Db): BootstrapStats {
  const seed = readSeedFromDisk();
  const envelope = readResultsFromDisk();
  const seedStats = importSeed(db, seed);
  const resultsStats = importResults(db, envelope);
  return {
    storesImported: seedStats.storesImported,
    codesImported: seedStats.codesImported,
    resultsImported: resultsStats.resultsImported,
  };
}
