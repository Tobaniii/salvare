import { defaultDatabasePath, openDatabase } from "./db";

const path = defaultDatabasePath();
const db = openDatabase(path);
db.close();

console.log(`Salvare database initialized at ${path}`);
