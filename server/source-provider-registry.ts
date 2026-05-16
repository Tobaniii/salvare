// Internal trusted-source provider registry (v0.43.0).
//
// Single source of truth for the local-only set of mocked, feature-flagged
// coupon source providers. The registry holds *internal* metadata + safe
// status accessors + provider-typed preview factories. It exposes NO admin
// HTTP route, NO CLI flag for multi-provider selection, NO public response
// shape, and NO admin UI provider selector — those are deferred to a later
// milestone. The registry exists so future milestones can flip the unified
// `ProviderActivation` gates (enabled, previewEnabled, importEnabled,
// userExposed, cacheSupported, schedulerSupported) without rewriting
// adapter dispatch. Activation flags are compile-time constants — there is
// NO env/DB/runtime toggling; exposing a provider later = flip the constant
// and ship.
//
// Registered in v0.43.0:
//  - awin    (v0.32 spike + v0.33 cache short-circuit + v0.34/v0.36 admin
//             preview/import + v0.39 source-refresh CLI + v0.40 status)
//  - impact  (v0.42 second mocked spike — adapter + fixtures only; NOT
//             wired into admin preview/import, source-refresh CLI, or any
//             admin UI selector in v0.43)
//
// Per docs/SOURCE_POLICY.md §§4–6 and the redaction rules in
// docs/SOURCE_PROVIDER_RESEARCH.md §5:
//  - registry metadata is static strings + capability booleans only;
//  - status accessors return `{ featureEnabled, configured }` booleans
//    derived from the existing safe config readers; the api key, the
//    account SID, env values, the DB path, raw payloads, raw HTML,
//    affiliate/tracking/payout fields, and stack traces never appear in
//    any registry-exported surface;
//  - `list()` returns *metadata only* (no closures, no config readers, no
//    preview factories) so it is safe to `JSON.stringify` for diagnostics
//    or tests;
//  - unknown provider ids fail closed via `get()` → `null` and
//    `statusFor()` → `{ false, false }`.

import type { Db } from "./db";
import type { CouponSourceType } from "./db";
import type { ProviderStatusFn, SourceStatusProviderInfo } from "./db-source-status";
import {
  readAwinConfig,
  readImpactConfig,
  type AwinProviderConfig,
  type ImpactProviderConfig,
  type ImpactSourceProviderConfig,
  type SourceProviderConfig,
} from "./source-provider-config";
import {
  createAwinAdapter,
  type AwinAdapterClock,
  type AwinAdapterResult,
  type AwinFetcher,
  type AwinFetchInput,
} from "./source-provider-awin";
import {
  createImpactAdapter,
  type ImpactAdapterClock,
  type ImpactAdapterResult,
  type ImpactFetcher,
  type ImpactFetchInput,
} from "./source-provider-impact";
import type {
  ProviderPreviewClosure,
  ProviderPreviewDeps,
} from "./source-provider-types";

export type ProviderId = "awin" | "impact";

export interface ProviderActivation {
  /**
   * Master gate. When not exactly `true`, `resolveProvider` denies with
   * `provider_disabled` *before* the userExposed/capability checks. Both
   * registered providers ship `true`; the disabled path is exercised only
   * by test-doubles / future use (the framework mechanism, not a switch
   * being flipped in this milestone).
   */
  readonly enabled: boolean;
  /** Adapter exposes a `fetchAndParse` preview surface. */
  readonly previewEnabled: boolean;
  /**
   * Provider is wired into the existing additive admin/CLI import path. When
   * `false`, the provider is registry-internal only (no admin URL, no CLI
   * support, no `coupon_code_sources` writes via the import helper).
   */
  readonly importEnabled: boolean;
  /**
   * True iff the provider is wired into the current admin UI / CLI surface.
   * The gate for `/admin/source-providers` — never echoed as a field in
   * that projection. v0.48 keeps Awin user-exposed and Impact internal.
   */
  readonly userExposed: boolean;
  /**
   * Adapter participates in the v0.33-style cache-read short-circuit. When
   * `false`, the adapter writes cache rows on success but does not read them
   * back to short-circuit subsequent fetches.
   */
  readonly cacheSupported: boolean;
  /**
   * Declared-only metadata for a future scheduler milestone (v0.52). NO
   * consumer and NO enforcement in v0.48 — pure registry metadata. Both
   * registered providers ship `false`.
   */
  readonly schedulerSupported: boolean;
}

