import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export interface ResultRecord {
  domain: string;
  code: string;
  success: boolean;
  savingsCents: number;
  finalTotalCents: number;
  testedAt: string;
}

export type ResultBodyValidation =
  | {
      ok: true;
      domain: string;
      code: string;
      success: boolean;
      savingsCents: number;
      finalTotalCents: number;
    }
  | { ok: false; error: string };

export function validateResultBody(body: unknown): ResultBodyValidation {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "body must be an object" };
  }
  const b = body as Record<string, unknown>;

  if (typeof b.domain !== "string" || b.domain.trim().length === 0) {
    return { ok: false, error: "domain must be a non-empty string" };
  }
  if (typeof b.code !== "string" || b.code.trim().length === 0) {
    return { ok: false, error: "code must be a non-empty string" };
  }
  if (typeof b.success !== "boolean") {
    return { ok: false, error: "success must be a boolean" };
  }
  if (
    typeof b.savingsCents !== "number" ||
    !Number.isInteger(b.savingsCents) ||
    b.savingsCents < 0
  ) {
    return {
      ok: false,
      error: "savingsCents must be a non-negative integer",
    };
  }
  if (
    typeof b.finalTotalCents !== "number" ||
    !Number.isInteger(b.finalTotalCents) ||
    b.finalTotalCents < 0
  ) {
    return {
      ok: false,
      error: "finalTotalCents must be a non-negative integer",
    };
  }

  return {
    ok: true,
    domain: b.domain.trim(),
    code: b.code.trim(),
    success: b.success,
    savingsCents: b.savingsCents,
    finalTotalCents: b.finalTotalCents,
  };
}

let runtimeResults: ResultRecord[] = [];

const RESULTS_FILE_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "coupon-results.json",
);

function isValidResultRecord(value: unknown): value is ResultRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r.domain === "string" &&
    typeof r.code === "string" &&
    typeof r.success === "boolean" &&
    typeof r.savingsCents === "number" &&
    typeof r.finalTotalCents === "number" &&
    typeof r.testedAt === "string"
  );
}

function persistResultsToDisk(): void {
  const tmpPath = `${RESULTS_FILE_PATH}.tmp`;
  writeFileSync(
    tmpPath,
    JSON.stringify({ results: runtimeResults }, null, 2) + "\n",
    "utf8",
  );
  renameSync(tmpPath, RESULTS_FILE_PATH);
}

let persistFn: () => void = persistResultsToDisk;

export function loadResultsFromDisk(): void {
  try {
    const raw = readFileSync(RESULTS_FILE_PATH, "utf8");
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === "object" &&
      Array.isArray((parsed as { results?: unknown }).results) &&
      (parsed as { results: unknown[] }).results.every(isValidResultRecord)
    ) {
      runtimeResults = (parsed as { results: ResultRecord[] }).results;
    }
  } catch {
    // Disk read failed; keep in-memory defaults.
  }
}

export function appendResult(
  record: Omit<ResultRecord, "testedAt">,
  now: () => Date = () => new Date(),
): ResultRecord {
  const stored: ResultRecord = {
    ...record,
    testedAt: now().toISOString(),
  };
  runtimeResults.push(stored);
  persistFn();
  return stored;
}

export function getResultsForDomain(domain: string): ResultRecord[] {
  const trimmed = domain.trim();
  return runtimeResults.filter((r) => r.domain === trimmed);
}

export function getAllResults(): ResultRecord[] {
  return [...runtimeResults];
}

export function setResultsPersistForTests(fn: () => void): void {
  persistFn = fn;
}

export function resetResultsForTests(): void {
  runtimeResults = [];
}
