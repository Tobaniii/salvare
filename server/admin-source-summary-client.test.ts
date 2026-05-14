// DOM-level tests for the admin source-summary inline script. The route is
// already covered by server/admin-source-summary-routes.test.ts; these tests
// drive the inline client against a mocked `fetch` to verify:
//   - The button issues a single GET to /admin/source-summary with the
//     domain query and Authorization header from authHeaders().
//   - Successful responses render only allowlisted summary fields.
//   - Empty / unknown-domain responses render a safe message.
//   - Forbidden fields in a mocked response (sourceUrl, affiliate fields,
//     env vars, DB paths, stack traces, raw payloads, Authorization,
//     localStorage values) never reach the DOM.
//   - Empty-domain inputs prevent the request.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Window } from "happy-dom";
import { getAdminHtml } from "./admin";

interface FetchCall {
  url: string;
  method: string;
  headers: Record<string, string>;
}

interface Harness {
  window: Window;
  document: Document;
  fetchCalls: FetchCall[];
  setResponder: (
    fn: (url: string, init: RequestInit | undefined) => Response,
  ) => void;
  click: (id: string) => void;
  fill: (id: string, value: string) => void;
  waitFor: (predicate: () => boolean, timeoutMs?: number) => Promise<void>;
  cleanup: () => Promise<void>;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function setupHarness(): Promise<Harness> {
  const html = getAdminHtml();
  const window = new Window({
    url: "http://localhost/admin",
    settings: {
      enableJavaScriptEvaluation: true,
      suppressInsecureJavaScriptEnvironmentWarning: true,
    },
  });
  const fetchCalls: FetchCall[] = [];

  let responder: (
    url: string,
    init: RequestInit | undefined,
  ) => Response = (url) => {
    if (url === "/health") {
      return jsonResponse({
        ok: true,
        service: "salvare-backend",
        version: "test",
        database: {
          schemaInitialized: true,
          hasCoupons: false,
          hasResults: false,
        },
        auth: { adminTokenConfigured: false },
      });
    }
    if (url === "/admin/coupons") {
      return jsonResponse({ coupons: {} });
    }
    return jsonResponse({});
  };

  (window as unknown as { fetch: typeof fetch }).fetch = (async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => {
    const url = typeof input === "string" ? input : String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    const headers: Record<string, string> = {};
    if (init?.headers) {
      const h = init.headers as Record<string, string>;
      Object.keys(h).forEach((k) => {
        headers[k] = h[k];
      });
    }
    fetchCalls.push({ url, method, headers });
    return responder(url, init);
  }) as unknown as typeof fetch;

  window.document.write(html);
  await (
    window as unknown as { happyDOM: { waitUntilComplete: () => Promise<void> } }
  ).happyDOM.waitUntilComplete();

  const document = window.document as unknown as Document;

  async function waitFor(
    predicate: () => boolean,
    timeoutMs = 1000,
  ): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (predicate()) return;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    if (!predicate()) {
      throw new Error("waitFor timeout");
    }
  }

  function click(id: string): void {
    const el = document.getElementById(id) as HTMLButtonElement | null;
    if (!el) throw new Error(`missing element: ${id}`);
    el.click();
  }

  function fill(id: string, value: string): void {
    const el = document.getElementById(id) as HTMLInputElement | null;
    if (!el) throw new Error(`missing element: ${id}`);
    el.value = value;
  }

  return {
    window,
    document,
    fetchCalls,
    setResponder(fn) {
      responder = fn;
    },
    click,
    fill,
    waitFor,
    async cleanup() {
      await (
        window as unknown as {
          happyDOM: { close: () => Promise<void> };
        }
      ).happyDOM.close();
    },
  };
}

