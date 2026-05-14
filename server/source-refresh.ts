// Manual source-refresh runner (v0.39.0).
//
// Pure runner for the local source-refresh CLI. Validates args, reads
// provider config from an injected env, builds the mocked, feature-flagged
// Awin adapter, runs a preview (default) or a confirmed additive import,
// and returns an allowlisted result + exit code.
//
// Reuses `createAwinAdapter` (v0.32/v0.33), the admin redaction shape, and
// `importProviderCandidates` from v0.36. No new provider, no scraping, no
// extension behavior changes, no `/coupons` shape changes, no export/import
// JSON shape changes, no `coupon_results` writes, no destructive code
// replacement.
//
// Per docs/SOURCE_POLICY.md §6 and the redaction rules in
// docs/SOURCE_PROVIDER_RESEARCH.md §5, the output is built from an explicit
// allowlist: it never echoes the API key, the Authorization header, raw
// provider payloads, raw HTML, cookies, env vars, DB paths, stack traces,
// affiliate / tracking fields, or full secret-bearing URLs.
//
// The fetcher is injectable so tests run entirely against fixture strings
// with zero live HTTP. The CLI entrypoint wires a real fetcher only at
// runtime, and only when the v0.32 feature-flag/env gates are satisfied.

import type { Db } from "./db";
import { validateDomain } from "./source-adapters";
import { importProviderCandidates } from "./db-source-import";
import { readAwinConfig } from "./source-provider-config";
import {
  createAwinAdapter,
  type AwinAdapter,
  type AwinAdapterClock,
  type AwinAdapterErrorCode,
  type AwinAdapterResult,
  type AwinFetcher,
} from "./source-provider-awin";

const SUPPORTED_PROVIDERS = ["awin"] as const;
type SupportedProvider = (typeof SUPPORTED_PROVIDERS)[number];

const CONFIRMATION_PHRASE = "IMPORT";
const AWIN_SOURCE_ID = "awin";
const AWIN_SOURCE_NAME = "Awin";

const SAFE_REASONS: ReadonlySet<AwinAdapterErrorCode> = new Set<AwinAdapterErrorCode>([
  "disabled",
  "missing_api_key",
  "rate_limited",
  "cache_fresh",
  "unknown_source",
  "http_4xx",
  "http_5xx",
  "fetch_error",
  "timeout",
  "parse_error",
  "empty_response",
]);

export interface SourceRefreshArgs {
  provider: string;
  domain: string;
  import: boolean;
  confirm: string | null;
}

export type ParseArgsResult =
  | { ok: true; args: SourceRefreshArgs }
  | { ok: false; error: string };

export function parseSourceRefreshArgs(argv: readonly string[]): ParseArgsResult {
  let provider: string | null = null;
  let domain: string | null = null;
  let doImport = false;
  let confirm: string | null = null;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--provider" || arg === "--domain" || arg === "--confirm") {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        return { ok: false, error: `${arg} requires a value` };
      }
      if (arg === "--provider") provider = next;
      else if (arg === "--domain") domain = next;
      else confirm = next;
      i++;
    } else if (arg === "--import") {
      doImport = true;
    } else {
      return { ok: false, error: `unrecognized argument '${arg}'` };
    }
  }

  if (provider === null) return { ok: false, error: "--provider is required" };
  if (domain === null) return { ok: false, error: "--domain is required" };
  return {
    ok: true,
    args: { provider, domain, import: doImport, confirm },
  };
}

export interface SafeCandidate {
  sourceId: string;
  domain: string;
  code: string;
  label?: string;
  expiresAt?: string;
  sourceUrl?: string;
  confidence?: number;
}

export interface PreviewOutput {
  ok: true;
  mode: "preview";
  provider: SupportedProvider;
  domain: string;
  cacheHit: boolean;
  fetched: boolean;
  candidateCount: number;
  candidates: SafeCandidate[];
  errors: Array<{ index: number; reason: string }>;
}

export interface ImportOutput {
  ok: true;
  mode: "import";
  provider: SupportedProvider;
  domain: string;
  candidatesAccepted: number;
  codesImported: number;
  provenanceRecorded: number;
  rejected: number;
  errors: Array<{ index: number; reason: string }>;
}

export interface FailureOutput {
  ok: false;
  mode: "preview" | "import";
  provider?: string;
  domain?: string;
  reason: string;
  disabled?: true;
}

export type SourceRefreshOutput = PreviewOutput | ImportOutput | FailureOutput;

export interface SourceRefreshResult {
  exitCode: 0 | 1;
  output: SourceRefreshOutput;
}

export interface SourceRefreshDeps {
  db: Db;
  env: NodeJS.ProcessEnv;
  fetcher: AwinFetcher;
  clock?: AwinAdapterClock;
  buildAdapter?: (
    fetcher: AwinFetcher,
    config: ReturnType<typeof readAwinConfig>,
    db: Db,
    clock: AwinAdapterClock | undefined,
  ) => AwinAdapter;
}

