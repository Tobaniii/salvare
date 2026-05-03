import { parseServerConfig } from "./config";
import { defaultDatabasePath } from "./db";
import { resetDatabase } from "./db-maintenance";

function fail(message: string): never {
  console.error(`Salvare db:reset: ${message}`);
  process.exit(1);
}

const parsed = parseServerConfig(process.env, {
  port: 0,
  dbPath: defaultDatabasePath(),
});
if (!parsed.ok) {
  fail(`invalid configuration — ${parsed.error}`);
}

console.warn(
  `Salvare db:reset: WARNING — this will erase all local runtime data at ${parsed.config.dbPath} and reimport from JSON bootstrap files.`,
);

try {
  const stats = resetDatabase(parsed.config.dbPath);
  console.log(
    `Reset ${stats.dbPath}: imported ${stats.storesImported} store(s), ${stats.codesImported} code(s), ${stats.resultsImported} result record(s) from JSON.`,
  );
} catch (err) {
  fail((err as Error).message);
}
