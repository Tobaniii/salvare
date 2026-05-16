// DOM-level tests for the admin source-preview UI inline script. The route is
// already covered by server/admin-source-preview-routes.test.ts; these tests
// drive the inline client against a mocked `fetch` to verify:
//   - The button issues a single POST to /admin/source-preview/awin with the
//     JSON body, content-type, and Authorization header from the existing
//     authHeaders helper.
//   - Successful responses render only allowlisted candidate fields.
//   - Disabled / missing-api-key responses render a safe message that never
//     echoes the API key, env var values, headers, cookies, or raw payloads.
//   - Empty-domain inputs prevent the request.
//   - Forbidden fields in a mocked provider response never reach the DOM.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Window } from "happy-dom";
import { getAdminHtml } from "./admin";

interface FetchCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
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
    if (url === "/admin/source-providers") {
      return jsonResponse({
        providers: [
          {
            providerId: "awin",
            sourceId: "awin",
            displayName: "Awin",
            sourceType: "api",
            activation: {
              enabled: true,
              previewEnabled: true,
              importEnabled: true,
              cacheSupported: true,
              schedulerSupported: false,
            },
          },
        ],
      });
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
    const body = typeof init?.body === "string" ? init.body : "";
    fetchCalls.push({ url, method, headers, body });
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

  // The bootstrap calls loadSourceProviders() asynchronously; block until the
  // provider <select> is populated so preview/import clicks resolve a
  // provider deterministically.
  await waitFor(() => {
    const sel = document.getElementById(
      "source-preview-provider",
    ) as HTMLSelectElement | null;
    return !!sel && sel.options.length > 0;
  });

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

describe("admin source-preview client", () => {
  let h: Harness;

  beforeEach(async () => {
    h = await setupHarness();
  });

  afterEach(async () => {
    await h.cleanup();
  });

  it("does nothing and does not call fetch when the domain is empty", async () => {
    const previewCallsBefore = h.fetchCalls.filter((c) =>
      c.url.includes("/admin/source-preview/awin"),
    ).length;

    h.fill("source-preview-domain", "   ");
    h.click("source-preview-btn");

    await h.waitFor(
      () =>
        (h.document.getElementById("source-preview-status")?.textContent ??
          "") === "Domain is required.",
    );

    const previewCallsAfter = h.fetchCalls.filter((c) =>
      c.url.includes("/admin/source-preview/awin"),
    ).length;
    expect(previewCallsAfter).toBe(previewCallsBefore);
  });

  it("POSTs JSON to /admin/source-preview/awin with content-type and bearer token", async () => {
    h.window.localStorage.setItem("salvareAdminToken", "tok-abc-123");

    h.setResponder((url) => {
      if (url === "/admin/source-preview/awin") {
        return jsonResponse({
          ok: true,
          provider: "awin",
          domain: "shop.example",
          cacheHit: false,
          fetched: true,
          candidateCount: 1,
          candidates: [
            {
              sourceId: "awin",
              domain: "shop.example",
              code: "AWIN10",
              label: "10% off",
              expiresAt: "2026-12-31",
              confidence: 0.8,
            },
          ],
          errors: [],
        });
      }
      return jsonResponse({});
    });

    h.fill("source-preview-domain", "shop.example");
    h.click("source-preview-btn");

    await h.waitFor(
      () =>
        h.fetchCalls.some((c) =>
          c.url.includes("/admin/source-preview/awin"),
        ),
    );

    const call = h.fetchCalls.find((c) =>
      c.url.includes("/admin/source-preview/awin"),
    )!;
    expect(call.method).toBe("POST");
    expect(call.headers["Content-Type"]).toBe("application/json");
    expect(call.headers["Authorization"]).toBe("Bearer tok-abc-123");
    expect(JSON.parse(call.body)).toEqual({ domain: "shop.example" });
  });

  it("renders only allowlisted candidate fields on success", async () => {
    h.setResponder((url) => {
      if (url === "/admin/source-preview/awin") {
        return jsonResponse({
          ok: true,
          provider: "awin",
          domain: "shop.example",
          cacheHit: false,
          fetched: true,
          candidateCount: 1,
          candidates: [
            {
              sourceId: "awin",
              domain: "shop.example",
              code: "AWIN10",
              label: "10% off",
              expiresAt: "2026-12-31",
              confidence: 0.8,
            },
          ],
          errors: [],
        });
      }
      return jsonResponse({});
    });

    h.fill("source-preview-domain", "shop.example");
    h.click("source-preview-btn");

    await h.waitFor(
      () =>
        (h.document.getElementById("source-preview-status")?.textContent ??
          "") === "Preview ok (not saved).",
    );

    const candidatesEl = h.document.getElementById(
      "source-preview-candidates",
    );
    expect(candidatesEl).not.toBeNull();
    const text = candidatesEl!.textContent ?? "";
    expect(text).toContain("AWIN10");
    expect(text).toContain("10% off");
    expect(text).toContain("2026-12-31");
    expect(text).toContain("0.8");
    expect(text).toContain("shop.example");
    expect(text).toContain("awin");
    expect(text).toContain("fetched");
    expect(text).toContain("cacheHit");
  });

  it("never renders forbidden fields even when present in a mocked response", async () => {
    h.window.localStorage.setItem("salvareAdminToken", "tok-secret-xyz");
    h.setResponder((url) => {
      if (url === "/admin/source-preview/awin") {
        const payload = {
          ok: true,
          provider: "awin",
          domain: "shop.example",
          cacheHit: false,
          fetched: true,
          candidateCount: 1,
          candidates: [
            {
              sourceId: "awin",
              domain: "shop.example",
              code: "AWIN10",
              label: "10% off",
              expiresAt: "2026-12-31",
              confidence: 0.8,
              // Forbidden fields a defective server might smuggle in:
              clickThroughUrl: "https://affiliate.example/click?aff=1",
              trackingUrl: "https://track.example/t?id=1",
              deepLink: "https://deep.example/d?aff=1",
              commissionRate: "12%",
              publisherId: "pub-42",
              apiKey: "very-secret-api-key",
              Authorization: "Bearer leaked-token",
            },
          ],
          errors: [],
          // Forbidden top-level fields:
          apiKey: "top-level-leaked-key",
          Authorization: "Bearer top-level-leaked",
          rawPayload: "<!doctype html>raw-html-do-not-render",
          stackTrace: "Error: do not render",
          envVars: { SALVARE_AWIN_API_KEY: "should-never-render" },
          dbPath: "/tmp/salvare.db",
        };
        return jsonResponse(payload);
      }
      return jsonResponse({});
    });

    h.fill("source-preview-domain", "shop.example");
    h.click("source-preview-btn");

    await h.waitFor(
      () =>
        (h.document.getElementById("source-preview-status")?.textContent ??
          "") === "Preview ok (not saved).",
    );

    const rootText =
      (h.document.getElementById("source-preview-candidates")?.textContent ??
        "") +
      (h.document.getElementById("source-preview-errors")?.textContent ?? "");

    expect(rootText).not.toContain("affiliate.example");
    expect(rootText).not.toContain("track.example");
    expect(rootText).not.toContain("deep.example");
    expect(rootText).not.toContain("commissionRate");
    expect(rootText).not.toContain("publisherId");
    expect(rootText).not.toContain("apiKey");
    expect(rootText).not.toContain("Authorization");
    expect(rootText).not.toContain("Bearer");
    expect(rootText).not.toContain("very-secret-api-key");
    expect(rootText).not.toContain("top-level-leaked-key");
    expect(rootText).not.toContain("leaked-token");
    expect(rootText).not.toContain("raw-html-do-not-render");
    expect(rootText).not.toContain("stackTrace");
    expect(rootText).not.toContain("Error: do not render");
    expect(rootText).not.toContain("SALVARE_AWIN_API_KEY");
    expect(rootText).not.toContain("should-never-render");
    expect(rootText).not.toContain("/tmp/salvare.db");
    expect(rootText).not.toContain("tok-secret-xyz");
  });

  it("renders a safe message when provider is disabled (and never echoes secrets)", async () => {
    h.setResponder((url) => {
      if (url === "/admin/source-preview/awin") {
        return jsonResponse({
          ok: false,
          provider: "awin",
          domain: "shop.example",
          cacheHit: false,
          fetched: false,
          disabled: true,
          reason: "disabled",
          candidateCount: 0,
          candidates: [],
          errors: [],
        });
      }
      return jsonResponse({});
    });

    h.fill("source-preview-domain", "shop.example");
    h.click("source-preview-btn");

    await h.waitFor(() => {
      const text =
        h.document.getElementById("source-preview-candidates")?.textContent ??
        "";
      return text.includes("Provider disabled");
    });

    const text =
      h.document.getElementById("source-preview-candidates")?.textContent ??
      "";
    expect(text).toContain("Provider disabled");
    expect(text).not.toContain("SALVARE_AWIN_API_KEY=");
    expect(text).not.toContain("Bearer");
  });

  it("renders a safe message when API key is missing (and names env var only, never any value)", async () => {
    h.setResponder((url) => {
      if (url === "/admin/source-preview/awin") {
        return jsonResponse({
          ok: false,
          provider: "awin",
          domain: "shop.example",
          cacheHit: false,
          fetched: false,
          disabled: true,
          reason: "missing_api_key",
          candidateCount: 0,
          candidates: [],
          errors: [],
        });
      }
      return jsonResponse({});
    });

    h.fill("source-preview-domain", "shop.example");
    h.click("source-preview-btn");

    await h.waitFor(() => {
      const text =
        h.document.getElementById("source-preview-candidates")?.textContent ??
        "";
      return text.includes("API key not configured");
    });

    const text =
      h.document.getElementById("source-preview-candidates")?.textContent ??
      "";
    expect(text).toContain("SALVARE_AWIN_API_KEY");
    expect(text).not.toMatch(/SALVARE_AWIN_API_KEY\s*=/);
    expect(text).not.toContain("Bearer");
  });

  it("shows the existing auth banner on 401 and never renders candidates", async () => {
    h.setResponder((url) => {
      if (url === "/admin/source-preview/awin") {
        return jsonResponse({ error: "unauthorized" }, 401);
      }
      return jsonResponse({});
    });

    h.fill("source-preview-domain", "shop.example");
    h.click("source-preview-btn");

    await h.waitFor(() =>
      (h.document.getElementById("auth-banner")?.className ?? "").includes(
        "visible",
      ),
    );

    const status =
      h.document.getElementById("source-preview-status")?.textContent ?? "";
    expect(status).toContain("unauthorized");

    const candidates =
      h.document.getElementById("source-preview-candidates")?.textContent ??
      "";
    expect(candidates).toBe("");
  });

  it("Import button is disabled by default before any preview", () => {
    const btn = h.document.getElementById(
      "source-import-btn",
    ) as HTMLButtonElement;
    expect(btn).not.toBeNull();
    expect(btn.disabled).toBe(true);
  });

  it("Import stays disabled until IMPORT is typed even after a successful preview", async () => {
    h.setResponder((url) => {
      if (url === "/admin/source-preview/awin") {
        return jsonResponse({
          ok: true,
          provider: "awin",
          domain: "shop.example",
          cacheHit: false,
          fetched: true,
          candidateCount: 1,
          candidates: [
            {
              sourceId: "awin",
              domain: "shop.example",
              code: "AWIN10",
              label: "10% off",
              expiresAt: "2026-12-31",
              confidence: 0.8,
            },
          ],
          errors: [],
        });
      }
      return jsonResponse({});
    });

    h.fill("source-preview-domain", "shop.example");
    h.click("source-preview-btn");
    await h.waitFor(
      () =>
        (h.document.getElementById("source-preview-status")?.textContent ??
          "") === "Preview ok (not saved).",
    );

    const btn = h.document.getElementById(
      "source-import-btn",
    ) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);

    // Wrong phrase — must stay disabled.
    const confirmInput = h.document.getElementById(
      "source-import-confirm",
    ) as HTMLInputElement;
    confirmInput.value = "import";
    confirmInput.dispatchEvent(new (h.window as unknown as { Event: typeof Event }).Event("input", { bubbles: true }));
    expect(btn.disabled).toBe(true);

    confirmInput.value = "IMPORT";
    confirmInput.dispatchEvent(new (h.window as unknown as { Event: typeof Event }).Event("input", { bubbles: true }));
    expect(btn.disabled).toBe(false);
  });

  it("Import stays disabled when preview returns zero candidates", async () => {
    h.setResponder((url) => {
      if (url === "/admin/source-preview/awin") {
        return jsonResponse({
          ok: true,
          provider: "awin",
          domain: "shop.example",
          cacheHit: false,
          fetched: true,
          candidateCount: 0,
          candidates: [],
          errors: [],
        });
      }
      return jsonResponse({});
    });

    h.fill("source-preview-domain", "shop.example");
    h.click("source-preview-btn");
    await h.waitFor(
      () =>
        (h.document.getElementById("source-preview-status")?.textContent ??
          "") === "Preview ok (not saved).",
    );

    const confirmInput = h.document.getElementById(
      "source-import-confirm",
    ) as HTMLInputElement;
    confirmInput.value = "IMPORT";
    confirmInput.dispatchEvent(new (h.window as unknown as { Event: typeof Event }).Event("input", { bubbles: true }));

    const btn = h.document.getElementById(
      "source-import-btn",
    ) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it("Import POST carries correct body + headers and renders only allowlisted summary fields", async () => {
    h.window.localStorage.setItem("salvareAdminToken", "tok-imp-789");
    h.setResponder((url) => {
      if (url === "/admin/source-preview/awin") {
        return jsonResponse({
          ok: true,
          provider: "awin",
          domain: "shop.example",
          cacheHit: false,
          fetched: true,
          candidateCount: 1,
          candidates: [
            {
              sourceId: "awin",
              domain: "shop.example",
              code: "AWIN10",
              label: "10% off",
              expiresAt: "2026-12-31",
              confidence: 0.8,
            },
          ],
          errors: [],
        });
      }
      if (url === "/admin/source-import/awin") {
        return jsonResponse({
          ok: true,
          provider: "awin",
          domain: "shop.example",
          candidatesAccepted: 1,
          codesImported: 1,
          provenanceRecorded: 1,
          rejected: 0,
          errors: [],
          // Server-side bug check: never render these even if smuggled in.
          apiKey: "leaked-api-key",
          Authorization: "Bearer leaked-token",
          rawPayload: "<!doctype html>raw-html",
          envVars: { SALVARE_AWIN_API_KEY: "should-never-render" },
        });
      }
      return jsonResponse({});
    });

    h.fill("source-preview-domain", "shop.example");
    h.click("source-preview-btn");
    await h.waitFor(
      () =>
        (h.document.getElementById("source-preview-status")?.textContent ??
          "") === "Preview ok (not saved).",
    );

    const confirmInput = h.document.getElementById(
      "source-import-confirm",
    ) as HTMLInputElement;
    confirmInput.value = "IMPORT";
    confirmInput.dispatchEvent(new (h.window as unknown as { Event: typeof Event }).Event("input", { bubbles: true }));

    h.click("source-import-btn");

    await h.waitFor(() =>
      h.fetchCalls.some((c) => c.url.includes("/admin/source-import/awin")),
    );

    const call = h.fetchCalls.find((c) =>
      c.url.includes("/admin/source-import/awin"),
    )!;
    expect(call.method).toBe("POST");
    expect(call.headers["Content-Type"]).toBe("application/json");
    expect(call.headers["Authorization"]).toBe("Bearer tok-imp-789");
    expect(JSON.parse(call.body)).toEqual({
      domain: "shop.example",
      confirm: "IMPORT",
    });

    await h.waitFor(() =>
      (h.document.getElementById("source-import-status")?.textContent ?? "")
        .toLowerCase()
        .includes("imported"),
    );

    const summaryText =
      h.document.getElementById("source-import-summary")?.textContent ?? "";
    expect(summaryText).toContain("candidatesAccepted");
    expect(summaryText).toContain("codesImported");
    expect(summaryText).toContain("provenanceRecorded");
    expect(summaryText).toContain("rejected");
    expect(summaryText).not.toContain("apiKey");
    expect(summaryText).not.toContain("Authorization");
    expect(summaryText).not.toContain("Bearer");
    expect(summaryText).not.toContain("leaked-api-key");
    expect(summaryText).not.toContain("leaked-token");
    expect(summaryText).not.toContain("raw-html");
    expect(summaryText).not.toContain("SALVARE_AWIN_API_KEY");
    expect(summaryText).not.toContain("should-never-render");
  });

  it("bootstrap loads the provider list (GET) and defaults to Awin with capabilities", async () => {
    await h.waitFor(() =>
      h.fetchCalls.some((c) => c.url === "/admin/source-providers"),
    );
    const call = h.fetchCalls.find(
      (c) => c.url === "/admin/source-providers",
    )!;
    expect(call.method).toBe("GET");

    const sel = h.document.getElementById(
      "source-preview-provider",
    ) as HTMLSelectElement;
    expect(sel.options.length).toBe(1);
    expect(sel.value).toBe("awin");
    expect(sel.options[0].textContent).toBe("Awin");

    const caps =
      h.document.getElementById("source-preview-capabilities")
        ?.textContent ?? "";
    expect(caps).toContain("preview");
    expect(caps).toContain("import");
    expect(caps).toContain("cache");
  });

  it("re-requests the provider list with the bearer token after the token is saved", async () => {
    h.fill("token-input", "tok-prov-1");
    h.click("token-save");

    await h.waitFor(
      () =>
        h.fetchCalls.filter((c) => c.url === "/admin/source-providers")
          .length >= 2,
    );
    const authed = h.fetchCalls
      .filter((c) => c.url === "/admin/source-providers")
      .some((c) => c.headers["Authorization"] === "Bearer tok-prov-1");
    expect(authed).toBe(true);
  });

  it("preview POSTs to the selected provider's path (awin)", async () => {
    h.setResponder((url) => {
      if (url === "/admin/source-providers") {
        return jsonResponse({
          providers: [
            {
              providerId: "awin",
              sourceId: "awin",
              displayName: "Awin",
              sourceType: "api",
              activation: {
                enabled: true,
                previewEnabled: true,
                importEnabled: true,
                cacheSupported: true,
                schedulerSupported: false,
              },
            },
          ],
        });
      }
      if (url === "/admin/source-preview/awin") {
        return jsonResponse({
          ok: true,
          provider: "awin",
          domain: "shop.example",
          cacheHit: false,
          fetched: true,
          candidateCount: 0,
          candidates: [],
          errors: [],
        });
      }
      return jsonResponse({});
    });

    h.fill("source-preview-domain", "shop.example");
    h.click("source-preview-btn");

    await h.waitFor(() =>
      h.fetchCalls.some((c) => c.url === "/admin/source-preview/awin"),
    );
    expect(
      h.fetchCalls.some((c) => c.url.includes("/admin/source-preview/impact")),
    ).toBe(false);
  });

  it("never renders impact in the selector even if a tampered list smuggles it in", async () => {
    const fresh = await setupHarness();
    fresh.setResponder((url) => {
      if (url === "/admin/source-providers") {
        return jsonResponse({
          providers: [
            {
              providerId: "awin",
              sourceId: "awin",
              displayName: "Awin",
              sourceType: "api",
              activation: {
                enabled: true,
                previewEnabled: true,
                importEnabled: true,
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
                importEnabled: true,
                cacheSupported: false,
                schedulerSupported: false,
              },
            },
            {
              providerId: "evil",
              sourceId: "evil",
              displayName: "../../etc/passwd",
              sourceType: "api",
              activation: {
                enabled: true,
                previewEnabled: true,
                importEnabled: true,
                cacheSupported: true,
                schedulerSupported: false,
              },
            },
          ],
        });
      }
      return jsonResponse({});
    });
    // Force a reload of the provider list under the tampered responder.
    fresh.fill("token-input", "tok-x");
    fresh.click("token-save");

    await fresh.waitFor(
      () =>
        fresh.fetchCalls.filter(
          (c) => c.url === "/admin/source-providers",
        ).length >= 2,
    );

    const sel = fresh.document.getElementById(
      "source-preview-provider",
    ) as HTMLSelectElement;
    const values = Array.from(sel.options).map((o) => o.value);
    expect(values).toEqual(["awin"]);
    const selectText = sel.textContent ?? "";
    expect(selectText).not.toContain("impact");
    expect(selectText).not.toContain("passwd");
    await fresh.cleanup();
  });

  it("import button stays disabled when the selected provider lacks importSupported", async () => {
    const fresh = await setupHarness();
    fresh.setResponder((url) => {
      if (url === "/admin/source-providers") {
        return jsonResponse({
          providers: [
            {
              providerId: "awin",
              sourceId: "awin",
              displayName: "Awin",
              sourceType: "api",
              activation: {
                enabled: true,
                previewEnabled: true,
                importEnabled: false,
                cacheSupported: true,
                schedulerSupported: false,
              },
            },
          ],
        });
      }
      if (url === "/admin/source-preview/awin") {
        return jsonResponse({
          ok: true,
          provider: "awin",
          domain: "shop.example",
          cacheHit: false,
          fetched: true,
          candidateCount: 1,
          candidates: [
            {
              sourceId: "awin",
              domain: "shop.example",
              code: "AWIN10",
              label: "10% off",
              expiresAt: "2026-12-31",
              confidence: 0.8,
            },
          ],
          errors: [],
        });
      }
      return jsonResponse({});
    });
    fresh.fill("token-input", "tok-y");
    fresh.click("token-save");

    await fresh.waitFor(
      () =>
        fresh.fetchCalls.filter(
          (c) => c.url === "/admin/source-providers",
        ).length >= 2,
    );

    fresh.fill("source-preview-domain", "shop.example");
    fresh.click("source-preview-btn");
    await fresh.waitFor(
      () =>
        (fresh.document.getElementById("source-preview-status")
          ?.textContent ?? "") === "Preview ok (not saved).",
    );

    const confirmInput = fresh.document.getElementById(
      "source-import-confirm",
    ) as HTMLInputElement;
    confirmInput.value = "IMPORT";
    confirmInput.dispatchEvent(
      new (fresh.window as unknown as { Event: typeof Event }).Event("input", {
        bubbles: true,
      }),
    );

    const btn = fresh.document.getElementById(
      "source-import-btn",
    ) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    await fresh.cleanup();
  });

  it("makes only the one source-preview POST per click and no coupon-write requests", async () => {
    h.setResponder((url) => {
      if (url === "/admin/source-preview/awin") {
        return jsonResponse({
          ok: true,
          provider: "awin",
          domain: "shop.example",
          cacheHit: false,
          fetched: true,
          candidateCount: 0,
          candidates: [],
          errors: [],
        });
      }
      return jsonResponse({});
    });

    const callsBefore = h.fetchCalls.length;
    h.fill("source-preview-domain", "shop.example");
    h.click("source-preview-btn");

    await h.waitFor(() =>
      h.fetchCalls.some((c) => c.url.includes("/admin/source-preview/awin")),
    );

    const newCalls = h.fetchCalls.slice(callsBefore);
    const previewCalls = newCalls.filter((c) =>
      c.url.includes("/admin/source-preview/awin"),
    );
    expect(previewCalls).toHaveLength(1);
    expect(
      newCalls.some((c) =>
        c.url.match(/\/admin\/(coupons|import|export)/),
      ),
    ).toBe(false);
  });
});
