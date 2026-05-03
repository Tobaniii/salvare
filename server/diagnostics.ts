// Salvare backend startup diagnostics.
//
// Pure helpers: `getDatabaseStatus(db)` reads three small COUNT/EXISTS queries
// to summarize what's in the database, and `buildStartupDiagnostics(input)`
// assembles a concise human-readable block from that status plus the resolved
// `ServerConfig`. The token value is never included in the output — the
// admin-auth line only shows ENABLED or DISABLED.

import type { Db } from "./db";
import type { ServerConfig } from "./config";

export interface DatabaseStatus {
  schemaInitialized: boolean;
  hasCoupons: boolean;
  hasResults: boolean;
}

const REQUIRED_TABLES = ["stores", "coupon_codes", "coupon_results"] as const;

export function getDatabaseStatus(db: Db): DatabaseStatus {
  const present = new Set<string>();
  try {
    const rows = db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name IN (?, ?, ?)`,
      )
      .all(...REQUIRED_TABLES) as Array<{ name: string }>;
    for (const r of rows) present.add(r.name);
  } catch {
    return { schemaInitialized: false, hasCoupons: false, hasResults: false };
  }

  const schemaInitialized = REQUIRED_TABLES.every((t) => present.has(t));
  if (!schemaInitialized) {
    return { schemaInitialized: false, hasCoupons: false, hasResults: false };
  }

  const hasCoupons = !!(
    db.prepare(`SELECT 1 AS x FROM stores LIMIT 1`).get()
  );
  const hasResults = !!(
    db.prepare(`SELECT 1 AS x FROM coupon_results LIMIT 1`).get()
  );
  return { schemaInitialized: true, hasCoupons, hasResults };
}

export interface BootstrapSummary {
  storesImported: number;
  codesImported: number;
  resultsImported: number;
}

export interface DiagnosticsInput {
  config: ServerConfig;
  status: DatabaseStatus;
  bootstrap: BootstrapSummary;
  listenUrl: string;
}

function presence(flag: boolean): string {
  return flag ? "present" : "empty";
}

export function buildStartupDiagnostics(input: DiagnosticsInput): string {
  const { config, status, bootstrap, listenUrl } = input;

  const lines: string[] = [];
  lines.push("Salvare backend starting...");
  lines.push(`Port: ${config.port}`);
  lines.push(`Database: ${config.dbPath}`);
  lines.push(`Schema: ${status.schemaInitialized ? "initialized" : "missing"}`);
  lines.push(`Admin auth: ${config.adminToken ? "ENABLED" : "DISABLED"}`);
  lines.push(`Coupon data: ${presence(status.hasCoupons)}`);
  lines.push(`Result history: ${presence(status.hasResults)}`);

  const importedAny =
    bootstrap.storesImported > 0 ||
    bootstrap.codesImported > 0 ||
    bootstrap.resultsImported > 0;
  if (importedAny) {
    lines.push(
      `Bootstrap: imported ${bootstrap.storesImported} store(s), ${bootstrap.codesImported} code(s), ${bootstrap.resultsImported} result(s) from JSON.`,
    );
  }

  lines.push(`Listening: ${listenUrl}`);

  return lines.join("\n");
}
