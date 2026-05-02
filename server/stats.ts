import type { ResultRecord } from "./results";
import { rankCandidateCodes } from "./ranking";

export interface CodeStats {
  code: string;
  rank: number;
  successCount: number;
  failureCount: number;
  averageSavingsCents: number | null;
  lastSuccessAt: string | null;
}

export function buildCouponStats(
  codes: string[],
  history: ResultRecord[],
): CodeStats[] {
  const codeSet = new Set(codes);
  const successes = new Map<string, ResultRecord[]>();
  const failures = new Map<string, ResultRecord[]>();
  for (const code of codes) {
    successes.set(code, []);
    failures.set(code, []);
  }

  for (const record of history) {
    if (!codeSet.has(record.code)) continue;
    if (record.success) {
      successes.get(record.code)!.push(record);
    } else {
      failures.get(record.code)!.push(record);
    }
  }

  const ranked = rankCandidateCodes(codes, history);

  return ranked.map((code, index) => {
    const codeSuccesses = successes.get(code) ?? [];
    const codeFailures = failures.get(code) ?? [];

    let averageSavingsCents: number | null = null;
    let lastSuccessAt: string | null = null;
    if (codeSuccesses.length > 0) {
      const total = codeSuccesses.reduce((sum, r) => sum + r.savingsCents, 0);
      averageSavingsCents = Math.round(total / codeSuccesses.length);
      lastSuccessAt = codeSuccesses
        .map((r) => r.testedAt)
        .reduce((latest, t) => (t > latest ? t : latest), "");
    }

    return {
      code,
      rank: index + 1,
      successCount: codeSuccesses.length,
      failureCount: codeFailures.length,
      averageSavingsCents,
      lastSuccessAt,
    };
  });
}
