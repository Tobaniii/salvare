import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { reportCouponResult } from "./resultReporter";

const payload = {
  domain: "example.com",
  code: "WELCOME10",
  success: true,
  savingsCents: 1500,
  finalTotalCents: 8500,
};

beforeEach(() => vi.unstubAllGlobals());
afterEach(() => vi.unstubAllGlobals());

describe("reportCouponResult — bounded failure-only retry (v0.50.0)", () => {
  it("does NOT retry on success (exactly one attempt)", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve({ ok: true } as unknown as Response),
    );
    vi.stubGlobal("fetch", fetchMock);
    const outcomes: boolean[] = [];

    await reportCouponResult(payload, (ok) => outcomes.push(ok));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(outcomes).toEqual([true]);
  });

  it("retries exactly once on a network failure, then reports failure", async () => {
    const fetchMock = vi.fn(() => Promise.reject(new Error("down")));
    vi.stubGlobal("fetch", fetchMock);
    const outcomes: boolean[] = [];

    await expect(
      reportCouponResult(payload, (ok) => outcomes.push(ok)),
    ).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(outcomes).toEqual([false]);
  });

  it("retries once on a non-OK response", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve({ ok: false, status: 500 } as unknown as Response),
    );
    vi.stubGlobal("fetch", fetchMock);
    const outcomes: boolean[] = [];

    await reportCouponResult(payload, (ok) => outcomes.push(ok));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(outcomes).toEqual([false]);
  });

  it("recovers when the retry succeeds (failure then ok)", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("transient"))
      .mockResolvedValueOnce({ ok: true } as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);
    const outcomes: boolean[] = [];

    await reportCouponResult(payload, (ok) => outcomes.push(ok));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(outcomes).toEqual([true]);
  });

  it("still resolves undefined and swallows when no callback is given", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("down"))),
    );
    await expect(reportCouponResult(payload)).resolves.toBeUndefined();
  });
});
