import { describe, it, expect } from "vitest";
import {
  orderCandidatesBySource,
  type CandidateSourceClaim,
} from "./candidate-order";
import { rankCandidateCodes } from "./ranking";
import type { ResultRecord } from "./results";

const FIXED_NOW_ISO = "2026-05-14T12:00:00.000Z";
const now = () => new Date(FIXED_NOW_ISO);

function claim(
  overrides: Partial<CandidateSourceClaim> & Pick<CandidateSourceClaim, "sourceId" | "sourceType">,
): CandidateSourceClaim {
  return overrides as CandidateSourceClaim;
}

describe("orderCandidatesBySource — determinism and stability", () => {
  it("returns the same set of codes and preserves input order when no metadata is supplied", () => {
    const codes = ["A", "B", "C", "D"];
    const { orderedCodes } = orderCandidatesBySource(codes, new Map(), { now });
    expect(orderedCodes).toEqual(["A", "B", "C", "D"]);
  });

  it("is deterministic for repeated calls", () => {
    const codes = ["A", "B", "C"];
    const claims = new Map<string, CandidateSourceClaim[]>([
      ["A", [claim({ sourceId: "admin", sourceType: "manual" })]],
      ["B", [claim({ sourceId: "awin", sourceType: "api" })]],
    ]);
    const r1 = orderCandidatesBySource(codes, claims, { now }).orderedCodes;
    const r2 = orderCandidatesBySource(codes, claims, { now }).orderedCodes;
    const r3 = orderCandidatesBySource(codes, claims, { now }).orderedCodes;
    expect(r1).toEqual(r2);
    expect(r2).toEqual(r3);
  });

  it("preserves stable input order across ties (same score)", () => {
    const codes = ["X", "Y", "Z"];
    const claims = new Map<string, CandidateSourceClaim[]>([
      ["X", [claim({ sourceId: "awin", sourceType: "api" })]],
      ["Y", [claim({ sourceId: "awin", sourceType: "api" })]],
      ["Z", [claim({ sourceId: "awin", sourceType: "api" })]],
    ]);
    const { orderedCodes } = orderCandidatesBySource(codes, claims, { now });
    expect(orderedCodes).toEqual(["X", "Y", "Z"]);
  });
});

describe("orderCandidatesBySource — scoring signals", () => {
  it("higher confidence moves a code earlier", () => {
    const codes = ["LOW", "HIGH"];
    const claims = new Map<string, CandidateSourceClaim[]>([
      ["LOW", [claim({ sourceId: "awin", sourceType: "api", confidence: 10 })]],
      ["HIGH", [claim({ sourceId: "awin", sourceType: "api", confidence: 80 })]],
    ]);
    const { orderedCodes } = orderCandidatesBySource(codes, claims, { now });
    expect(orderedCodes).toEqual(["HIGH", "LOW"]);
  });

  it("fresher discoveredAt moves a code earlier", () => {
    const codes = ["OLD", "FRESH"];
    const claims = new Map<string, CandidateSourceClaim[]>([
      [
        "OLD",
        [
          claim({
            sourceId: "awin",
            sourceType: "api",
            discoveredAt: "2026-04-01T00:00:00.000Z",
          }),
        ],
      ],
      [
        "FRESH",
        [
          claim({
            sourceId: "awin",
            sourceType: "api",
            discoveredAt: "2026-05-14T11:00:00.000Z",
          }),
        ],
      ],
    ]);
    const { orderedCodes } = orderCandidatesBySource(codes, claims, { now });
    expect(orderedCodes).toEqual(["FRESH", "OLD"]);
  });

  it("multiple distinct sources move a code earlier (multi-source bonus)", () => {
    const codes = ["SOLO", "MULTI"];
    const claims = new Map<string, CandidateSourceClaim[]>([
      ["SOLO", [claim({ sourceId: "awin", sourceType: "api" })]],
      [
        "MULTI",
        [
          claim({ sourceId: "awin", sourceType: "api" }),
          claim({ sourceId: "import", sourceType: "import" }),
          claim({ sourceId: "admin", sourceType: "manual" }),
        ],
      ],
    ]);
    const { orderedCodes } = orderCandidatesBySource(codes, claims, { now });
    expect(orderedCodes).toEqual(["MULTI", "SOLO"]);
  });

  it("source type weighting: admin (manual) beats provider (api) when nothing else differs", () => {
    const codes = ["API", "ADMIN"];
    const claims = new Map<string, CandidateSourceClaim[]>([
      ["API", [claim({ sourceId: "awin", sourceType: "api" })]],
      ["ADMIN", [claim({ sourceId: "admin", sourceType: "manual" })]],
    ]);
    const { orderedCodes } = orderCandidatesBySource(codes, claims, { now });
    expect(orderedCodes).toEqual(["ADMIN", "API"]);
  });

  it("codes with no claims score 0 and keep their position relative to other zero-score codes", () => {
    const codes = ["A", "B", "SOURCED"];
    const claims = new Map<string, CandidateSourceClaim[]>([
      [
        "SOURCED",
        [claim({ sourceId: "awin", sourceType: "api", confidence: 50 })],
      ],
    ]);
    const { orderedCodes } = orderCandidatesBySource(codes, claims, { now });
    expect(orderedCodes).toEqual(["SOURCED", "A", "B"]);
  });
});