function isSupportedProvider(value: string): value is SupportedProvider {
  return (SUPPORTED_PROVIDERS as readonly string[]).includes(value);
}

function safeReason(code: AwinAdapterErrorCode | undefined): string {
  if (code !== undefined && SAFE_REASONS.has(code)) return code;
  return "unknown_error";
}

function buildSafeCandidates(result: AwinAdapterResult): SafeCandidate[] {
  return result.candidates.map((c) => {
    const out: SafeCandidate = {
      sourceId: c.sourceId,
      domain: c.domain,
      code: c.code,
    };
    if (c.label !== undefined) out.label = c.label;
    if (c.expiresAt !== undefined) out.expiresAt = c.expiresAt;
    if (c.sourceUrl !== undefined) out.sourceUrl = c.sourceUrl;
    if (c.confidence !== undefined) out.confidence = c.confidence;
    return out;
  });
}

export async function runSourceRefresh(
  args: SourceRefreshArgs,
  deps: SourceRefreshDeps,
): Promise<SourceRefreshResult> {
  const mode: "preview" | "import" = args.import ? "import" : "preview";

  if (!isSupportedProvider(args.provider)) {
    return {
      exitCode: 1,
      output: { ok: false, mode, reason: "unknown_provider" },
    };
  }

  const domain = validateDomain(args.domain);
  if (domain === null) {
    return {
      exitCode: 1,
      output: { ok: false, mode, provider: args.provider, reason: "invalid_domain" },
    };
  }

  if (args.import && args.confirm !== CONFIRMATION_PHRASE) {
    return {
      exitCode: 1,
      output: {
        ok: false,
        mode,
        provider: args.provider,
        domain,
        reason: "confirmation_required",
      },
    };
  }

  const config = readAwinConfig(deps.env);
  if (!config.enabled) {
    return {
      exitCode: 1,
      output: {
        ok: false,
        mode,
        provider: args.provider,
        domain,
        reason: config.reason,
        disabled: true,
      },
    };
  }

  const adapter = (deps.buildAdapter ?? defaultBuildAdapter)(
    deps.fetcher,
    config,
    deps.db,
    deps.clock,
  );

  let result: AwinAdapterResult;
  try {
    result = await adapter.fetchAndParse({ domain });
  } catch {
    return {
      exitCode: 1,
      output: {
        ok: false,
        mode,
        provider: args.provider,
        domain,
        reason: "fetch_error",
      },
    };
  }

  if (!result.ok) {
    const reason = safeReason(result.errorCode);
    const out: FailureOutput = {
      ok: false,
      mode,
      provider: args.provider,
      domain,
      reason,
    };
    if (reason === "disabled" || reason === "missing_api_key") {
      out.disabled = true;
    }
    return { exitCode: 1, output: out };
  }

  const safeErrors = result.errors.map((e) => ({
    index: e.index,
    reason: e.reason,
  }));

  if (!args.import) {
    return {
      exitCode: 0,
      output: {
        ok: true,
        mode: "preview",
        provider: "awin",
        domain,
        cacheHit: result.cacheHit,
        fetched: result.fetched,
        candidateCount: result.candidates.length,
        candidates: buildSafeCandidates(result),
        errors: safeErrors,
      },
    };
  }

  let rejected = 0;
  const accepted = result.candidates.flatMap((c) => {
    if (c.sourceId !== AWIN_SOURCE_ID || c.domain !== domain) {
      rejected += 1;
      return [];
    }
    return [
      {
        domain: c.domain,
        code: c.code,
        label: c.label,
        expiresAt: c.expiresAt,
      },
    ];
  });

  let stats;
  try {
    stats = importProviderCandidates(deps.db, {
      sourceId: AWIN_SOURCE_ID,
      sourceName: AWIN_SOURCE_NAME,
      sourceType: "api",
      domain,
      candidates: accepted,
    });
  } catch {
    return {
      exitCode: 1,
      output: {
        ok: false,
        mode: "import",
        provider: args.provider,
        domain,
        reason: "import_failed",
      },
    };
  }

  return {
    exitCode: 0,
    output: {
      ok: true,
      mode: "import",
      provider: "awin",
      domain,
      candidatesAccepted: stats.candidatesAccepted,
      codesImported: stats.codesImported,
      provenanceRecorded: stats.provenanceRecorded,
      rejected,
      errors: safeErrors,
    },
  };
}

function defaultBuildAdapter(
  fetcher: AwinFetcher,
  config: ReturnType<typeof readAwinConfig>,
  db: Db,
  clock: AwinAdapterClock | undefined,
): AwinAdapter {
  if (!config.enabled) {
    throw new Error("buildAdapter called with disabled config");
  }
  return createAwinAdapter({ config, fetcher, db, clock });
}
