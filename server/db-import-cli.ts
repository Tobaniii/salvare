import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { parseServerConfig } from "./config";
import { defaultDatabasePath, openDatabase } from "./db";
import {
  importCouponsExport,
  importResultsExport,
  parseCouponsExport,
  parseResultsExport,
} from "./db-import";

const USAGE =
  "Usage: npm run db:import -- --coupons <path> [--results <path>]\n" +
  "       npm run db:import -- --results <path>";

function fail(message: string): never {
  console.error(`Salvare db:import: ${message}`);
  process.exit(1);
}

function parseArgs(argv: string[]): {
  coupons: string | null;
  results: string | null;
} {
  let coupons: string | null = null;
  let results: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--coupons" || arg === "--results") {
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) {
        fail(`${arg} requires a file path.\n${USAGE}`);
      }
      if (arg === "--coupons") coupons = next;
      else results = next;
      i++;
    } else {
      fail(`unrecognized argument '${arg}'.\n${USAGE}`);
    }
  }
  return { coupons, results };
}

const { coupons: couponsPath, results: resultsPath } = parseArgs(
  process.argv.slice(2),
);
if (!couponsPath && !resultsPath) {
  fail(`at least one of --coupons or --results is required.\n${USAGE}`);
}

const parsed = parseServerConfig(process.env, {
  port: 0,
  dbPath: defaultDatabasePath(),
});
if (!parsed.ok) {
  fail(`invalid configuration — ${parsed.error}`);
}

const dbPath = resolve(parsed.config.dbPath);
const normalizedDb = dbPath.replace(/\\/g, "/");
if (
  normalizedDb.includes("/smoke/") &&
  basename(normalizedDb) === "salvare.db"
) {
  fail(
    `refusing to import into smoke database at ${dbPath}. db:import only operates on the developer runtime DB.`,
  );
}

function readJson(path: string): unknown {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (err) {
    fail(`cannot read ${path}: ${(err as Error).message}`);
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    fail(`cannot parse ${path}: ${(err as Error).message}`);
  }
}

const db = openDatabase(dbPath);
try {
  let storesImported = 0;
  let codesImported = 0;
  let resultsImported = 0;
  let domainsReplaced = 0;

  if (couponsPath) {
    const json = readJson(couponsPath);
    const result = parseCouponsExport(json);
    if (!result.ok) {
      fail(`invalid coupons file (${couponsPath}): ${result.error}`);
    }
    const stats = importCouponsExport(db, result.value);
    storesImported = stats.storesImported;
    codesImported = stats.codesImported;
  }

  if (resultsPath) {
    const json = readJson(resultsPath);
    const result = parseResultsExport(json);
    if (!result.ok) {
      fail(`invalid results file (${resultsPath}): ${result.error}`);
    }
    const stats = importResultsExport(db, result.value);
    resultsImported = stats.resultsImported;
    domainsReplaced = stats.domainsReplaced;
  }

  const lines: string[] = [`Imported into ${dbPath}:`];
  if (couponsPath) {
    lines.push(
      `  coupons (${couponsPath}): ${storesImported} new store(s), ${codesImported} code(s) replaced/added`,
    );
  }
  if (resultsPath) {
    lines.push(
      `  results (${resultsPath}): replaced history for ${domainsReplaced} domain(s), inserted ${resultsImported} record(s)`,
    );
  }
  console.log(lines.join("\n"));
} finally {
  db.close();
}
