import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createSalvareServer } from "./index";
import { openDatabase, type Db } from "./db";
import {
  createProviderRegistry,
  type ProviderDescriptorMetadata,
} from "./source-provider-registry";

const PATH = "/admin/source-providers";

interface Harness {
  baseUrl: string;
  server: Server;
  db: Db;
}

async function startHarness(
  options: {
    adminToken?: string | null;
    providerListSource?: () => readonly ProviderDescriptorMetadata[];
  } = {},
): Promise<Harness> {
  const db = openDatabase(":memory:");
  const server = createSalvareServer({
    db,
    adminToken: options.adminToken ?? null,
    providerListSource: options.providerListSource,
  });
  await new Promise<void>((resolve) =>
    server.listen(0, "127.0.0.1", resolve),
  );
  const address = server.address() as AddressInfo;
  return { baseUrl: `http://127.0.0.1:${address.port}`, server, db };
}

async function stopHarness(h: Harness): Promise<void> {
  await new Promise<void>((resolve, reject) =>
    h.server.close((err) => (err ? reject(err) : resolve())),
  );
  h.db.close();
}

async function get(baseUrl: string, token?: string): Promise<Response> {
  const headers: Record<string, string> = {};
  if (token !== undefined) headers.Authorization = `Bearer ${token}`;
  return fetch(`${baseUrl}${PATH}`, { method: "GET", headers });
}

describe("GET /admin/source-providers — auth", () => {
  const TOKEN = "providers-token-abc";

  describe("token configured", () => {
    let h: Harness;

    beforeAll(async () => {
      h = await startHarness({ adminToken: TOKEN });
    });

    afterAll(async () => {
      await stopHarness(h);
    });

    it("rejects with no Authorization header (401)", async () => {
      const res = await get(h.baseUrl);
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "unauthorized" });
    });

    it("rejects with wrong Bearer token (401)", async () => {
      const res = await get(h.baseUrl, "wrong-token");
      expect(res.status).toBe(401);
    });

    it("accepts the correct Bearer token", async () => {
      const res = await get(h.baseUrl, TOKEN);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(Array.isArray(body.providers)).toBe(true);
    });
  });

  describe("token disabled (open admin surface)", () => {
    let h: Harness;

    beforeAll(async () => {
      h = await startHarness({ adminToken: null });
    });

    afterAll(async () => {
      await stopHarness(h);
    });

    it("responds normally without Authorization", async () => {
      const res = await get(h.baseUrl);
      expect(res.status).toBe(200);
    });
  });
});

describe("GET /admin/source-providers — body shape (default registry)", () => {
  let h: Harness;

  beforeAll(async () => {
    h = await startHarness({ adminToken: null });
  });

  afterAll(async () => {
    await stopHarness(h);
  });

  it("lists Awin only (impact is hidden while userExposed=false)", async () => {
    const res = await get(h.baseUrl);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.providers)).toBe(true);
    const ids = body.providers.map(
      (p: { providerId: string }) => p.providerId,
    );
    expect(ids).toEqual(["awin"]);
  });

  it("returns only allowlisted top-level + activation fields", async () => {
    const res = await get(h.baseUrl);
    const body = await res.json();
    expect(Object.keys(body)).toEqual(["providers"]);

    for (const entry of body.providers as Record<string, unknown>[]) {
      expect(Object.keys(entry).sort()).toEqual(
        [
          "activation",
          "displayName",
          "providerId",
          "sourceId",
          "sourceType",
        ].sort(),
      );
      const act = entry.activation as Record<string, unknown>;
      // 5-field subset — userExposed is the filter gate, never echoed.
      expect(Object.keys(act).sort()).toEqual(
        [
          "cacheSupported",
          "enabled",
          "importEnabled",
          "previewEnabled",
          "schedulerSupported",
        ].sort(),
      );
      expect(typeof act.enabled).toBe("boolean");
      expect(typeof act.previewEnabled).toBe("boolean");
      expect(typeof act.importEnabled).toBe("boolean");
      expect(typeof act.cacheSupported).toBe("boolean");
      expect(typeof act.schedulerSupported).toBe("boolean");
      expect("userExposed" in act).toBe(false);
      expect(typeof entry.displayName).toBe("string");
    }
  });

  it("Awin entry carries full activation (no userExposed)", async () => {
    const res = await get(h.baseUrl);
    const body = await res.json();
    const awin = body.providers.find(
      (p: { providerId: string }) => p.providerId === "awin",
    );
    expect(awin).toBeDefined();
    expect(awin).toEqual({
      providerId: "awin",
      sourceId: "awin",
      displayName: "Awin Offers API",
      sourceType: "api",
      activation: {
        enabled: true,
        previewEnabled: true,
        importEnabled: true,
        cacheSupported: true,
        schedulerSupported: false,
      },
    });
  });

  it("response body contains no impact identifiers", async () => {
    const res = await get(h.baseUrl);
    const raw = await res.text();
    expect(raw).not.toContain("impact");
    expect(raw).not.toContain("Impact");
  });

  it("registry.list().filter(activation.userExposed) excludes impact", () => {
    const registry = createProviderRegistry();
    const exposed = registry
      .list()
      .filter((d) => d.activation.userExposed === true)
      .map((d) => d.providerId);
    expect(exposed).toEqual(["awin"]);
  });
});

