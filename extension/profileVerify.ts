// Pure profile validation helpers used by `npm run profiles:verify` and unit
// tests. Inputs are profile arrays and (for fixture compatibility) a DOM
// factory; outputs are structured check/warning records that never echo
// selectors, candidate codes, fixture HTML, env vars, headers, cookies, DB
// paths, or tokens — only profile ids and check names with short safe details.

import type { StoreProfile } from "./storeProfiles";
import { scanCheckoutDom, type ScanContext } from "./checkoutScan";
import {
  deriveSupportReason,
  SUPPORT_REASON,
  type SupportReason,
} from "./profileDiagnostics";

export interface VerifyCheck {
  name: string;
  ok: boolean;
  detail?: string;
}

export interface VerifyWarning {
  name: string;
  detail: string;
}

export interface VerifyResult {
  ok: boolean;
  profileCount: number;
  checks: VerifyCheck[];
  warnings: VerifyWarning[];
}

const ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

const BROAD_SELECTORS = new Set(["*", "body", "html", "*,*", " * "]);

const FORBIDDEN_SUBSTRINGS = [
  "token",
  "secret",
  "password",
  "passwd",
  "cookie",
  "authorization",
  "bearer ",
  "localstorage",
  "sessionstorage",
  "process.env",
  "salvare_",
  ".db",
  "/server/",
  "/backups/",
  "/exports/",
];

const SELECTOR_KEYS: Array<keyof NonNullable<StoreProfile["selectors"]>> = [
  "couponInput",
  "applyButton",
  "subtotal",
  "total",
];

function check(
  name: string,
  ok: boolean,
  detail?: string,
): VerifyCheck {
  return detail === undefined ? { name, ok } : { name, ok, detail };
}