export interface ProviderDescriptorMetadata {
  readonly providerId: ProviderId;
  readonly sourceId: ProviderId;
  readonly displayName: string;
  readonly sourceType: CouponSourceType;
  readonly activation: ProviderActivation;
}

export type ProviderStatusFlags = SourceStatusProviderInfo;

export type AwinPreviewClosure = (
  input: AwinFetchInput,
) => Promise<AwinAdapterResult>;

export type ImpactPreviewClosure = (
  input: ImpactFetchInput,
) => Promise<ImpactAdapterResult>;

export interface AwinPreviewDeps {
  db?: Db;
  fetcher: AwinFetcher;
  clock?: AwinAdapterClock;
  /** Defaults to `process.env` at call time. */
  env?: NodeJS.ProcessEnv;
}

export interface ImpactPreviewDeps {
  db?: Db;
  fetcher: ImpactFetcher;
  clock?: ImpactAdapterClock;
  /** Defaults to `process.env` at call time. */
  env?: NodeJS.ProcessEnv;
}

export interface AwinProviderDescriptor extends ProviderDescriptorMetadata {
  readonly providerId: "awin";
  readonly sourceId: "awin";
  readConfig(env?: NodeJS.ProcessEnv): SourceProviderConfig;
  statusFor(env?: NodeJS.ProcessEnv): ProviderStatusFlags;
  createPreview(deps: AwinPreviewDeps): AwinPreviewClosure;
}

export interface ImpactProviderDescriptor extends ProviderDescriptorMetadata {
  readonly providerId: "impact";
  readonly sourceId: "impact";
  readConfig(env?: NodeJS.ProcessEnv): ImpactSourceProviderConfig;
  statusFor(env?: NodeJS.ProcessEnv): ProviderStatusFlags;
  createPreview(deps: ImpactPreviewDeps): ImpactPreviewClosure;
}

export type AnyProviderDescriptor =
  | AwinProviderDescriptor
  | ImpactProviderDescriptor;

export type ResolvePurpose = "preview" | "import";

export type ResolveDenyReason =
  | "unknown_provider"
  | "provider_disabled"
  | "not_user_exposed"
  | "capability_unsupported";

export type ResolveProviderResult =
  | {
      ok: true;
      descriptor: ProviderDescriptorMetadata;
      closure: ProviderPreviewClosure;
    }
  | { ok: false; reason: ResolveDenyReason };

export interface ProviderRegistry {
  /** Safe-to-serialize metadata-only listing for diagnostics and tests. */
  list(): ProviderDescriptorMetadata[];
  /**
   * Resolve a provider for a user-exposed preview/import call. Fail-closed
   * (never throws raw) via `classifyActivation`: unknown id ->
   * `unknown_provider`; `activation.enabled !== true` -> `provider_disabled`;
   * `activation.userExposed !== true` -> `not_user_exposed`; a provider that
   * lacks the capability for `purpose` -> `capability_unsupported`. On
   * success returns the registry-authoritative metadata descriptor plus a
   * generic preview closure. Impact (`userExposed:false`) is denied for
   * BOTH purposes, so generic routing cannot reach it via the user surface.
   */
  resolveProvider(
    providerId: string,
    purpose: ResolvePurpose,
    deps: ProviderPreviewDeps,
  ): ResolveProviderResult;
  /** Typed lookup. Unknown ids return `null` (fail closed). */
  get(providerId: string): AnyProviderDescriptor | null;
  /** Typed awin accessor. */
  getAwin(): AwinProviderDescriptor;
  /** Typed impact accessor. */
  getImpact(): ImpactProviderDescriptor;
  /**
   * Aggregated provider status by coupon-source row id. Returns `{ false,
   * false }` for unknown / non-provider source ids (e.g., `seed`, `admin`,
   * `import`).
   */
  statusFor(
    sourceId: string,
    env?: NodeJS.ProcessEnv,
  ): ProviderStatusFlags;
  /** Bound `ProviderStatusFn` for direct wiring into `getSourceStatusSummary`. */
  asProviderStatusFn(env?: NodeJS.ProcessEnv): ProviderStatusFn;
}

