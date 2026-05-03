import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseServerConfig } from "./config";
import { defaultDatabasePath } from "./db";
import { backupDatabase } from "./db-maintenance";

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const BACKUPS_DIR = join(SERVER_DIR, "backups");

function fail(message: string): never {
  console.error(`Salvare db:backup: ${message}`);
  process.exit(1);
}

const parsed = parseServerConfig(process.env, {
  port: 0,
  dbPath: defaultDatabasePath(),
});
if (!parsed.ok) {
  fail(`invalid configuration — ${parsed.error}`);
}

try {
  const result = backupDatabase(parsed.config.dbPath, BACKUPS_DIR);
  console.log(`Backed up ${result.source} → ${result.backupPath}`);
} catch (err) {
  fail((err as Error).message);
}
