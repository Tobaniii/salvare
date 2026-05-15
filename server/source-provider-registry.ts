// Internal trusted-source provider registry (v0.43.0).
//
// Single source of truth for the local-only set of mocked, feature-flagged
// coupon source providers. The registry holds *internal* metadata + safe
// status accessors + provider-typed preview factories. It exposes NO admin
// HTTP route, NO CLI flag for multi-provider selection, NO public response
// shape, and NO admin UI provider selector — those are deferred to a later
// milestone. The registry exists so future milestones can flip capability
// gates (importSupported, cacheSupported, userExposed) without rewriting
// adapter dispatch.
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

export type ProviderId = "awin" | "impact";

export interface ProviderCapabilities {
  /** Adapter exposes a `fetchAndParse` preview surface. */
  readonly preview: boolean;
  /**
   * Provider is wired into the existing additive admin/CLI import path. When
   * `false`, the provider is registry-internal only (no admin URL, no CLI
   * support, no `coupon_code_sources` writes via the import helper).
   */
  readonly importSupported: boolean;
  /**
   * Adapter participates in the v0.33-style cache-read short-circuit. When
   * `false`, the adapter writes cache rows on success but does not read them
   * back to short-circuit subsequent fetches.
   */
  readonly cacheSupported: boolean;
}

export interface ProviderDescriptorMetadata {
  readonly providerId: ProviderId;
  readonly sourceId: ProviderId;
  readonly displayName: string;
  readonly sourceType: CouponSourceType;
  readonly capabilities: ProviderCapabilities;
  /**
   * True iff the provider is wired into the current admin UI / CLI surface
   * in this milestone. v0.43 keeps Awin user-exposed and Impact internal.
   */
  readonly userExposed: boolean;
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

export interface ProviderRegistry {
  /** Safe-to-serialize metadata-only listing for diagnostics and tests. */
  list(): ProviderDescriptorMetadata[];
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
  capabilities: { preview: true, importSupported: true, cacheSupported: true },
  userExposed: true,
} as const satisfies ProviderDescriptorMetadata;

const IMPACT_METADATA = {
  providerId: "impact",
  sourceId: "impact",
  displayName: "impact.com Promotions API",
  sourceType: "api",
  capabilities: { preview: true, importSupported: false, cacheSupported: false },
  userExposed: false,
} as const satisfies ProviderDescriptorMetadata;

function awinStatusFromConfig(config: SourceProviderConfig): ProviderStatusFlags {
  if (config.enabled) {
    return { featureEnabled: true, configured: true };
  }
  if (config.reason === "missing_api_key") {
    return { featureEnabled: true, configured: false };
  }
  return { featureEnabled: false, configured: false };
}

function impactStatusFromConfig(
  config: ImpactSourceProviderConfig,
): ProviderStatusFlags {
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
      return awinStatusFromConfig(readAwinConfig(env));
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
      return impactStatusFromConfig(readImpactConfig(env));
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
    capabilities: { ...descriptor.capabilities },
    userExposed: descriptor.userExposed,
  };
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
