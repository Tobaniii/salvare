import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createSalvareServer } from "./index";
import { openDatabase, type Db } from "./db";
import { upsertCouponCodes } from "./db-coupons";

interface Harness {
  baseUrl: string;
  server: Server;
  db: Db;
}

async function startHarness(db: Db): Promise<Harness> {
  const server = createSalvareServer({ db, adminToken: null });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  return { baseUrl: `http://127.0.0.1:${address.port}`, server, db };
}

async function stopHarness(h: Harness): Promise<void> {
  await new Promise<void>((resolve, reject) =>
    h.server.close((err) => (err ? reject(err) : resolve())),
  );
  h.db.close();
}

// The 4 store-profile domains the extension ships, each with a DISTINCT
// candidate set so any cross-store bleed is detectable.
const STORES: Record<string, string[]> = {
  localhost: ["LOCAL1", "LOCAL2"],
  "wonderbly.com": ["WON1", "WON2"],
  "salvare-test-store.myshopify.com": ["SHOP1", "SHOP2"],
  "salvare-woo-test.local": ["WOO1", "WOO2"],
};

describe("GET /coupons — merchant alias empty map: 4-profile parity (v0.51.0)", () => {
  let h: Harness;
  beforeAll(async () => {
    const db = openDatabase(":memory:");
    for (const [domain, codes] of Object.entries(STORES)) {
      upsertCouponCodes(db, domain, codes);
    }
    h = await startHarness(db);
  });
  afterAll(async () => stopHarness(h));

  it("each profile domain resolves to its own store, byte-identical to v0.50", async () => {
    for (const [domain, codes] of Object.entries(STORES)) {
      const body = await (
        await fetch(`${h.baseUrl}/coupons?domain=${encodeURIComponent(domain)}`)
      ).json();
      expect(body.candidateCodes).toEqual(codes);
      expect(body.domain).toBe(domain);
    }
  });

  it("www./case/whitespace variants still resolve to the same store (empty alias = identity after normalize)", async () => {
    const variants: Array<[string, string]> = [
      ["WWW.WONDERBLY.COM", "wonderbly.com"],
      ["  Wonderbly.com  ", "wonderbly.com"],
      ["www.salvare-test-store.myshopify.com", "salvare-test-store.myshopify.com"],
      ["LOCALHOST", "localhost"],
    ];
    for (const [input, canonical] of variants) {
      const body = await (
        await fetch(
          `${h.baseUrl}/coupons?domain=${encodeURIComponent(input)}`,
        )
      ).json();
      expect(body.candidateCodes).toEqual(STORES[canonical]);
      expect(body.domain).toBe(canonical);
    }
  });

  it("zero cross-store bleed — no store ever returns another store's codes", async () => {
    for (const [domain, ownCodes] of Object.entries(STORES)) {
      const body = await (
        await fetch(`${h.baseUrl}/coupons?domain=${encodeURIComponent(domain)}`)
      ).json();
      const returned = new Set<string>(body.candidateCodes);
      for (const [other, otherCodes] of Object.entries(STORES)) {
        if (other === domain) continue;
        for (const foreign of otherCodes) {
          expect(returned.has(foreign)).toBe(false);
        }
      }
      expect([...returned].sort()).toEqual([...ownCodes].sort());
    }
  });

  it("an unlisted domain stays distinct (empty alias does not unify anything)", async () => {
    const body = await (
      await fetch(`${h.baseUrl}/coupons?domain=unrelated-merchant.example`)
    ).json();
    expect(body.candidateCodes).toEqual([]);
    expect(body.source).toBe("none");
  });
});