describe("admin source-summary client", () => {
  let h: Harness;

  beforeEach(async () => {
    h = await setupHarness();
  });

  afterEach(async () => {
    await h.cleanup();
  });

  it("does nothing and does not call fetch when the domain is empty", async () => {
    const before = h.fetchCalls.filter((c) =>
      c.url.includes("/admin/source-summary"),
    ).length;

    h.fill("source-summary-domain", "  ");
    h.click("source-summary-btn");

    await h.waitFor(
      () =>
        (h.document.getElementById("source-summary-status")?.textContent ??
          "") === "Domain is required.",
    );

    const after = h.fetchCalls.filter((c) =>
      c.url.includes("/admin/source-summary"),
    ).length;
    expect(after).toBe(before);
  });

  it("GETs /admin/source-summary?domain=... with bearer token and renders allowlisted fields", async () => {
    h.window.localStorage.setItem("salvareAdminToken", "tok-sum-123");

    h.setResponder((url) => {
      if (url.startsWith("/admin/source-summary?")) {
        return jsonResponse({
          domain: "shop.example",
          storeId: 7,
          codeCount: 2,
          sourceCount: 2,
          truncated: false,
          codes: [
            {
              code: "AWIN10",
              sources: [
                {
                  sourceId: "awin",
                  sourceName: "Awin",
                  sourceType: "api",
                  discoveredAt: "2026-05-12T00:00:00.000Z",
                  label: "10% off",
                  expiresAt: "2026-12-31",
                  confidence: 80,
                },
              ],
            },
            {
              code: "ADMIN1",
              sources: [
                {
                  sourceId: "admin",
                  sourceName: "Admin UI",
                  sourceType: "manual",
                  discoveredAt: "2026-05-10T00:00:00.000Z",
                },
              ],
            },
          ],
          sourceSummary: [
            {
              sourceId: "admin",
              sourceName: "Admin UI",
              sourceType: "manual",
              codeCount: 1,
            },
            {
              sourceId: "awin",
              sourceName: "Awin",
              sourceType: "api",
              codeCount: 1,
            },
          ],
        });
      }
      return jsonResponse({});
    });

    h.fill("source-summary-domain", "shop.example");
    h.click("source-summary-btn");

    await h.waitFor(() =>
      h.fetchCalls.some((c) => c.url.includes("/admin/source-summary?")),
    );

    const call = h.fetchCalls.find((c) =>
      c.url.includes("/admin/source-summary?"),
    )!;
    expect(call.method).toBe("GET");
    expect(call.url).toBe("/admin/source-summary?domain=shop.example");
    expect(call.headers["Authorization"]).toBe("Bearer tok-sum-123");

    await h.waitFor(
      () =>
        (h.document.getElementById("source-summary-status")?.textContent ??
          "") === "Loaded.",
    );

    const text =
      h.document.getElementById("source-summary-results")?.textContent ?? "";
    expect(text).toContain("AWIN10");
    expect(text).toContain("ADMIN1");
    expect(text).toContain("awin");
    expect(text).toContain("admin");
    expect(text).toContain("Admin UI");
    expect(text).toContain("10% off");
    expect(text).toContain("2026-12-31");
    expect(text).toContain("80");
    expect(text).toContain("Per-source counts");
    expect(text).toContain("Codes and source claims");
  });

  it("renders an empty-state message when storeId is null", async () => {
    h.setResponder((url) => {
      if (url.startsWith("/admin/source-summary?")) {
        return jsonResponse({
          domain: "unknown.example",
          storeId: null,
          codeCount: 0,
          sourceCount: 0,
          truncated: false,
          codes: [],
          sourceSummary: [],
        });
      }
      return jsonResponse({});
    });

    h.fill("source-summary-domain", "unknown.example");
    h.click("source-summary-btn");

    await h.waitFor(
      () =>
        (h.document.getElementById("source-summary-status")?.textContent ??
          "") === "No store stored for this domain.",
    );

    const text =
      h.document.getElementById("source-summary-results")?.textContent ?? "";
    expect(text).toContain("No codes stored for this domain.");
  });

  it("never renders forbidden fields even when smuggled into the mock response", async () => {
    h.window.localStorage.setItem("salvareAdminToken", "tok-secret-www");
    h.setResponder((url) => {
      if (url.startsWith("/admin/source-summary?")) {
        return jsonResponse({
          domain: "shop.example",
          storeId: 1,
          codeCount: 1,
          sourceCount: 1,
          truncated: false,
          codes: [
            {
              code: "AWIN10",
              sources: [
                {
                  sourceId: "awin",
                  sourceName: "Awin",
                  sourceType: "api",
                  discoveredAt: "2026-05-12T00:00:00.000Z",
                  // Forbidden fields a defective server might smuggle in:
                  sourceUrl: "https://affiliate.example/track?id=1",
                  clickThroughUrl: "https://affiliate.example/click",
                  trackingUrl: "https://track.example/t?id=1",
                  commissionRate: "12%",
                  publisherId: "pub-42",
                  apiKey: "very-secret-api-key",
                  Authorization: "Bearer leaked-token",
                },
              ],
            },
          ],
          sourceSummary: [
            {
              sourceId: "awin",
              sourceName: "Awin",
              sourceType: "api",
              codeCount: 1,
            },
          ],
          // Forbidden top-level fields:
          apiKey: "top-level-leaked-key",
          Authorization: "Bearer top-level-leaked",
          rawPayload: "<!doctype html>raw-html-do-not-render",
          stackTrace: "Error: do not render",
          envVars: { SALVARE_AWIN_API_KEY: "should-never-render" },
          dbPath: "/tmp/salvare.db",
        });
      }
      return jsonResponse({});
    });

    h.fill("source-summary-domain", "shop.example");
    h.click("source-summary-btn");

    await h.waitFor(
      () =>
        (h.document.getElementById("source-summary-status")?.textContent ??
          "") === "Loaded.",
    );

    const text =
      h.document.getElementById("source-summary-results")?.textContent ?? "";
    expect(text).not.toContain("affiliate.example");
    expect(text).not.toContain("track.example");
    expect(text).not.toContain("commissionRate");
    expect(text).not.toContain("publisherId");
    expect(text).not.toContain("apiKey");
    expect(text).not.toContain("Authorization");
    expect(text).not.toContain("Bearer");
    expect(text).not.toContain("very-secret-api-key");
    expect(text).not.toContain("top-level-leaked-key");
    expect(text).not.toContain("leaked-token");
    expect(text).not.toContain("raw-html-do-not-render");
    expect(text).not.toContain("stackTrace");
    expect(text).not.toContain("Error: do not render");
    expect(text).not.toContain("SALVARE_AWIN_API_KEY");
    expect(text).not.toContain("should-never-render");
    expect(text).not.toContain("/tmp/salvare.db");
    expect(text).not.toContain("tok-secret-www");
    expect(text).not.toContain("sourceUrl");
  });

  it("shows the unauthorized banner on 401 and never renders results", async () => {
    h.setResponder((url) => {
      if (url.startsWith("/admin/source-summary?")) {
        return jsonResponse({ error: "unauthorized" }, 401);
      }
      return jsonResponse({});
    });

    h.fill("source-summary-domain", "shop.example");
    h.click("source-summary-btn");

    await h.waitFor(() =>
      (h.document.getElementById("auth-banner")?.className ?? "").includes(
        "visible",
      ),
    );

    const status =
      h.document.getElementById("source-summary-status")?.textContent ?? "";
    expect(status).toContain("unauthorized");

    const results =
      h.document.getElementById("source-summary-results")?.textContent ?? "";
    expect(results).toBe("");
  });

  it("renders a safe error on 400 invalid domain without rendering rows", async () => {
    h.setResponder((url) => {
      if (url.startsWith("/admin/source-summary?")) {
        return jsonResponse(
          { ok: false, error: "invalid domain" },
          400,
        );
      }
      return jsonResponse({});
    });

    h.fill("source-summary-domain", "shop.example");
    h.click("source-summary-btn");

    await h.waitFor(() => {
      const status =
        h.document.getElementById("source-summary-status")?.textContent ?? "";
      return status.includes("invalid domain");
    });

    const results =
      h.document.getElementById("source-summary-results")?.textContent ?? "";
    expect(results).toBe("");
  });
});
