// Generic provider-adapter contract (v0.45.0).
//
// Extracted from the structurally-identical Awin (v0.32) and Impact (v0.42)
// adapter shapes so preview/import routing can dispatch by providerId via the
// internal registry instead of hardcoding "awin". This file introduces NO
// runtime behavior — it is a type-only contract plus compile-time
// assignability assertions. The concrete adapters keep their literal
// `providerId`/`sourceId` types; they are merely proven assignable here.
//
// Widening notes (why the generic is a strict supertype of both concrete
// results):
//  - `cacheHit` is optional: Awin sets it (`boolean`), Impact omits it.
//  - `errorCode` is widened to `string`: each adapter has its own literal
//    union; both unions are subtypes of `string`.
//  - `providerId` / `sourceId` are widened to `string`: concrete adapters
//    use string-literal types which are assignable to `string`.
//
// No secret-bearing fields are added. The generic result carries the same
// allowlisted fields the v0.44 routes already read; redaction layers
// (adapter deny-fields, route allowlist, cache deny-keys) are unchanged.

import type { SourceFetchOutcome } from "./db-source-cache";
import type {
  SourceAdapterCandidate,
  SourceAdapterError,
} from "./source-adapters";
import type { Db } from "./db";
import type { AwinAdapter, AwinAdapterResult } from "./source-provider-awin";
import type {
  ImpactAdapter,
  ImpactAdapterResult,
} from "./source-provider-impact";

// Unified provider adapter error-code union (v0.47.0). Extracted from the
// pre-v0.47 Awin union (the strict superset of both adapters' codes) so the
// shared pipeline and both thin adapters speak one vocabulary. `cache_fresh`
// / `rate_limited` / `unknown_source` are forward-compat members the pipeline
// does not emit at runtime today; folding them in is a type-only widening
// with zero behavior change. `source-refresh.ts` keeps importing
// `AwinAdapterErrorCode` (now an alias of this) so its `SAFE_REASONS` set is
// unchanged.
export type ProviderAdapterErrorCode =
  | "disabled"
  | "missing_api_key"
  // v0.49.0 — Impact HTTP Basic needs an account SID alongside the auth
  // token. A type-only widening (same forward-compat pattern as
  // `rate_limited`/`cache_fresh`/`unknown_source`); zero runtime change for
  // Awin, and `source-refresh.ts` SAFE_REASONS is unaffected (Impact is not
  // wired into the refresh CLI).
  | "missing_account_sid"
  | "rate_limited"
  | "cache_fresh"
  | "unknown_source"
  | "http_4xx"
  | "http_5xx"
  | "fetch_error"
  | "timeout"
  | "parse_error"
  | "empty_response";

export interface ProviderFetcherResponse {
  status: number;
  body: string;
}

export type ProviderFetcher = (
  url: string,
  init: { headers: Record<string, string>; timeoutMs: number },
) => Promise<ProviderFetcherResponse>;

export interface ProviderAdapterClock {
  nowIso: () => string;
  nowMs: () => number;
}

export interface ProviderFetchInput {
  domain: string;
  cacheKey?: string;
}

export interface ProviderAdapterResult {
  ok: boolean;
  providerId: string;
  sourceId: string;
  outcome: SourceFetchOutcome;
  errorCode?: string;
  candidates: SourceAdapterCandidate[];
  errors: SourceAdapterError[];
  fetched: boolean;
  cacheHit?: boolean;
  durationMs: number;
}

export interface ProviderAdapter {
  readonly providerId: string;
  readonly sourceId: string;
  fetchAndParse(input: ProviderFetchInput): Promise<ProviderAdapterResult>;
}

/** Closure form used by the registry resolver + route dispatch. */
export type ProviderPreviewClosure = (
  input: ProviderFetchInput,
) => Promise<ProviderAdapterResult>;

/** Deps a provider needs to build a preview closure. */
export interface ProviderPreviewDeps {
  db?: Db;
  fetcher: ProviderFetcher;
  clock?: ProviderAdapterClock;
  /** Defaults to `process.env` at call time inside the descriptor. */
  env?: NodeJS.ProcessEnv;
}

// ---------------------------------------------------------------------------
// Compile-time assignability assertions. These never run; if either concrete
// adapter drifts out of the generic contract the build fails here.
// ---------------------------------------------------------------------------

type AssertAssignable<T, _U extends T> = true;

export type _AwinResultSatisfiesGeneric = AssertAssignable<
  ProviderAdapterResult,
  AwinAdapterResult
>;
export type _ImpactResultSatisfiesGeneric = AssertAssignable<
  ProviderAdapterResult,
  ImpactAdapterResult
>;
export type _AwinAdapterSatisfiesGeneric = AssertAssignable<
  ProviderAdapter,
  AwinAdapter
>;
export type _ImpactAdapterSatisfiesGeneric = AssertAssignable<
  ProviderAdapter,
  ImpactAdapter
>;
