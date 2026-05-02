import { test as base } from "@playwright/test";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createSalvareServer } from "../server/index";
import { openDatabase, type Db } from "../server/db";
import { upsertCouponCodes } from "../server/db-coupons";

export interface SeededDomain {
  domain: string;
  codes: string[];
}

export interface SalvareHandle {
  baseUrl: string;
  db: Db;
}

interface SalvareFactoryOptions {
  adminToken?: string | null;
  seed?: SeededDomain[];
}

async function startSalvare(
  opts: SalvareFactoryOptions = {},
): Promise<{ handle: SalvareHandle; server: Server }> {
  const db = openDatabase(":memory:");
  for (const entry of opts.seed ?? []) {
    upsertCouponCodes(db, entry.domain, entry.codes);
  }
  const server = createSalvareServer({
    db,
    adminToken: opts.adminToken ?? null,
  });
  await new Promise<void>((resolve) =>
    server.listen(0, "127.0.0.1", resolve),
  );
  const address = server.address() as AddressInfo;
  return {
    handle: { baseUrl: `http://127.0.0.1:${address.port}`, db },
    server,
  };
}

async function stopSalvare(server: Server, db: Db): Promise<void> {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
  db.close();
}

interface SalvareFixtures {
  salvare: SalvareHandle;
}

export const test = base.extend<SalvareFixtures>({
  salvare: async ({}, use) => {
    const { handle, server } = await startSalvare({
      seed: [{ domain: "smoke.test", codes: ["A1", "A2"] }],
    });
    await use(handle);
    await stopSalvare(server, handle.db);
  },
});

interface TokenFixtures {
  salvareWithToken: SalvareHandle & { token: string };
}

export const TOKEN = "smoke-token-abc-123";

export const tokenTest = base.extend<TokenFixtures>({
  salvareWithToken: async ({}, use) => {
    const { handle, server } = await startSalvare({
      adminToken: TOKEN,
      seed: [{ domain: "smoke.test", codes: ["A1", "A2"] }],
    });
    await use({ ...handle, token: TOKEN });
    await stopSalvare(server, handle.db);
  },
});

export { expect } from "@playwright/test";
