import { parseServerConfig } from "./config";
import { defaultDatabasePath, openDatabase } from "./db";
import { formatVerifyReport, verifyDatabase } from "./db-verify";

function fail(message: string): never {
  console.error(`Salvare db:verify: ${message}`);
  process.exit(1);
}

const parsed = parseServerConfig(process.env, {
  port: 0,
  dbPath: defaultDatabasePath(),
});
if (!parsed.ok) {
  fail(`invalid configuration — ${parsed.error}`);
}

let db;
try {
  db = openDatabase(parsed.config.dbPath);
} catch (err) {
  fail((err as Error).message);
}

try {
  const result = verifyDatabase(db);
  console.log(formatVerifyReport(result));
  if (!result.ok) {
    process.exit(1);
  }
} finally {
  db.close();
}
