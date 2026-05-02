import { describe, it, expect } from "vitest";
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

describe("rankCandidateCodes", () => {
  it("moves a successful code before a no-history code", () => {
    const codes = ["A", "B"];
    const history = [makeRecord("B", true, 100, "2026-05-01T00:00:00.000Z")];
    expect(rankCandidateCodes(codes, history)).toEqual(["B", "A"]);
  });

  it("ranks higher average savings first", () => {
    const codes = ["A", "B"];
    const history = [
      makeRecord("A", true, 100, "2026-05-01T00:00:00.000Z"),
      makeRecord("B", true, 200, "2026-05-01T00:00:00.000Z"),
    ];
    expect(rankCandidateCodes(codes, history)).toEqual(["B", "A"]);
  });

  it("breaks ties on average savings by most recent success", () => {
    const codes = ["A", "B"];
    const history = [
      makeRecord("A", true, 100, "2026-04-01T00:00:00.000Z"),
      makeRecord("B", true, 100, "2026-05-01T00:00:00.000Z"),
    ];
    expect(rankCandidateCodes(codes, history)).toEqual(["B", "A"]);
  });

  it("preserves seed order for codes with no history", () => {
    const codes = ["A", "B", "C"];
    expect(rankCandidateCodes(codes, [])).toEqual(["A", "B", "C"]);
  });

  it("places failure-only codes last after no-history codes", () => {
    const codes = ["A", "B", "C"];
    const history = [
      makeRecord("A", true, 100, "2026-05-01T00:00:00.000Z"),
      makeRecord("C", false, 0, "2026-05-01T00:00:00.000Z"),
    ];
    expect(rankCandidateCodes(codes, history)).toEqual(["A", "B", "C"]);
  });

  it("preserves seed order among failure-only codes", () => {
    const codes = ["A", "B", "C"];
    const history = [
      makeRecord("A", false, 0, "2026-04-01T00:00:00.000Z"),
      makeRecord("B", false, 0, "2026-05-01T00:00:00.000Z"),
      makeRecord("C", false, 0, "2026-03-01T00:00:00.000Z"),
    ];
    expect(rankCandidateCodes(codes, history)).toEqual(["A", "B", "C"]);
  });

  it("ignores history for codes that are not in the seed", () => {
    const codes = ["A"];
    const history = [makeRecord("B", true, 9999, "2026-05-01T00:00:00.000Z")];
    expect(rankCandidateCodes(codes, history)).toEqual(["A"]);
  });
});
