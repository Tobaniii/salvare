import { describe, it, expect } from "vitest";
import { buildCouponStats } from "./stats";
import { rankCandidateCodes } from "./ranking";
import type { ResultRecord } from "./results";

function makeRecord(
  code: string,
  success: boolean,
  savingsCents: number,
  testedAt: string,
): ResultRecord {
  return {
    domain: "example.com",
    code,
    success,
    savingsCents,
    finalTotalCents: 0,
    testedAt,
  };
}

describe("buildCouponStats", () => {
  it("counts successes for a code with multiple successful records", () => {
    const codes = ["A"];
    const history = [
      makeRecord("A", true, 100, "2026-05-01T00:00:00.000Z"),
      makeRecord("A", true, 200, "2026-05-02T00:00:00.000Z"),
    ];
    const stats = buildCouponStats(codes, history);
    expect(stats).toHaveLength(1);
    expect(stats[0].successCount).toBe(2);
  });

  it("counts failures correctly across mixed records", () => {
    const codes = ["A"];
    const history = [
      makeRecord("A", true, 100, "2026-05-01T00:00:00.000Z"),
      makeRecord("A", false, 0, "2026-05-02T00:00:00.000Z"),
      makeRecord("A", false, 0, "2026-05-03T00:00:00.000Z"),
    ];
    const stats = buildCouponStats(codes, history);
    expect(stats[0].successCount).toBe(1);
    expect(stats[0].failureCount).toBe(2);
  });

  it("averages savings only across successful records", () => {
    const codes = ["A"];
    const history = [
      makeRecord("A", true, 100, "2026-05-01T00:00:00.000Z"),
      makeRecord("A", true, 300, "2026-05-02T00:00:00.000Z"),
      makeRecord("A", false, 0, "2026-05-03T00:00:00.000Z"),
    ];
    const stats = buildCouponStats(codes, history);
    expect(stats[0].averageSavingsCents).toBe(200);
  });

  it("computes lastSuccessAt as the latest successful testedAt", () => {
    const codes = ["A"];
    const history = [
      makeRecord("A", true, 100, "2026-04-01T00:00:00.000Z"),
      makeRecord("A", true, 100, "2026-05-02T12:00:00.000Z"),
      makeRecord("A", false, 0, "2026-06-01T00:00:00.000Z"),
    ];
    const stats = buildCouponStats(codes, history);
    expect(stats[0].lastSuccessAt).toBe("2026-05-02T12:00:00.000Z");
  });

  it("returns nulls and zero counts for a code with no history", () => {
    const codes = ["A"];
    const stats = buildCouponStats(codes, []);
    expect(stats[0]).toEqual({
      code: "A",
      rank: 1,
      successCount: 0,
      failureCount: 0,
      averageSavingsCents: null,
      lastSuccessAt: null,
    });
  });

  it("excludes history for codes not in the candidate list", () => {
    const codes = ["A"];
    const history = [
      makeRecord("X", true, 9999, "2026-05-01T00:00:00.000Z"),
      makeRecord("A", true, 100, "2026-05-02T00:00:00.000Z"),
    ];
    const stats = buildCouponStats(codes, history);
    expect(stats).toHaveLength(1);
    expect(stats[0].code).toBe("A");
    expect(stats[0].successCount).toBe(1);
    expect(stats[0].averageSavingsCents).toBe(100);
  });

  it("preserves the ranked order from rankCandidateCodes", () => {
    const codes = ["A", "B", "C"];
    const history = [
      makeRecord("A", false, 0, "2026-05-01T00:00:00.000Z"),
      makeRecord("B", true, 200, "2026-05-01T00:00:00.000Z"),
    ];
    const expectedOrder = rankCandidateCodes(codes, history);
    const stats = buildCouponStats(codes, history);
    expect(stats.map((s) => s.code)).toEqual(expectedOrder);
    expect(stats.map((s) => s.rank)).toEqual([1, 2, 3]);
  });
});
