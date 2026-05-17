import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { fetchCandidateCodesWithProvenance } from "./couponProvider";

function backendBody(extra: Record<string, unknown>) {
  return {
    domain: "shop.example",
    candidateCodes: ["A", "B"],
    source: "mock-backend",
    updatedAt: "2026-05-16T00:00:00.000Z",
    ...extra,
  };
}

function stubFetchJson(body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(body),
      } as unknown as Response),
    ),
  );
}

beforeEach(() => vi.unstubAllGlobals());
afterEach(() => vi.unstubAllGlobals());

describe("fetchCandidateCodesWithProvenance — tolerant + sanitizing", () => {
  it("returns codes with provenance undefined when the field is absent", async () => {
    stubFetchJson(backendBody({}));
    const out = await fetchCandidateCodesWithProvenance("shop.example");
    expect(out.candidateCodes).toEqual(["A", "B"]);
    expect(out.candidateProvenance).toBeUndefined();
  });

  it("does NOT reject the response when candidateProvenance is garbage", async () => {
    stubFetchJson(backendBody({ candidateProvenance: "totally-not-an-array" }));
    const out = await fetchCandidateCodesWithProvenance("shop.example");
    expect(out.candidateCodes).toEqual(["A", "B"]);
    expect(out.candidateProvenance).toBeUndefined();
  });

  it("drops malformed/extra fields and keeps only the allowlist", async () => {
    stubFetchJson(
      backendBody({
        candidateProvenance: [
          {
            code: "A",
            sourceType: "seed",
            confidence: 200, // out of range -> dropped
            discoveredAt: 5, // not a string -> dropped
            sourceUrl: "https://evil.example", // not allowlisted -> dropped
            publisherId: "x", // not allowlisted -> dropped
          },
          { code: "B", sourceType: "manual", confidence: 80 },
          { sourceType: "seed" }, // missing code -> skipped
          "junk", // not an object -> skipped
        ],
      }),
    );
    const out = await fetchCandidateCodesWithProvenance("shop.example");
    expect(out.candidateProvenance).toEqual([
      { code: "A", sourceType: "seed" },
      { code: "B", sourceType: "manual", confidence: 80 },
    ]);
    const serialized = JSON.stringify(out.candidateProvenance);
    expect(serialized).not.toContain("sourceUrl");
    expect(serialized).not.toContain("publisherId");
  });

  it("falls back to mock codes (no provenance) when the backend fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("offline"))),
    );
    const out = await fetchCandidateCodesWithProvenance("localhost");
    expect(out.candidateCodes).toEqual(["SAVE10", "TAKE15", "FREESHIP"]);
    expect(out.candidateProvenance).toBeUndefined();
  });
});
