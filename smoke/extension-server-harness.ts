// Salvare extension smoke test harness.
//
// Boots an isolated Salvare backend on port 4123 backed by an in-memory SQLite
// database, pre-seeded with the localhost coupon list. Used by Playwright's
// `webServer` config when running `npm run test:smoke:extension`.
//
// The developer's `server/salvare.db` is never opened. If port 4123 is already
// in use (e.g. a developer is running `npm run start:server` in another
// terminal) the harness exits with a clear error message instead of letting
// Playwright report a generic timeout.

import { createServer } from "node:http";
import { createSalvareServer } from "../server/index";
import { openDatabase } from "../server/db";
import { upsertCouponCodes } from "../server/db-coupons";

const PORT = 4123;

async function ensurePortFree(port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const probe = createServer();
    probe.unref();
    probe.once("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        reject(
          new Error(
            `Salvare extension smoke harness cannot bind to port ${port}: ` +
              `address already in use. Stop your local Salvare server ` +
              `(e.g. \`npm run start:server\`) before running ` +
              `\`npm run test:smoke:extension\`.`,
          ),
        );
        return;
      }
      reject(err);
    });
    probe.once("listening", () => {
      probe.close((closeErr) => (closeErr ? reject(closeErr) : resolve()));
    });
    // Bind without a host so we attempt the same dual-stack bind the real
    // Salvare server does (`server.listen(port)`). A dev server on `::4123`
    // and a probe on `127.0.0.1:4123` would not conflict on macOS dual-stack;
    // omitting the host makes us see all 4123 listeners.
    probe.listen(port);
  });
}

async function main(): Promise<void> {
  await ensurePortFree(PORT);

  const db = openDatabase(":memory:");
  upsertCouponCodes(db, "localhost", ["SAVE10", "TAKE15", "FREESHIP"]);

  const server = createSalvareServer({ db, adminToken: null });

  const shutdown = (signal: string) => {
    console.log(`Salvare smoke harness: received ${signal}, shutting down.`);
    server.close(() => {
      db.close();
      process.exit(0);
    });
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  await new Promise<void>((resolve, reject) => {
    const onError = (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        reject(
          new Error(
            `Salvare extension smoke harness cannot bind to port ${PORT}: ` +
              `address already in use. Stop your local Salvare server ` +
              `(e.g. \`npm run start:server\`) before running ` +
              `\`npm run test:smoke:extension\`.`,
          ),
        );
        return;
      }
      reject(err);
    };
    server.once("error", onError);
    // Listen on all interfaces so the extension's `http://localhost:4123`
    // requests reach us whether localhost resolves to IPv4 or IPv6.
    server.listen(PORT, () => {
      server.off("error", onError);
      resolve();
    });
  });
  console.log(
    `Salvare smoke harness listening on http://localhost:${PORT} ` +
      `(in-memory DB; server/salvare.db untouched).`,
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
