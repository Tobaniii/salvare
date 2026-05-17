import { describe, it, expect } from "vitest";
import { buildSafeProvenance } from "./coupons";
import type { RawProvenanceClaim } from "./db-coupon-provenance";

const m = (
  entries: Array<[string, RawProvenanceClaim[]]>,
): Map<string, RawProvenanceClaim[]> => new Map(entries);

describe("buildSafeProvenance", () => {
  it("returns undefined when no code has any claim", () => {
    expect(buildSafeProvenance(["A", "B"], m([]))).toBeUndefined();
  });

  it("emits one allowlisted entry per claimed code, in codes order", () => {
    const out = buildSafeProvenance(
      ["B", "A"],
      m([
        ["A", [{ sourceType: "seed", confidence: 10, discoveredAt: "2026-01-01T00:00:00.000Z" }]],
        ["B", [{ sourceType: "manual", confidence: null, discoveredAt: null }]],
      ]),
    );
    expect(out).toEqual([
      { code: "B", sourceType: "manual" },
      {
        code: "A",
        sourceType: "seed",
        confidence: 10,
        discoveredAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
  });

  it("skips codes with no claim (no entry, not a null entry)", () => {
    const out = buildSafeProvenance(
      ["A", "B", "C"],
      m([["B", [{ sourceType: "api", confidence: null, discoveredAt: null }]]]),
    );
    expect(out).toEqual([{ code: "B", sourceType: "api" }]);
  });

  it("collapses by highest confidence first", () => {
    const out = buildSafeProvenance(
      ["X"],
      m([
        ["X", [
          { sourceType: "manual", confidence: 20, discoveredAt: "2026-05-01T00:00:00.000Z" },
          { sourceType: "seed", confidence: 90, discoveredAt: "2026-01-01T00:00:00.000Z" },
        ]],
      ]),
    );
    expect(out).toEqual([
      {
        code: "X",
        sourceType: "seed",
        confidence: 90,
        discoveredAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
  });

  it("breaks confidence ties by most recent discoveredAt, then source-type priority", () => {
    const recent = buildSafeProvenance(
      ["X"],
      m([
        ["X", [
          { sourceType: "seed", confidence: null, discoveredAt: "2026-01-01T00:00:00.000Z" },
          { sourceType: "api", confidence: null, discoveredAt: "2026-05-01T00:00:00.000Z" },
        ]],
      ]),
    );
    expect(recent?.[0].discoveredAt).toBe("2026-05-01T00:00:00.000Z");

    const byType = buildSafeProvenance(
      ["X"],
      m([
        ["X", [
          { sourceType: "seed", confidence: null, discoveredAt: null },
          { sourceType: "manual", confidence: null, discoveredAt: null },
        ]],
      ]),
    );
    expect(byType?.[0].sourceType).toBe("manual");
  });

  it("drops out-of-range / non-finite confidence rather than emitting it", () => {
    const out = buildSafeProvenance(
      ["X"],
      m([["X", [{ sourceType: "api", confidence: 999, discoveredAt: null }]]]),
    );
    expect(out).toEqual([{ code: "X", sourceType: "api" }]);
  });
});
