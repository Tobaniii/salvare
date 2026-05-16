// Shared provider fetch/preview pipeline (v0.47.0).
//
// Single execution layer both the Awin (v0.32/v0.33) and Impact (v0.42)
// adapters delegate to. Extracted verbatim from the pre-v0.47 Awin adapter
// (the live, user-exposed one) so its observable behavior — candidate
// order, per-row error sequence, fetch-log call sites/counts, cache-write
// signature, cache-read short-circuit semantics, early-return durations —
// is byte-identical. The ONLY divergence between providers is supplied via
// the injected `ProviderPipelineSpec` (config gate values, URL shaping,
// response-envelope key, per-row deny/normalize logic). Per-provider
// deny-field redaction stays inside `spec.mapRow`; this module never
// echoes the api key, auth header, raw payload, raw HTML, env values, the
// DB path, stack traces, or affiliate/tracking fields.
//
// Cache-read short-circuit fires ONLY when `spec.cacheSupported` is true.
// The cache is treated as untrusted input on read even though we own the
// writer: every cached row is strictly re-validated and any failure falls
// through to a fresh fetch.

import type { Db, CouponSourceType } from "./db";
import { ensureCouponSource } from "./db-sources";
import {
  getSourceCacheEntry,
  recordSourceFetchAttempt,
  upsertSourceCacheEntry,
  type SourceFetchOutcome,
} from "./db-source-cache";
import {
  buildCandidate,
  pickAllowedRow,
  validateConfidence,
  validateDomain,
  validateExpiresAt,
  validateLabel,
  validateSourceUrl,
  validateCode,
  type RawRow,
  type SourceAdapterCandidate,
  type SourceAdapterError,
  type SourceAdapterErrorReason,
} from "./source-adapters";
import type {
  ProviderAdapterClock,
  ProviderAdapterErrorCode,
  ProviderAdapterResult,
  ProviderFetchInput,
  ProviderFetcher,
} from "./source-provider-types";

export type RowMap =
  | { kind: "skip" }
  | { kind: "error"; reason: SourceAdapterErrorReason }
  | { kind: "row"; row: RawRow };

export interface ProviderPipelineSpec {
  readonly providerId: string;
  readonly sourceId: string;
  readonly sourceName: string;
  readonly sourceType: CouponSourceType;
  /** Gates the v0.33-style cache-read short-circuit. */
  readonly cacheSupported: boolean;
  /** Already-read provider config. Only `enabled`/`apiKey` are read here. */
  readonly config: { enabled?: unknown; apiKey?: unknown };
  /** Provider-specific endpoint/baseUrl + request shaping. */
  buildUrl(domain: string): string;
  /**
   * Provider-specific `Authorization` header value built from
   * already-read config credentials. Omit for the default
   * `Bearer ${apiKey}` (Awin parity — byte-identical when absent). Impact
   * supplies HTTP Basic `base64(accountSid:authToken)`. Never built from
   * client input; the credential never reaches the result/log/cache.
   */
  buildAuthHeader?(apiKey: string): string;
  /**
   * Provider-specific credential preflight, run immediately after the
   * shared `apiKey` non-empty check and BEFORE domain validation, the
   * cache-read short-circuit, and any fetch. A non-null code yields the
   * same fail-closed early-return shape as `missing_api_key`
   * (`fetched:false`, no cache read, `durationMs:0`). Omit when there is
   * no extra credential to gate (Awin). Impact uses it to fail closed on a
   * blank account SID even if a config object was constructed directly,
   * bypassing `readImpactConfig`.
   */
  preflight?(): ProviderAdapterErrorCode | null;
  /** Provider-specific response envelope key (Awin offers vs Impact Promotions). */
  extractEnvelope(parsed: unknown): unknown[] | null;
  /**
   * Provider-specific per-row handling: deny-field strip + promo-type
   * filter + domain extraction. Returns the pre-`pickAllowedRow` `RawRow`,
   * or a silent skip, or a redacted per-row error.
   */
  mapRow(value: unknown): RowMap;
}

