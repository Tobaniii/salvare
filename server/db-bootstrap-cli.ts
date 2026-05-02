import { defaultDatabasePath, openDatabase } from "./db";
import { bootstrapFromJson } from "./db-bootstrap";

const path = defaultDatabasePath();
const db = openDatabase(path);
const stats = bootstrapFromJson(db);
db.close();

console.log(
  `Salvare bootstrap (${path}): ` +
    `${stats.storesImported} new store(s), ` +
    `${stats.codesImported} new code(s), ` +
    `${stats.resultsImported} result record(s) reimported.`,
);