const AWIN_METADATA = {
  providerId: "awin",
  sourceId: "awin",
  displayName: "Awin Offers API",
  sourceType: "api",
  activation: {
    enabled: true,
    previewEnabled: true,
    importEnabled: true,
    userExposed: true,
    cacheSupported: true,
    schedulerSupported: false,
  },
} as const satisfies ProviderDescriptorMetadata;

const IMPACT_METADATA = {
  providerId: "impact",
  sourceId: "impact",
  displayName: "impact.com Promotions API",
  sourceType: "api",
  // v0.48.0 — Impact participates in the shared cache-read short-circuit
  // (internal capability only). `importEnabled`/`userExposed` stay false:
  // Impact remains unreachable on the user surface (v0.49). `enabled` is
  // true — Impact is not switched off; `enabled:false` is the framework
  // mechanism, exercised only by test-doubles.
  activation: {
    enabled: true,
    previewEnabled: true,
    importEnabled: false,
    userExposed: false,
    cacheSupported: true,
    schedulerSupported: false,
  },
} as const satisfies ProviderDescriptorMetadata;

// v0.47.0 — both providers derive status identically
// (enabled → (true,true); missing_api_key → (true,false); otherwise
// (false,false)). One shared helper; no status-route behavior change.
function providerStatusFromConfig(config: {
  enabled: boolean;
  reason?: string;
}): ProviderStatusFlags {
  if (config.enabled) {
    return { featureEnabled: true, configured: true };
  }
  if (config.reason === "missing_api_key") {
    return { featureEnabled: true, configured: false };
  }
  return { featureEnabled: false, configured: false };
}

function buildAwinDescriptor(): AwinProviderDescriptor {
  return {
    ...AWIN_METADATA,
    readConfig(env: NodeJS.ProcessEnv = process.env): SourceProviderConfig {
      return readAwinConfig(env);
    },
    statusFor(env: NodeJS.ProcessEnv = process.env): ProviderStatusFlags {
      return providerStatusFromConfig(readAwinConfig(env));
    },
    createPreview(deps: AwinPreviewDeps): AwinPreviewClosure {
      return (input: AwinFetchInput) => {
        const config = readAwinConfig(deps.env ?? process.env);
        // The adapter validates `config.enabled` and `config.apiKey` at call
        // time and returns a disabled-shaped result without invoking the
        // fetcher when either gate fails. The cast widens the union to the
        // enabled shape the options type expects.
        const adapter = createAwinAdapter({
          config: config as AwinProviderConfig,
          fetcher: deps.fetcher,
          db: deps.db,
          clock: deps.clock,
        });
        return adapter.fetchAndParse(input);
      };
    },
  };
}

function buildImpactDescriptor(): ImpactProviderDescriptor {
  return {
    ...IMPACT_METADATA,
    readConfig(env: NodeJS.ProcessEnv = process.env): ImpactSourceProviderConfig {
      return readImpactConfig(env);
    },
    statusFor(env: NodeJS.ProcessEnv = process.env): ProviderStatusFlags {
      return providerStatusFromConfig(readImpactConfig(env));
    },
    createPreview(deps: ImpactPreviewDeps): ImpactPreviewClosure {
      return (input: ImpactFetchInput) => {
        const config = readImpactConfig(deps.env ?? process.env);
        const adapter = createImpactAdapter({
          config: config as ImpactProviderConfig,
          fetcher: deps.fetcher,
          db: deps.db,
          clock: deps.clock,
        });
        return adapter.fetchAndParse(input);
      };
    },
  };
}

