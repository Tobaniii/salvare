// Process entry for the Salvare backend.
//
// Lives in its own file so `server/index.ts` is purely a library (exports
// `createSalvareServer` and friends) that never auto-runs `main()` when
// imported or bundled — see e.g. smoke/extension-server-harness.ts which
// imports the factory and would otherwise double-bind to port 4123.
//
// Reads + validates env via `parseServerConfig`, fails fast on bad config or
// DB-open errors, prints a concise startup-diagnostics block, and binds the
// HTTP server. The token value is never logged.

import { createSalvareServer } from "./index";
import { defaultDatabasePath, openDatabase, type Db } from "./db";
import { bootstrapIfEmpty } from "./db-coupons";
import { bootstrapResultsIfEmpty } from "./db-results";
import { parseServerConfig } from "./config";
import { buildStartupDiagnostics, getDatabaseStatus } from "./diagnostics";
import { SALVARE_VERSION } from "./health";

const DEFAULT_PORT = 4123;

function fail(message: string): never {
  console.error(`Salvare backend: ${message}`);
  process.exit(1);
}

function main(): void {
  const result = parseServerConfig(process.env, {
    port: DEFAULT_PORT,
    dbPath: defaultDatabasePath(),
  });
  if (!result.ok) {
    fail(`invalid configuration — ${result.error}`);
  }
  const config = result.config;

  let db: Db;
  try {
    db = openDatabase(config.dbPath);
  } catch (err) {
    fail(
      `failed to open database at ${config.dbPath}: ${(err as Error).message}`,
    );
  }

  let seedStats: ReturnType<typeof bootstrapIfEmpty>;
  let resultsStats: ReturnType<typeof bootstrapResultsIfEmpty>;
  try {
    seedStats = bootstrapIfEmpty(db);
    resultsStats = bootstrapResultsIfEmpty(db);
  } catch (err) {
    fail(`bootstrap from JSON failed: ${(err as Error).message}`);
  }

  const status = getDatabaseStatus(db);
  const listenUrl = `http://localhost:${config.port}`;

  console.log(
    buildStartupDiagnostics({
      config,
      status,
      bootstrap: {
        storesImported: seedStats.bootstrapped ? seedStats.storesImported : 0,
        codesImported: seedStats.bootstrapped ? seedStats.codesImported : 0,
        resultsImported: resultsStats.bootstrapped
          ? resultsStats.resultsImported
          : 0,
      },
      listenUrl,
    }),
  );

  const server = createSalvareServer({
    db,
    adminToken: config.adminToken,
    version: SALVARE_VERSION,
  });
  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      fail(
        `port ${config.port} is already in use. Stop any other process on this port and retry.`,
      );
    }
    fail(`server error: ${err.message}`);
  });
  server.listen(config.port);
}

main();
