// Import previously exported Salvare JSON data into the runtime SQLite DB.
//
// Pure helpers; no env/CLI side effects. Strict shape validation: only known
// fields are imported, unknown keys (including any stray secrets such as
// `SALVARE_ADMIN_TOKEN`, `Authorization`, `dbPath`) are silently dropped.
//
// Atomicity: every write goes through `db.transaction(...)`. If validation
// fails or any insert throws, the transaction rolls back and existing data is
// left untouched — so a per-domain replace cannot delete history without
// successfully reinserting it.

import type { Db } from "./db";
import type { ResultsEnvelope, SeedData } from "./db-bootstrap";

export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

const NON_NEG_INTEGER = (n: unknown): n is number =>
  typeof n === "number" && Number.isInteger(n) && n >= 0;

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

export function parseCouponsExport(raw: unknown): ParseResult<SeedData> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      ok: false,
      error: "coupons file must be a JSON object of domain → code list",
    };
  }
  const out: SeedData = {};
  for (const [domain, codes] of Object.entries(raw as Record<string, unknown>)) {
    if (!isNonEmptyString(domain)) {
      return { ok: false, error: `invalid domain key: '${domain}'` };
    }
    if (!Array.isArray(codes)) {
      return {
        ok: false,
        error: `domain '${domain}' must map to an array of code strings`,
      };
    }
    const cleaned: string[] = [];
    for (const code of codes) {
      if (!isNonEmptyString(code)) {
        return {
          ok: false,
          error: `domain '${domain}' contains an invalid code value`,
        };
      }
      cleaned.push(code);
    }
    out[domain] = cleaned;
  }
  return { ok: true, value: out };
}

export function parseResultsExport(raw: unknown): ParseResult<ResultsEnvelope> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      ok: false,
      error: "results file must be a JSON object with a 'results' array",
    };
  }
  const arr = (raw as { results?: unknown }).results;
  if (!Array.isArray(arr)) {
    return {
      ok: false,
      error: "results file is missing a 'results' array",
    };
  }
  const out: ResultsEnvelope["results"] = [];
  for (let i = 0; i < arr.length; i++) {
    const r = arr[i];
    if (!r || typeof r !== "object") {
      return { ok: false, error: `results[${i}] must be an object` };
    }
    const rec = r as Record<string, unknown>;
    if (!isNonEmptyString(rec.domain)) {
      return { ok: false, error: `results[${i}].domain must be non-empty` };
    }
    if (!isNonEmptyString(rec.code)) {
      return { ok: false, error: `results[${i}].code must be non-empty` };
    }
    if (typeof rec.success !== "boolean") {
      return { ok: false, error: `results[${i}].success must be a boolean` };
    }
    if (!NON_NEG_INTEGER(rec.savingsCents)) {
      return {
        ok: false,
        error: `results[${i}].savingsCents must be a non-negative integer`,
      };
    }
    if (!NON_NEG_INTEGER(rec.finalTotalCents)) {
      return {
        ok: false,
        error: `results[${i}].finalTotalCents must be a non-negative integer`,
      };
    }
    if (!isNonEmptyString(rec.testedAt)) {
      return { ok: false, error: `results[${i}].testedAt must be non-empty` };
    }
    out.push({
      domain: rec.domain,
      code: rec.code,
      success: rec.success,
      savingsCents: rec.savingsCents,
      finalTotalCents: rec.finalTotalCents,
      testedAt: rec.testedAt,
    });
  }
  return { ok: true, value: { results: out } };
}

export interface CouponsImportStats {
  storesImported: number;
  codesImported: number;
}

export function importCouponsExport(
  db: Db,
  data: SeedData,
  now: string = new Date().toISOString(),
): CouponsImportStats {
  const upsertStore = db.prepare(
    `INSERT INTO stores (domain, created_at, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(domain) DO UPDATE SET updated_at = excluded.updated_at`,
  );
  const lookupStore = db.prepare(`SELECT id FROM stores WHERE domain = ?`);
  const deleteCodes = db.prepare(
    `DELETE FROM coupon_codes WHERE store_id = ?`,
  );
  const insertCode = db.prepare(
    `INSERT INTO coupon_codes (store_id, code, created_at, updated_at)
       VALUES (?, ?, ?, ?)`,
  );

  let storesImported = 0;
  let codesImported = 0;
  const seenDomains = new Set<string>();

  const txn = db.transaction((seed: SeedData) => {
    for (const [domain, codes] of Object.entries(seed)) {
      const before = lookupStore.get(domain) as { id: number } | undefined;
      upsertStore.run(domain, now, now);
      const row = lookupStore.get(domain) as { id: number } | undefined;
      if (!row) throw new Error(`store row missing after upsert: ${domain}`);
      if (!before) storesImported++;
      seenDomains.add(domain);

      deleteCodes.run(row.id);
      const unique = [...new Set(codes.map((c) => c.trim()))];
      for (const code of unique) {
        insertCode.run(row.id, code, now, now);
        codesImported++;
      }
    }
  });
  txn(data);

  return { storesImported, codesImported };
}

export interface ResultsImportStats {
  resultsImported: number;
  domainsReplaced: number;
}

export function importResultsExport(
  db: Db,
  envelope: ResultsEnvelope,
  now: string = new Date().toISOString(),
): ResultsImportStats {
  const records = envelope.results;

  const upsertStore = db.prepare(
    `INSERT INTO stores (domain, created_at, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(domain) DO UPDATE SET updated_at = excluded.updated_at`,
  );
  const lookupStore = db.prepare(`SELECT id FROM stores WHERE domain = ?`);
  const deleteResultsForDomain = db.prepare(
    `DELETE FROM coupon_results
       WHERE store_id IN (SELECT id FROM stores WHERE domain = ?)`,
  );
  const insertResult = db.prepare(
    `INSERT INTO coupon_results
       (store_id, code, success, savings_cents, final_total_cents, tested_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );

  const grouped = new Map<string, ResultsEnvelope["results"]>();
  for (const r of records) {
    const list = grouped.get(r.domain) ?? [];
    list.push(r);
    grouped.set(r.domain, list);
  }

  let resultsImported = 0;
  let domainsReplaced = 0;

  const txn = db.transaction(() => {
    for (const [domain, rows] of grouped) {
      upsertStore.run(domain, now, now);
      const storeRow = lookupStore.get(domain) as { id: number } | undefined;
      if (!storeRow) {
        throw new Error(`store row missing after upsert: ${domain}`);
      }
      deleteResultsForDomain.run(domain);
      domainsReplaced++;
      for (const r of rows) {
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
    }
  });
  txn();

  return { resultsImported, domainsReplaced };
}
