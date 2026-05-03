// Local data maintenance helpers for the SQLite runtime DB.
//
// Pure functions; no env/CLI side effects. The thin CLIs in
// db-{backup,export,reset}-cli.ts wire `parseServerConfig` into these.
// Outputs land in caller-provided directories and are gitignored.

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";
import { initSchema, openDatabase, type Db } from "./db";
import { getAllSeedData } from "./db-coupons";
import { getAllResults } from "./db-results";
import {
  bootstrapFromJson,
  importResults,
  importSeed,
  type BootstrapStats,
  type ResultsEnvelope,
  type SeedData,
} from "./db-bootstrap";

export function timestampStamp(now: Date = new Date()): string {
  return now.toISOString().replace(/[-:]/g, "").replace(/\..*$/, "Z");
}

const SQLITE_SIDECARS = ["-journal", "-wal", "-shm"] as const;

export interface BackupResult {
  source: string;
  backupPath: string;
}

export function backupDatabase(
  dbPath: string,
  backupsDir: string,
  now: Date = new Date(),
): BackupResult {
  const source = resolve(dbPath);
  if (!existsSync(source)) {
    throw new Error(
      `cannot back up — database file does not exist at ${source}. Start the server or run 'npm run db:init' first.`,
    );
  }
  mkdirSync(backupsDir, { recursive: true });
  const backupPath = join(backupsDir, `salvare-${timestampStamp(now)}.db`);
  if (existsSync(backupPath)) {
    throw new Error(
      `refusing to overwrite existing backup at ${backupPath}.`,
    );
  }
  copyFileSync(source, backupPath);
  return { source, backupPath: resolve(backupPath) };
}

export interface ExportResult {
  couponsPath: string;
  resultsPath: string;
  storeCount: number;
  resultCount: number;
}

export function buildExportPayloads(db: Db): {
  coupons: SeedData;
  results: ResultsEnvelope;
} {
  const coupons = getAllSeedData(db);
  const results: ResultsEnvelope = {
    results: getAllResults(db).map((r) => ({
      domain: r.domain,
      code: r.code,
      success: r.success,
      savingsCents: r.savingsCents,
      finalTotalCents: r.finalTotalCents,
      testedAt: r.testedAt,
    })),
  };
  return { coupons, results };
}

export function exportDatabase(
  db: Db,
  exportsDir: string,
  now: Date = new Date(),
): ExportResult {
  mkdirSync(exportsDir, { recursive: true });
  const stamp = timestampStamp(now);
  const couponsPath = join(exportsDir, `coupons-${stamp}.json`);
  const resultsPath = join(exportsDir, `coupon-results-${stamp}.json`);
  if (existsSync(couponsPath)) {
    throw new Error(`refusing to overwrite existing export at ${couponsPath}.`);
  }
  if (existsSync(resultsPath)) {
    throw new Error(`refusing to overwrite existing export at ${resultsPath}.`);
  }
  const { coupons, results } = buildExportPayloads(db);
  writeFileSync(couponsPath, JSON.stringify(coupons, null, 2) + "\n", "utf8");
  writeFileSync(resultsPath, JSON.stringify(results, null, 2) + "\n", "utf8");
  return {
    couponsPath: resolve(couponsPath),
    resultsPath: resolve(resultsPath),
    storeCount: Object.keys(coupons).length,
    resultCount: results.results.length,
  };
}

export interface ResetSources {
  seed?: SeedData;
  results?: ResultsEnvelope;
}

export interface ResetResult extends BootstrapStats {
  dbPath: string;
}

// Refuses paths whose basename matches the smoke DB filename, even if the
// smoke harness uses :memory: today — defense in depth so a future on-disk
// smoke DB isn't accidentally wiped by `npm run db:reset`.
const SMOKE_DB_BASENAME = "salvare.db";
function isSmokeDbPath(dbPath: string): boolean {
  const normalized = resolve(dbPath).replace(/\\/g, "/");
  return (
    normalized.includes("/smoke/") &&
    basename(normalized) === SMOKE_DB_BASENAME
  );
}

export function resetDatabase(
  dbPath: string,
  sources: ResetSources = {},
): ResetResult {
  const target = resolve(dbPath);
  if (isSmokeDbPath(target)) {
    throw new Error(
      `refusing to reset smoke database at ${target}. db:reset only operates on the developer runtime DB.`,
    );
  }

  rmSync(target, { force: true });
  for (const suffix of SQLITE_SIDECARS) {
    rmSync(`${target}${suffix}`, { force: true });
  }

  const db = openDatabase(target);
  initSchema(db);
  let stats: BootstrapStats;
  try {
    if (sources.seed || sources.results) {
      const seedStats = sources.seed
        ? importSeed(db, sources.seed)
        : { storesImported: 0, codesImported: 0 };
      const resultStats = sources.results
        ? importResults(db, sources.results)
        : { resultsImported: 0 };
      stats = {
        storesImported: seedStats.storesImported,
        codesImported: seedStats.codesImported,
        resultsImported: resultStats.resultsImported,
      };
    } else {
      stats = bootstrapFromJson(db);
    }
  } finally {
    db.close();
  }

  return { dbPath: target, ...stats };
}
