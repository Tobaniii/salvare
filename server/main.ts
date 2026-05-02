// Process entry for the Salvare backend.
//
// Lives in its own file so `server/index.ts` is purely a library (exports
// `createSalvareServer` and friends) that never auto-runs `main()` when
// imported or bundled — see e.g. smoke/extension-server-harness.ts which
// imports the factory and would otherwise double-bind to port 4123.

import { createSalvareServer } from "./index";
import { defaultDatabasePath, openDatabase, type Db } from "./db";
import { bootstrapIfEmpty } from "./db-coupons";
import { bootstrapResultsIfEmpty } from "./db-results";
import { readAdminTokenFromEnv } from "./auth";

const DEFAULT_PORT = 4123;

function main(): void {
  const port = Number(process.env.PORT ?? DEFAULT_PORT);

  const db: Db = openDatabase(defaultDatabasePath());
  const bootstrapStats = bootstrapIfEmpty(db);
  if (bootstrapStats.bootstrapped) {
    console.log(
      `Salvare bootstrap on startup: imported ${bootstrapStats.storesImported} store(s) and ${bootstrapStats.codesImported} code(s) from coupons.seed.json`,
    );
  }
  const resultsBootstrapStats = bootstrapResultsIfEmpty(db);
  if (resultsBootstrapStats.bootstrapped) {
    console.log(
      `Salvare bootstrap on startup: imported ${resultsBootstrapStats.resultsImported} result record(s) from coupon-results.json`,
    );
  }

  const adminToken = readAdminTokenFromEnv();
  if (adminToken) {
    console.log(
      "Salvare admin auth: ENABLED (Authorization: Bearer <token> required for /admin* and DELETE /results)",
    );
  } else {
    console.log(
      "Salvare admin auth: DISABLED (set SALVARE_ADMIN_TOKEN to require a Bearer token; intended for local dev)",
    );
  }

  const server = createSalvareServer({ db, adminToken });
  server.listen(port, () => {
    console.log(`Salvare coupon API listening on http://localhost:${port}`);
  });
}

main();