describe("orderCandidatesBySource — redaction of unsafe inputs", () => {
  it("ignores affiliate/tracking/payout/sourceUrl fields if smuggled into a claim", () => {
    const codes = ["CLEAN", "SMUGGLED"];
    // Cast through unknown to attach fields the type does not allow — proves
    // the scorer would never see them even if a future caller forgot to
    // strip them.
    const smuggled = {
      sourceId: "awin",
      sourceType: "api",
      confidence: 100,
      clickThroughUrl: "https://affiliate.example/click?id=1",
      trackingUrl: "https://track.example/t",
      commissionRate: 0.12,
      publisherId: "pub-42",
      sourceUrl: "https://affiliate.example/offer?aff=1",
      apiKey: "very-secret",
      Authorization: "Bearer leaked",
    } as unknown as CandidateSourceClaim;
    const cleanClaim = claim({
      sourceId: "awin",
      sourceType: "api",
      confidence: 100,
    });
    const claims = new Map<string, CandidateSourceClaim[]>([
      ["CLEAN", [cleanClaim]],
      ["SMUGGLED", [smuggled]],
    ]);
    const { orderedCodes, explanations } = orderCandidatesBySource(
      codes,
      claims,
      { now, withExplanations: true },
    );
    expect(orderedCodes).toEqual(["CLEAN", "SMUGGLED"]);
    expect(JSON.stringify(explanations)).not.toContain("affiliate.example");
    expect(JSON.stringify(explanations)).not.toContain("commissionRate");
    expect(JSON.stringify(explanations)).not.toContain("publisherId");
    expect(JSON.stringify(explanations)).not.toContain("apiKey");
    expect(JSON.stringify(explanations)).not.toContain("Authorization");
    expect(JSON.stringify(explanations)).not.toContain("sourceUrl");
    expect(JSON.stringify(explanations)).not.toContain("clickThroughUrl");
    expect(JSON.stringify(explanations)).not.toContain("trackingUrl");
  });

  it("clamps out-of-range confidence values without throwing", () => {
    const codes = ["NEG", "OVER", "OK"];
    const claims = new Map<string, CandidateSourceClaim[]>([
      ["NEG", [claim({ sourceId: "awin", sourceType: "api", confidence: -50 })]],
      [
        "OVER",
        [claim({ sourceId: "awin", sourceType: "api", confidence: 500 })],
      ],
      ["OK", [claim({ sourceId: "awin", sourceType: "api", confidence: 50 })]],
    ]);
    const { explanations } = orderCandidatesBySource(codes, claims, {
      now,
      withExplanations: true,
    });
    const byCode = new Map(explanations!.map((e) => [e.code, e]));
    expect(byCode.get("NEG")!.confidence).toBe(0);
    expect(byCode.get("OVER")!.confidence).toBe(100);
    expect(byCode.get("OK")!.confidence).toBe(50);
  });
});

describe("orderCandidatesBySource — winner-selection invariant", () => {
  // rankCandidateCodes orders by past-result bucket and falls back to input
  // order on ties. The simulated checkout below records BIG as the better
  // verified outcome (higher savings, lower final total) while source
  // scoring would prefer TINY. The post-ranking winner must always be BIG.
  function simulateWinner(orderedInput: string[]): string {
    const history: ResultRecord[] = [
      {
        domain: "shop.example",
        code: "BIG",
        success: true,
        savingsCents: 1000,
        finalTotalCents: 9000,
        testedAt: "2026-05-14T10:00:00.000Z",
      },
      {
        domain: "shop.example",
        code: "TINY",
        success: true,
        savingsCents: 5,
        finalTotalCents: 9995,
        testedAt: "2026-05-14T10:30:00.000Z",
      },
    ];
    const ranked = rankCandidateCodes(orderedInput, history);
    return ranked[0];
  }

  it("source ordering cannot change the verified-checkout winner (lowest finalTotalCents)", () => {
    const codes = ["BIG", "TINY"];
    // Heavy source bias on TINY — multiple admin claims + max confidence +
    // very fresh discovery — should pull TINY ahead in source ordering.
    const claims = new Map<string, CandidateSourceClaim[]>([
      [
        "TINY",
        [
          claim({
            sourceId: "admin",
            sourceType: "manual",
            confidence: 100,
            discoveredAt: FIXED_NOW_ISO,
          }),
          claim({
            sourceId: "import",
            sourceType: "import",
            confidence: 100,
            discoveredAt: FIXED_NOW_ISO,
          }),
          claim({
            sourceId: "awin",
            sourceType: "api",
            confidence: 100,
            discoveredAt: FIXED_NOW_ISO,
          }),
        ],
      ],
      ["BIG", []],
    ]);
    const { orderedCodes } = orderCandidatesBySource(codes, claims, { now });
    // Source order puts TINY first.
    expect(orderedCodes).toEqual(["TINY", "BIG"]);
    // But rankCandidateCodes(history) restores BIG as winner.
    expect(simulateWinner(orderedCodes)).toBe("BIG");
  });

  it("reversed source-ordered input still picks the same verified winner", () => {
    const codes = ["BIG", "TINY"];
    const reversed = [...codes].reverse();
    expect(simulateWinner(codes)).toBe(simulateWinner(reversed));
    expect(simulateWinner(reversed)).toBe("BIG");
  });
});