export interface ProviderPipelineDeps {
  db?: Db;
  fetcher: ProviderFetcher;
  clock?: ProviderAdapterClock;
  timeoutMs: number;
  cacheTtlMs: number;
}

function defaultClock(): ProviderAdapterClock {
  return {
    nowIso: () => new Date().toISOString(),
    nowMs: () => Date.now(),
  };
}

function makeCacheKey(domain: string, custom?: string): string {
  if (custom !== undefined && custom.length > 0) return custom;
  return `merchant:${domain}`;
}

async function sha256Hex(input: string): Promise<string> {
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(input, "utf8").digest("hex");
}

function mapHttpStatus(status: number): ProviderAdapterErrorCode | null {
  if (status >= 200 && status < 300) return null;
  if (status >= 400 && status < 500) return "http_4xx";
  return "http_5xx";
}

function disabledResult(
  spec: ProviderPipelineSpec,
  errorCode: ProviderAdapterErrorCode,
  durationMs: number,
): ProviderAdapterResult {
  return {
    ok: false,
    providerId: spec.providerId,
    sourceId: spec.sourceId,
    outcome: "error",
    errorCode,
    candidates: [],
    errors: [],
    fetched: false,
    cacheHit: false,
    durationMs,
  };
}

// Strict re-validation of a single cached candidate row. The cache is
// intentionally treated as untrusted on read — even though our writers only
// persist normalized candidates, on-disk state may have been corrupted or
// edited locally. Any failure causes the caller to ignore the cache and
// fall through to a fresh fetch.
function revalidateCachedCandidate(
  raw: unknown,
  sourceId: string,
  seen: Set<string>,
): SourceAdapterCandidate | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  if (obj.sourceId !== sourceId) return null;
  const domain = validateDomain(obj.domain);
  if (domain === null) return null;
  const code = validateCode(obj.code);
  if (code === null) return null;
  if (typeof obj.discoveredAt !== "string" || obj.discoveredAt.length === 0) {
    return null;
  }
  const label = validateLabel(obj.label);
  if (!label.ok) return null;
  const expiresAt = validateExpiresAt(obj.expiresAt);
  if (!expiresAt.ok) return null;
  const sourceUrl = validateSourceUrl(obj.sourceUrl);
  if (!sourceUrl.ok) return null;
  const confidence = validateConfidence(obj.confidence);
  if (!confidence.ok) return null;
  const dedupeKey = `${sourceId}|${domain}|${code}`;
  if (seen.has(dedupeKey)) return null;
  seen.add(dedupeKey);
  const out: SourceAdapterCandidate = {
    domain,
    code,
    sourceId,
    discoveredAt: obj.discoveredAt,
  };
  if (label.value !== undefined) out.label = label.value;
  if (expiresAt.value !== undefined) out.expiresAt = expiresAt.value;
  if (sourceUrl.value !== undefined) out.sourceUrl = sourceUrl.value;
  if (confidence.value !== undefined) out.confidence = confidence.value;
  return out;
}

function parseCachedCandidates(
  candidatesJson: string | null,
  sourceId: string,
): SourceAdapterCandidate[] | null {
  if (candidatesJson === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidatesJson);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  const seen = new Set<string>();
  const out: SourceAdapterCandidate[] = [];
  for (const row of parsed) {
    const c = revalidateCachedCandidate(row, sourceId, seen);
    if (c === null) return null;
    out.push(c);
  }
  return out;
}

