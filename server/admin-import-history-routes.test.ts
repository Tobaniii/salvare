import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createSalvareServer } from "./index";
import { openDatabase, type Db } from "./db";
import { recordProviderImportAttempt } from "./db-source-import";

const PATH = "/admin/import-history";

interface Harness {
  baseUrl: string;
  server: Server;
  db: Db;
}

async function startHarness(
  db: Db,
  adminToken: string | null = null,
): Promise<Harness> {
  const server = createSalvareServer({ db, adminToken });
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

function seed(db: Db): void {
  recordProviderImportAttempt(db, {
    providerId: "awin",
    sourceId: "import",
    domain: "a.example",
    outcome: "ok",
    candidatesAccepted: 2,
    codesImported: 2,
    provenanceRecorded: 2,
    rejectedCount: 0,
    attemptedAt: "2026-05-10T00:00:00.000Z",
  });
  recordProviderImportAttempt(db, {
    providerId: "awin",
    domain: "b.example",
    outcome: "error",
    candidatesAccepted: 0,
    codesImported: 0,
    provenanceRecorded: 0,
    rejectedCount: 0,
    errorCode: "disabled",
    attemptedAt: "2026-05-12T00:00:00.000Z",
  });
}

async function get(
  baseUrl: string,
  query = "",
  token?: string,
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (token !== undefined) headers.Authorization = `Bearer ${token}`;
  return fetch(`${baseUrl}${PATH}${query}`, { method: "GET", headers });
}

describe("GET /admin/import-history — auth", () => {
  const TOKEN = "history-token-abc";
  let h: Harness;
  beforeAll(async () => {
    const db = openDatabase(":memory:");
    h = await startHarness(db, TOKEN);
  });
  afterAll(async () => stopHarness(h));

  it("returns 401 without Authorization", async () => {
    const res = await get(h.baseUrl);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });

  it("returns 401 with wrong token", async () => {
    const res = await get(h.baseUrl, "", "nope");
    expect(res.status).toBe(401);
  });

  it("accepts the correct token", async () => {
    const res = await get(h.baseUrl, "", TOKEN);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.rows)).toBe(true);
    expect(body.truncated).toBe(false);
  });
});

describe("GET /admin/import-history — open mode + filters + redaction", () => {
  let h: Harness;
  beforeAll(async () => {
    const db = openDatabase(":memory:");
    seed(db);
    h = await startHarness(db, null);
  });
  afterAll(async () => stopHarness(h));

  it("returns rows newest-first with an allowlisted projection only", async () => {
    const res = await get(h.baseUrl);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.rows.map((r: { domain: string }) => r.domain)).toEqual([
      "b.example",
      "a.example",
    ]);
    for (const row of body.rows as Record<string, unknown>[]) {
      expect(Object.keys(row).sort()).toEqual(
        [
          "attemptedAt",
          "candidatesAccepted",
          "codesImported",
          "domain",
          "durationMs",
          "errorCode",
          "id",
          "outcome",
          "providerId",
          "provenanceRecorded",
          "rejectedCount",
          "sourceId",
        ].sort(),
      );
    }
  });

  it("filters by provider and by from/to", async () => {
    const provRes = await get(h.baseUrl, "?provider=awin");
    expect((await provRes.json()).rows.length).toBe(2);

    const windowRes = await get(
      h.baseUrl,
      "?from=2026-05-11T00:00:00.000Z&to=2026-05-13T00:00:00.000Z",
    );
    const windowBody = await windowRes.json();
    expect(
      windowBody.rows.map((r: { domain: string }) => r.domain),
    ).toEqual(["b.example"]);
  });

  it("fails closed on an unknown provider filter without echoing it", async () => {
    const res = await get(h.baseUrl, "?provider=bogus");
    expect(res.status).toBe(400);
    const raw = await res.text();
    expect(JSON.parse(raw)).toEqual({ ok: false, error: "invalid provider" });
    expect(raw).not.toContain("bogus");
  });

  it("rejects invalid ISO from/to with a safe 400", async () => {
    const res = await get(h.baseUrl, "?from=not-a-date");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: "invalid from" });
  });

  it("is read-only — POST/DELETE are not handled by this route", async () => {
    const post = await fetch(`${h.baseUrl}${PATH}`, { method: "POST" });
    expect(post.status).not.toBe(200);
    const del = await fetch(`${h.baseUrl}${PATH}`, { method: "DELETE" });
    expect(del.status).not.toBe(200);
  });

  it("response carries no token/header/body/url/free-text fields", async () => {
    const raw = await (await get(h.baseUrl)).text();
    for (const needle of [
      "Authorization",
      "Bearer",
      "apiKey",
      "api_key",
      "cookie",
      "set-cookie",
      "rawPayload",
      "stack",
      "SALVARE_",
      "http://",
      "https://",
      "/Users/",
      ".db",
    ]) {
      expect(raw).not.toContain(needle);
    }
  });
});