function warn(name: string, detail: string): VerifyWarning {
  return { name, detail };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function scanForForbiddenSubstrings(value: string): string | null {
  const lower = value.toLowerCase();
  for (const needle of FORBIDDEN_SUBSTRINGS) {
    if (lower.includes(needle)) return needle;
  }
  return null;
}

function selectorBroadnessWarning(selector: string): string | null {
  const trimmed = selector.trim();
  if (BROAD_SELECTORS.has(trimmed)) return trimmed;
  if (trimmed === "" ) return null;
  // A plain "*" amongst commas (e.g. "*, .total") still matches the universe.
  const parts = trimmed.split(",").map((p) => p.trim());
  if (parts.some((p) => p === "*" || p === "html" || p === "body")) {
    return parts.find((p) => p === "*" || p === "html" || p === "body")!;
  }
  return null;
}

function verifyOneProfile(
  profile: StoreProfile,
  index: number,
): { checks: VerifyCheck[]; warnings: VerifyWarning[] } {
  const checks: VerifyCheck[] = [];
  const warnings: VerifyWarning[] = [];
  const idLabel = isNonEmptyString(profile?.id)
    ? profile.id
    : `index_${index}`;

  // id presence + format
  if (!isNonEmptyString(profile?.id)) {
    checks.push(check(`profile[${idLabel}].id_present`, false, "missing"));
  } else {
    checks.push(check(`profile[${idLabel}].id_present`, true));
    checks.push(
      check(
        `profile[${idLabel}].id_format`,
        ID_PATTERN.test(profile.id),
        ID_PATTERN.test(profile.id) ? undefined : "invalid_format",
      ),
    );
  }

  // domain presence
  if (!isNonEmptyString(profile?.domain)) {
    checks.push(
      check(`profile[${idLabel}].domain_present`, false, "missing"),
    );
  } else {
    checks.push(check(`profile[${idLabel}].domain_present`, true));
  }

  // candidateCodes
  const codes = profile?.candidateCodes;
  if (!Array.isArray(codes) || codes.length === 0) {
    checks.push(
      check(`profile[${idLabel}].candidate_codes_present`, false, "empty"),
    );
  } else {
    checks.push(check(`profile[${idLabel}].candidate_codes_present`, true));
    const allNonEmpty = codes.every((c) => isNonEmptyString(c));
    checks.push(
      check(
        `profile[${idLabel}].candidate_codes_non_empty`,
        allNonEmpty,
        allNonEmpty ? undefined : "blank_entry",
      ),
    );
    const dedup = new Set(codes);
    if (dedup.size !== codes.length) {
      warnings.push(
        warn(
          `profile[${idLabel}].candidate_codes_duplicate`,
          "duplicate_entries",
        ),
      );
    }
  }

  // selectors
  if (profile?.selectors) {
    for (const key of SELECTOR_KEYS) {
      const sel = profile.selectors[key];
      if (sel === undefined) continue;
      if (!isNonEmptyString(sel)) {
        checks.push(
          check(
            `profile[${idLabel}].selector.${key}_non_empty`,
            false,
            "blank",
          ),
        );
        continue;
      }
      checks.push(
        check(`profile[${idLabel}].selector.${key}_non_empty`, true),
      );
      const broad = selectorBroadnessWarning(sel);
      if (broad) {
        warnings.push(
          warn(
            `profile[${idLabel}].selector.${key}_broad`,
            `broad_token`,
          ),
        );
      }
    }
  }

  // forbidden substrings — scan all string-valued fields except candidateCodes
  // entries (those are intentionally short tokens; scanning them risks false
  // positives for codes like "TOKEN10"). Field names and selector text are
  // the realistic places leaks would land.
  const scanTargets: string[] = [];
  if (typeof profile?.id === "string") scanTargets.push(profile.id);
  if (typeof profile?.domain === "string") scanTargets.push(profile.domain);
  if (profile?.selectors) {
    for (const key of SELECTOR_KEYS) {
      const value = profile.selectors[key];
      if (typeof value === "string") scanTargets.push(value);
    }
  }
  let hit: string | null = null;
  for (const target of scanTargets) {
    const found = scanForForbiddenSubstrings(target);
    if (found) {
      hit = found;
      break;
    }
  }
  checks.push(
    check(
      `profile[${idLabel}].no_forbidden_substrings`,
      hit === null,
      hit === null ? undefined : "forbidden_substring",
    ),
  );

  return { checks, warnings };
}

export function verifyProfiles(profiles: StoreProfile[]): VerifyResult {
  const checks: VerifyCheck[] = [];
  const warnings: VerifyWarning[] = [];

  if (!Array.isArray(profiles)) {
    return {
      ok: false,
      profileCount: 0,
      checks: [check("profiles_array", false, "not_an_array")],
      warnings: [],
    };
  }

  checks.push(
    check(
      "profiles_non_empty",
      profiles.length > 0,
      profiles.length > 0 ? undefined : "empty",
    ),
  );

  for (let i = 0; i < profiles.length; i++) {
    const result = verifyOneProfile(profiles[i], i);
    checks.push(...result.checks);
    warnings.push(...result.warnings);
  }

  // uniqueness checks across the set
  const idCounts = new Map<string, number>();
  const domainCounts = new Map<string, number>();
  for (const profile of profiles) {
    if (isNonEmptyString(profile?.id)) {
      idCounts.set(profile.id, (idCounts.get(profile.id) ?? 0) + 1);
    }
    if (isNonEmptyString(profile?.domain)) {
      domainCounts.set(
        profile.domain,
        (domainCounts.get(profile.domain) ?? 0) + 1,
      );
    }
  }
  const duplicateIds = [...idCounts.values()].some((n) => n > 1);
  checks.push(
    check(
      "ids_unique",
      !duplicateIds,
      duplicateIds ? "duplicate_id" : undefined,
    ),
  );
  const duplicateDomains = [...domainCounts.values()].some((n) => n > 1);
  checks.push(
    check(
      "domains_unique",
      !duplicateDomains,
      duplicateDomains ? "duplicate_domain" : undefined,
    ),
  );

  // localhost profile must exist and pass its own checks
  const localhost = profiles.find((p) => p?.domain === "localhost");
  checks.push(
    check(
      "localhost_profile_present",
      Boolean(localhost),
      localhost ? undefined : "missing",
    ),
  );
  if (localhost) {
    const localhostOk = isNonEmptyString(localhost.id)
      && Array.isArray(localhost.candidateCodes)
      && localhost.candidateCodes.length > 0
      && localhost.candidateCodes.every((c) => isNonEmptyString(c));
    checks.push(
      check(
        "localhost_profile_valid",
        localhostOk,
        localhostOk ? undefined : "invalid",
      ),
    );
  }

  const ok = checks.every((c) => c.ok);
  return { ok, profileCount: profiles.length, checks, warnings };
}

// ---------- fixture compatibility ----------

export interface FixtureExpectation {
  name: string;
  expected: SupportReason;
}

export const DEFAULT_FIXTURE_EXPECTATIONS: FixtureExpectation[] = [
  { name: "alt-coupon.html", expected: SUPPORT_REASON.Ready },
  { name: "alt-apply.html", expected: SUPPORT_REASON.Ready },
  { name: "missing-input.html", expected: SUPPORT_REASON.CouponInputMissing },
  { name: "missing-button.html", expected: SUPPORT_REASON.ApplyButtonMissing },
  { name: "missing-total.html", expected: SUPPORT_REASON.TotalMissing },
];

export interface FixtureSource {
  name: string;
  loadContext: () => ScanContext | null;
}

export interface FixtureVerifyResult {
  checks: VerifyCheck[];
  ok: boolean;
}

export function verifyFixtureCompatibility(
  sources: FixtureSource[],
  expectations: FixtureExpectation[] = DEFAULT_FIXTURE_EXPECTATIONS,
  candidateCodeCount = 1,
): FixtureVerifyResult {
  const checks: VerifyCheck[] = [];
  const sourceByName = new Map(sources.map((s) => [s.name, s]));

  for (const exp of expectations) {
    const source = sourceByName.get(exp.name);
    if (!source) {
      checks.push(
        check(`fixture[${exp.name}].present`, false, "missing"),
      );
      continue;
    }
    checks.push(check(`fixture[${exp.name}].present`, true));

    let context: ScanContext | null;
    try {
      context = source.loadContext();
    } catch {
      checks.push(
        check(`fixture[${exp.name}].loadable`, false, "load_error"),
      );
      continue;
    }
    if (!context) {
      checks.push(
        check(`fixture[${exp.name}].loadable`, false, "no_context"),
      );
      continue;
    }
    checks.push(check(`fixture[${exp.name}].loadable`, true));

    const scan = scanCheckoutDom(context);
    const reason = deriveSupportReason({
      profileMatched: true,
      candidateCodeCount,
      couponInputFound: scan.couponInputCount > 0,
      applyButtonFound: scan.applyButtonCount > 0,
      totalDetected: scan.totalText !== null,
    });
    const matched = reason === exp.expected;
    checks.push(
      check(
        `fixture[${exp.name}].reason_${exp.expected}`,
        matched,
        matched ? undefined : "unexpected_reason",
      ),
    );
  }

  const ok = checks.every((c) => c.ok);
  return { ok, checks };
}

// ---------- formatting ----------

export interface CombinedVerifyResult {
  profileCount: number;
  checks: VerifyCheck[];
  warnings: VerifyWarning[];
  ok: boolean;
}

export function combineResults(
  structural: VerifyResult,
  fixtures: FixtureVerifyResult,
): CombinedVerifyResult {
  const checks = [...structural.checks, ...fixtures.checks];
  const ok = checks.every((c) => c.ok);
  return {
    profileCount: structural.profileCount,
    checks,
    warnings: structural.warnings,
    ok,
  };
}

export function formatVerifyReport(result: CombinedVerifyResult): string {
  const lines: string[] = [];
  lines.push(`profiles checked: ${result.profileCount}`);
  let passCount = 0;
  let failCount = 0;
  for (const c of result.checks) {
    if (c.ok) passCount++;
    else failCount++;
    const detail = c.detail ? `  (${c.detail})` : "";
    lines.push(`  ${c.ok ? "PASS" : "FAIL"}  ${c.name}${detail}`);
  }
  lines.push(`checks: ${passCount} pass, ${failCount} fail`);
  lines.push(`warnings: ${result.warnings.length}`);
  for (const w of result.warnings) {
    lines.push(`  WARN  ${w.name}  (${w.detail})`);
  }
  lines.push(result.ok ? "result: OK" : "result: FAIL");
  return lines.join("\n");
}
