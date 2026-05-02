import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import seedData from "./coupons.seed.json";

export type CouponApiSource = "mock-backend" | "none";

export interface CouponApiResponse {
  domain: string;
  candidateCodes: string[];
  source: CouponApiSource;
  updatedAt: string;
}

const BUNDLED_DEFAULT: Record<string, string[]> =
  seedData && typeof seedData === "object"
    ? (seedData as Record<string, string[]>)
    : {};

let runtimeSeed: Record<string, string[]> = { ...BUNDLED_DEFAULT };

const SEED_FILE_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "coupons.seed.json",
);

function persistToDisk(): void {
  const tmpPath = `${SEED_FILE_PATH}.tmp`;
  writeFileSync(
    tmpPath,
    JSON.stringify(runtimeSeed, null, 2) + "\n",
    "utf8",
  );
  renameSync(tmpPath, SEED_FILE_PATH);
}

let persistFn: () => void = persistToDisk;

function isValidSeedShape(value: unknown): value is Record<string, string[]> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.values(value as Record<string, unknown>).every(
    (codes) =>
      Array.isArray(codes) && codes.every((c) => typeof c === "string"),
  );
}

export function loadSeedFromDisk(): void {
  try {
    const raw = readFileSync(SEED_FILE_PATH, "utf8");
    const parsed = JSON.parse(raw);
    if (isValidSeedShape(parsed)) {
      runtimeSeed = parsed;
    }
  } catch {
    // Disk read failed; keep bundled defaults.
  }
}

export function getSeedData(): Record<string, string[]> {
  return { ...runtimeSeed };
}

export function buildCouponResponse(
  domain: string,
  now: () => Date = () => new Date(),
): CouponApiResponse {
  const codes = runtimeSeed[domain];
  if (codes && codes.length > 0) {
    return {
      domain,
      candidateCodes: codes,
      source: "mock-backend",
      updatedAt: now().toISOString(),
    };
  }
  return {
    domain,
    candidateCodes: [],
    source: "none",
    updatedAt: now().toISOString(),
  };
}

export interface AdminCouponsBody {
  domain: string;
  candidateCodes: string[];
}

export type AdminBodyValidation =
  | { ok: true; domain: string; candidateCodes: string[] }
  | { ok: false; error: string };

export function validateAdminBody(body: unknown): AdminBodyValidation {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "body must be an object" };
  }
  const b = body as Record<string, unknown>;
  if (typeof b.domain !== "string" || b.domain.trim().length === 0) {
    return { ok: false, error: "domain must be a non-empty string" };
  }
  if (!Array.isArray(b.candidateCodes)) {
    return { ok: false, error: "candidateCodes must be an array" };
  }
  for (const code of b.candidateCodes) {
    if (typeof code !== "string" || code.trim().length === 0) {
      return {
        ok: false,
        error: "candidateCodes must contain only non-empty strings",
      };
    }
  }
  return {
    ok: true,
    domain: b.domain.trim(),
    candidateCodes: b.candidateCodes as string[],
  };
}

export function upsertCoupons(
  domain: string,
  codes: string[],
): { domain: string; candidateCodes: string[] } {
  const normalized = [...new Set(codes.map((c) => c.trim()))];
  runtimeSeed[domain] = normalized;
  persistFn();
  return { domain, candidateCodes: normalized };
}

export function deleteCoupons(
  domain: string,
): { deleted: boolean; domain: string } {
  const trimmed = domain.trim();
  if (!(trimmed in runtimeSeed)) {
    return { deleted: false, domain: trimmed };
  }
  delete runtimeSeed[trimmed];
  persistFn();
  return { deleted: true, domain: trimmed };
}

export type DomainParamValidation =
  | { ok: true; domain: string }
  | { ok: false; error: string };

export function validateDomainParam(
  raw: string | null | undefined,
): DomainParamValidation {
  if (typeof raw !== "string") {
    return { ok: false, error: "missing domain" };
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { ok: false, error: "missing domain" };
  }
  return { ok: true, domain: trimmed };
}

export function setPersistForTests(fn: () => void): void {
  persistFn = fn;
}

export function resetSeedForTests(): void {
  runtimeSeed = { ...BUNDLED_DEFAULT };
}
