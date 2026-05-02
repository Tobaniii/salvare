import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { reportCouponResult } from "./resultReporter";

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.reject(new Error("backend unavailable"))),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const samplePayload = {
  domain: "example.com",
  code: "WELCOME10",
  success: true,
  savingsCents: 1500,
  finalTotalCents: 8500,
};

describe("reportCouponResult", () => {
  it("sends a POST to /results with the expected body", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve({ ok: true } as unknown as Response),
    );
    vi.stubGlobal("fetch", fetchMock);

    await reportCouponResult(samplePayload);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:4123/results");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe(
      "application/json",
    );
    expect(JSON.parse(init.body as string)).toEqual(samplePayload);
  });

  it("resolves silently when fetch rejects with a network error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("network down"))),
    );
    await expect(reportCouponResult(samplePayload)).resolves.toBeUndefined();
  });

  it("resolves silently when the backend returns a non-OK response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({ ok: false, status: 500 } as unknown as Response),
      ),
    );
    await expect(reportCouponResult(samplePayload)).resolves.toBeUndefined();
  });

  it("resolves silently when fetch throws synchronously", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        throw new Error("sync throw");
      }),
    );
    await expect(reportCouponResult(samplePayload)).resolves.toBeUndefined();
  });
});