export async function runProviderPipeline(
  spec: ProviderPipelineSpec,
  deps: ProviderPipelineDeps,
  input: ProviderFetchInput,
): Promise<ProviderAdapterResult> {
  const clock = deps.clock ?? defaultClock();
  const startedMs = clock.nowMs();

  if (spec.config.enabled !== true) {
    return disabledResult(spec, "disabled", 0);
  }
  const apiKey = spec.config.apiKey;
  if (typeof apiKey !== "string" || apiKey.length === 0) {
    return disabledResult(spec, "missing_api_key", 0);
  }
  if (spec.preflight) {
    const preflightCode = spec.preflight();
    if (preflightCode !== null) {
      return disabledResult(spec, preflightCode, 0);
    }
  }

  const domain = validateDomain(input.domain);
  if (!domain) {
    return disabledResult(spec, "parse_error", 0);
  }
  const cacheKey = makeCacheKey(domain, input.cacheKey);

  if (deps.db) {
    try {
      ensureCouponSource(
        deps.db,
        {
          id: spec.sourceId,
          name: spec.sourceName,
          type: spec.sourceType,
          enabled: true,
        },
        clock.nowIso(),
      );
    } catch {
      /* swallow — registration failure must not throw the adapter */
    }
  }

  // Cache-read short-circuit (v0.33.0 for Awin; v0.47.0 parity for Impact).
  // A fresh `ok`-status cache row with a parseable, re-validatable
  // candidate array is returned without invoking the fetcher. Any failure
  // here — missing column, expired entry, corrupt JSON, row-level
  // revalidation failure — falls through to a fresh fetch. Fires only when
  // the provider advertises `cacheSupported`.
  if (spec.cacheSupported && deps.db) {
    try {
      const lookup = getSourceCacheEntry(
        deps.db,
        spec.sourceId,
        cacheKey,
        clock.nowIso(),
      );
      if (
        lookup &&
        lookup.fresh &&
        lookup.entry.status === "ok" &&
        lookup.entry.candidatesJson !== null
      ) {
        const cached = parseCachedCandidates(
          lookup.entry.candidatesJson,
          spec.sourceId,
        );
        if (cached !== null) {
          const durationMs = clock.nowMs() - startedMs;
          try {
            recordSourceFetchAttempt(
              deps.db,
              {
                sourceId: spec.sourceId,
                cacheKey,
                outcome: "cache_hit",
                statusCode: null,
                errorCode: null,
                durationMs,
              },
              clock.nowIso(),
            );
          } catch {
            /* swallow */
          }
          return {
            ok: true,
            providerId: spec.providerId,
            sourceId: spec.sourceId,
            outcome: "cache_hit",
            candidates: cached,
            errors: [],
            fetched: false,
            cacheHit: true,
            durationMs,
          };
        }
      }
    } catch {
      /* corrupt cache or schema mismatch — fall through to fetch */
    }
  }

  const url = spec.buildUrl(domain);
  const headers: Record<string, string> = {
    Authorization: spec.buildAuthHeader
      ? spec.buildAuthHeader(apiKey)
      : `Bearer ${apiKey}`,
    Accept: "application/json",
  };

  let response: { status: number; body: string };
  try {
    response = await deps.fetcher(url, { headers, timeoutMs: deps.timeoutMs });
  } catch (err) {
    const errorCode: ProviderAdapterErrorCode =
      err && typeof err === "object" && (err as { name?: string }).name === "AbortError"
        ? "timeout"
        : "fetch_error";
    const durationMs = clock.nowMs() - startedMs;
    if (deps.db) {
      try {
        recordSourceFetchAttempt(
          deps.db,
          {
            sourceId: spec.sourceId,
            cacheKey,
            outcome: "error",
            statusCode: null,
            errorCode,
            durationMs,
          },
          clock.nowIso(),
        );
      } catch {
        /* swallow — adapter must not throw on log failure */
      }
    }
    return {
      ok: false,
      providerId: spec.providerId,
      sourceId: spec.sourceId,
      outcome: "error",
      errorCode,
      candidates: [],
      errors: [],
      fetched: true,
      cacheHit: false,
      durationMs,
    };
  }

  const httpErr = mapHttpStatus(response.status);
  if (httpErr !== null) {
    const durationMs = clock.nowMs() - startedMs;
    if (deps.db) {
      try {
        recordSourceFetchAttempt(
          deps.db,
          {
            sourceId: spec.sourceId,
            cacheKey,
            outcome: "error",
            statusCode: response.status,
            errorCode: httpErr,
            durationMs,
          },
          clock.nowIso(),
        );
      } catch {
        /* swallow */
      }
    }
    return {
      ok: false,
      providerId: spec.providerId,
      sourceId: spec.sourceId,
      outcome: "error",
      errorCode: httpErr,
      candidates: [],
      errors: [],
      fetched: true,
      cacheHit: false,
      durationMs,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(response.body);
  } catch {
    const durationMs = clock.nowMs() - startedMs;
    if (deps.db) {
      try {
        recordSourceFetchAttempt(
          deps.db,
          {
            sourceId: spec.sourceId,
            cacheKey,
            outcome: "error",
            statusCode: response.status,
            errorCode: "parse_error",
            durationMs,
          },
          clock.nowIso(),
        );
      } catch {
        /* swallow */
      }
    }
    return {
      ok: false,
      providerId: spec.providerId,
      sourceId: spec.sourceId,
      outcome: "error",
      errorCode: "parse_error",
      candidates: [],
      errors: [],
      fetched: true,
      cacheHit: false,
      durationMs,
    };
  }

  const envelope = spec.extractEnvelope(parsed);
  if (envelope === null) {
    const durationMs = clock.nowMs() - startedMs;
    if (deps.db) {
      try {
        recordSourceFetchAttempt(
          deps.db,
          {
            sourceId: spec.sourceId,
            cacheKey,
            outcome: "error",
            statusCode: response.status,
            errorCode: "parse_error",
            durationMs,
          },
          clock.nowIso(),
        );
      } catch {
        /* swallow */
      }
    }
    return {
      ok: false,
      providerId: spec.providerId,
      sourceId: spec.sourceId,
      outcome: "error",
      errorCode: "parse_error",
      candidates: [],
      errors: [],
      fetched: true,
      cacheHit: false,
      durationMs,
    };
  }

  const errors: SourceAdapterError[] = [];
  const candidates: SourceAdapterCandidate[] = [];
  const seen = new Set<string>();
  envelope.forEach((value, index) => {
    const mapped = spec.mapRow(value);
    if (mapped.kind === "error") {
      errors.push({ index, reason: mapped.reason });
      return;
    }
    if (mapped.kind === "skip") {
      return;
    }
    // Re-pick through the standard allowlist to ensure no unknown
    // affiliate fields slip through into the candidate.
    const safe = pickAllowedRow(mapped.row);
    if (safe === null) {
      errors.push({ index, reason: "malformed_row" });
      return;
    }
    const candidate = buildCandidate(
      safe,
      index,
      spec.sourceId,
      clock.nowIso,
      seen,
      errors,
    );
    if (candidate !== null) candidates.push(candidate);
  });

  const durationMs = clock.nowMs() - startedMs;
  const outcome: SourceFetchOutcome = candidates.length > 0 ? "ok" : "empty";

  if (deps.db) {
    try {
      recordSourceFetchAttempt(
        deps.db,
        {
          sourceId: spec.sourceId,
          cacheKey,
          outcome,
          statusCode: response.status,
          errorCode: null,
          durationMs,
        },
        clock.nowIso(),
      );
    } catch {
      /* swallow */
    }
    try {
      const fetchedAt = clock.nowIso();
      const expiresAt = new Date(clock.nowMs() + deps.cacheTtlMs).toISOString();
      const bodySha = await sha256Hex(response.body);
      // Serialize the normalized candidate array. Skip the column write
      // if it overflows the bound — the next call will re-fetch, but
      // that is preferable to a silently oversized cache row.
      const candidatesJson = JSON.stringify(candidates);
      const candidatesPayload =
        Buffer.byteLength(candidatesJson, "utf8") <= 32 * 1024
          ? candidatesJson
          : null;
      upsertSourceCacheEntry(deps.db, {
        sourceId: spec.sourceId,
        cacheKey,
        fetchedAt,
        expiresAt,
        status: outcome === "ok" ? "ok" : "empty",
        bodySha256: bodySha,
        metadata: {
          offer_count: candidates.length,
          error_count: errors.length,
        },
        candidatesJson: candidatesPayload,
      });
    } catch {
      /* swallow */
    }
  }

  return {
    ok: true,
    providerId: spec.providerId,
    sourceId: spec.sourceId,
    outcome,
    candidates,
    errors,
    fetched: true,
    cacheHit: false,
    durationMs,
  };
}
