import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseServerConfig } from "./config";
import { defaultDatabasePath, openDatabase } from "./db";
import { exportDatabase } from "./db-maintenance";

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const EXPORTS_DIR = join(SERVER_DIR, "exports");

function fail(message: string): never {
  console.error(`Salvare db:export: ${message}`);
  process.exit(1);
}

const parsed = parseServerConfig(process.env, {
  port: 0,
  dbPath: defaultDatabasePath(),
});
if (!parsed.ok) {
  fail(`invalid configuration — ${parsed.error}`);
}

const db = openDatabase(parsed.config.dbPath);
try {
  const result = exportDatabase(db, EXPORTS_DIR);
  console.log(
    `Exported ${result.storeCount} domain(s) and ${result.resultCount} result record(s):\n` +
      `  ${result.couponsPath}\n` +
      `  ${result.resultsPath}`,
  );
} catch (err) {
  fail((err as Error).message);
} finally {
  db.close();
}