function metadataOnly(
  descriptor: AnyProviderDescriptor,
): ProviderDescriptorMetadata {
  return {
    providerId: descriptor.providerId,
    sourceId: descriptor.sourceId,
    displayName: descriptor.displayName,
    sourceType: descriptor.sourceType,
    activation: { ...descriptor.activation },
  };
}

/**
 * Pure activation precedence. `null` activation === unknown provider. Fail
 * closed (strict `!== true` / `=== true`, so missing/undefined denies).
 * Precedence: `unknown_provider` > `provider_disabled` > `not_user_exposed`
 * > `capability_unsupported`. Extracted from `resolveProvider` so the full
 * enabled×userExposed×previewEnabled×importEnabled matrix is testable
 * without the hardcoded awin/impact dispatch. Behavior-preserving.
 */
export function classifyActivation(
  activation: ProviderActivation | null,
  purpose: ResolvePurpose,
): ResolveDenyReason | "ok" {
  if (activation === null) return "unknown_provider";
  if (activation.enabled !== true) return "provider_disabled";
  if (activation.userExposed !== true) return "not_user_exposed";
  const capable =
    purpose === "preview"
      ? activation.previewEnabled === true
      : activation.importEnabled === true;
  if (!capable) return "capability_unsupported";
  return "ok";
}

export function createProviderRegistry(): ProviderRegistry {
  const awin = buildAwinDescriptor();
  const impact = buildImpactDescriptor();
  const byId: Record<ProviderId, AnyProviderDescriptor> = {
    awin,
    impact,
  };

  const registry: ProviderRegistry = {
    list(): ProviderDescriptorMetadata[] {
      return [metadataOnly(awin), metadataOnly(impact)];
    },
    resolveProvider(
      providerId: string,
      purpose: ResolvePurpose,
      deps: ProviderPreviewDeps,
    ): ResolveProviderResult {
      const descriptor =
        providerId === "awin"
          ? awin
          : providerId === "impact"
            ? impact
            : null;
      if (descriptor === null) {
        return { ok: false, reason: "unknown_provider" };
      }
      const verdict = classifyActivation(descriptor.activation, purpose);
      if (verdict !== "ok") {
        return { ok: false, reason: verdict };
      }
      // Per-known-provider closure construction. The generic deps shape is
      // structurally identical to each descriptor's typed deps (the fetcher
      // signatures match); the cast only re-narrows the union.
      const closure: ProviderPreviewClosure =
        descriptor.providerId === "awin"
          ? (awin.createPreview(deps as AwinPreviewDeps) as ProviderPreviewClosure)
          : (impact.createPreview(
              deps as ImpactPreviewDeps,
            ) as ProviderPreviewClosure);
      return {
        ok: true,
        descriptor: metadataOnly(descriptor),
        closure,
      };
    },
    get(providerId: string): AnyProviderDescriptor | null {
      if (providerId === "awin" || providerId === "impact") {
        return byId[providerId];
      }
      return null;
    },
    getAwin(): AwinProviderDescriptor {
      return awin;
    },
    getImpact(): ImpactProviderDescriptor {
      return impact;
    },
    statusFor(
      sourceId: string,
      env: NodeJS.ProcessEnv = process.env,
    ): ProviderStatusFlags {
      if (sourceId === "awin") return awin.statusFor(env);
      if (sourceId === "impact") return impact.statusFor(env);
      return { featureEnabled: false, configured: false };
    },
    asProviderStatusFn(
      env: NodeJS.ProcessEnv = process.env,
    ): ProviderStatusFn {
      return (sourceId: string) => registry.statusFor(sourceId, env);
    },
  };

  return registry;
}

/** Stable list of registered provider ids — useful for CLI/test assertions. */
export const REGISTERED_PROVIDER_IDS: readonly ProviderId[] = [
  "awin",
  "impact",
] as const;
