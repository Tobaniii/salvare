import type { ResultRecord } from "./results";

type Bucket = "success" | "none" | "failure";

interface RankedCode {
  code: string;
  seedIndex: number;
  bucket: Bucket;
  averageSavings: number;
  mostRecentSuccessAt: string;
}

const BUCKET_ORDER: Record<Bucket, number> = {
  success: 0,
  none: 1,
  failure: 2,
};

export function rankCandidateCodes(
  codes: string[],
  history: ResultRecord[],
): string[] {
  const stats = new Map<
    string,
    { successes: ResultRecord[]; failures: ResultRecord[] }
  >();
  for (const code of codes) {
    stats.set(code, { successes: [], failures: [] });
  }

  for (const record of history) {
    const entry = stats.get(record.code);
    if (!entry) continue; // ignore history for codes not in the seed
    if (record.success) entry.successes.push(record);
    else entry.failures.push(record);
  }

  const ranked: RankedCode[] = codes.map((code, seedIndex) => {
    const entry = stats.get(code)!;
    if (entry.successes.length > 0) {
      const total = entry.successes.reduce((sum, r) => sum + r.savingsCents, 0);
      const averageSavings = total / entry.successes.length;
      const mostRecentSuccessAt = entry.successes
        .map((r) => r.testedAt)
        .reduce((latest, t) => (t > latest ? t : latest), "");
      return {
        code,
        seedIndex,
        bucket: "success",
        averageSavings,
        mostRecentSuccessAt,
      };
    }
    if (entry.failures.length > 0) {
      return {
        code,
        seedIndex,
        bucket: "failure",
        averageSavings: 0,
        mostRecentSuccessAt: "",
      };
    }
    return {
      code,
      seedIndex,
      bucket: "none",
      averageSavings: 0,
      mostRecentSuccessAt: "",
    };
  });

  ranked.sort((a, b) => {
    if (BUCKET_ORDER[a.bucket] !== BUCKET_ORDER[b.bucket]) {
      return BUCKET_ORDER[a.bucket] - BUCKET_ORDER[b.bucket];
    }
    if (a.bucket === "success") {
      if (a.averageSavings !== b.averageSavings) {
        return b.averageSavings - a.averageSavings;
      }
      if (a.mostRecentSuccessAt !== b.mostRecentSuccessAt) {
        return b.mostRecentSuccessAt.localeCompare(a.mostRecentSuccessAt);
      }
    }
    return a.seedIndex - b.seedIndex;
  });

  return ranked.map((r) => r.code);
}