describe("GET /admin/source-providers — redaction", () => {
  const TOKEN = "providers-redact-token-xyz";
  let h: Harness;

  beforeAll(async () => {
    h = await startHarness({ adminToken: TOKEN });
  });

  afterAll(async () => {
    await stopHarness(h);
  });

  it("never echoes secrets, env names, headers, paths, or affiliate fields", async () => {
    const raw = await (await get(h.baseUrl, TOKEN)).text();
    const FORBIDDEN = [
      TOKEN,
      "Authorization",
      "Bearer",
      "apiKey",
      "accountSid",
      "authToken",
      "userExposed",
      "featureEnabled",
      "configured",
      "SALVARE_AWIN_API_KEY",
      "SALVARE_IMPACT_API_KEY",
      "SALVARE_IMPACT_ACCOUNT_SID",
      "SALVARE_SOURCE_PROVIDER",
      "SALVARE_SOURCE_PROVIDER_ENABLED",
      "SALVARE_IMPACT_ENABLED",
      "SALVARE_AWIN_PUBLISHER_ID",
      "SALVARE_ADMIN_TOKEN",
      "PATH",
      "HOME",
      "dbPath",
      "salvare.db",
      "clickThroughUrl",
      "trackingUrl",
      "deepLink",
      "commissionRate",
      "publisherId",
      "advertiserId",
      "partnerId",
      "EarningsPerClick",
      "payout",
      "stackTrace",
    ];
    for (const needle of FORBIDDEN) {
      expect(raw).not.toContain(needle);
    }
  });

  it("hides impact even when registry includes it (default registry wiring)", async () => {
    const raw = await (await get(h.baseUrl, TOKEN)).text();
    expect(raw).not.toContain("impact");
  });

  it("filters userExposed=false entries from a custom provider list source", async () => {
    const customH = await startHarness({
      adminToken: TOKEN,
      providerListSource: () => [
        {
          providerId: "awin",
          sourceId: "awin",
          displayName: "Awin Offers API",
          sourceType: "api",
          activation: {
            enabled: true,
            previewEnabled: true,
            importEnabled: true,
            userExposed: true,
            cacheSupported: true,
            schedulerSupported: false,
          },
        },
        {
          providerId: "impact",
          sourceId: "impact",
          displayName: "impact.com Promotions API",
          sourceType: "api",
          activation: {
            enabled: true,
            previewEnabled: true,
            importEnabled: false,
            userExposed: false,
            cacheSupported: false,
            schedulerSupported: false,
          },
        },
      ],
    });
    try {
      const res = await get(customH.baseUrl, TOKEN);
      expect(res.status).toBe(200);
      const body = await res.json();
      const ids = body.providers.map(
        (p: { providerId: string }) => p.providerId,
      );
      expect(ids).toEqual(["awin"]);
      const raw = JSON.stringify(body);
      expect(raw).not.toContain("impact");
    } finally {
      await stopHarness(customH);
    }
  });
});
