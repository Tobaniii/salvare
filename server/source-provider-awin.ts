// Awin Offers API provider adapter — first real-provider spike (v0.32.0).
//
// Mocked, feature-flagged, parser-only adapter. NO live HTTP, NO live API
// calls in tests, NO automatic import into `coupon_codes`, NO extension
// behavior changes, NO ranking changes, NO export/import shape changes.
//
// Per docs/SOURCE_POLICY.md sections 4–6 and the v0.32.0 implementation
// preview in docs/SOURCE_PROVIDER_RESEARCH.md §5:
//  - disabled by default; missing/blank API key fails closed;
//  - fetcher is injectable so tests never touch the network;
//  - per-source `coupon_sources` row is registered at first call (runtime
//    only — not seeded into bootstrap);
//  - cache-write integration on success, no cache-read short-circuit yet
//    (v0.33 follow-up). Fetch-log entries record outcome, status, error
//    code, duration only — never headers, payload, or credentials;
//  - candidates are normalized via the v0.30 validators; affiliate /
//    tracking link fields are stripped before any candidate is returned;
//  - errors carry only short reason codes; the API key, the raw response
//    body, and any provider headers must never appear in the result.
//
// The exact Awin Offers API response shape is `[needs verification]`
// against current developer.awin.com docs once a publisher account exists.
// The parser below assumes a documented JSON envelope of:
//   { offers: [ { merchantUrl, code, title|description, endDate,
//                 promotionType, ... } ] }
// — fields beyond the documented allowlist are dropped silently. A future
// milestone with real account access must reconcile the parser with the
// live response and add a regression fixture captured from a real call.

import type { Db } from "./db";
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
} from "./source-adapters";
import type { AwinProviderConfig } from "./source-provider-config";

const AWIN_SOURCE_ID = "awin" as const;
const AWIN_SOURCE_NAME = "Awin Offers API";
const AWIN_SOURCE_TYPE = "api" as const;

const DEFAULT_BASE_URL = "https://api.awin.com";
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const VOUCHER_PROMOTION_TYPES: ReadonlySet<string> = new Set([
  "voucher",
  "voucher_code",
  "vouchercode",
  "code",
  "promotion_code",
]);

const AWIN_DENY_FIELDS: ReadonlySet<string> = new Set([
  "clickThroughUrl",
  "clickthroughurl",
  "trackingUrl",
  "trackingurl",
  "deepLink",
  "deeplink",
  "deepLinkUrl",
  "deeplinkurl",
  "affiliateUrl",
  "affiliateurl",
  "affiliateLink",
  "affiliatelink",
  "commissionRate",
  "commissionrate",
  "payout",
  "payoutRate",
  "payoutrate",
  "publisherId",
  "publisherid",
  "advertiserId",
  "advertiserid",
]);

export type AwinAdapterErrorCode =
  | "disabled"
  | "missing_api_key"
  | "rate_limited"
  | "cache_fresh"
  | "unknown_source"
  | "http_4xx"
  | "http_5xx"
  | "fetch_error"
  | "timeout"
  | "parse_error"
  | "empty_response";

export interface AwinFetcherResponse {
  status: number;
  body: string;
}

export type AwinFetcher = (
  url: string,
  init: { headers: Record<string, string>; timeoutMs: number },
) => Promise<AwinFetcherResponse>;

export interface AwinAdapterClock {
  nowIso: () => string;
  nowMs: () => number;
}

export interface AwinAdapterOptions {
  config: AwinProviderConfig;
  fetcher: AwinFetcher;
  db?: Db;
  clock?: AwinAdapterClock;
  baseUrl?: string;
  cacheTtlMs?: number;
  timeoutMs?: number;
}

export interface AwinFetchInput {
  domain: string;
  cacheKey?: string;
}

export interface AwinAdapterResult {
  ok: boolean;
  providerId: "awin";
  sourceId: typeof AWIN_SOURCE_ID;
  outcome: SourceFetchOutcome;
  errorCode?: AwinAdapterErrorCode;
  candidates: SourceAdapterCandidate[];
  errors: SourceAdapterError[];
  fetched: boolean;
  cacheHit: boolean;
  durationMs: number;
}

export interface AwinAdapter {
  readonly providerId: "awin";
  readonly sourceId: typeof AWIN_SOURCE_ID;
  fetchAndParse(input: AwinFetchInput): Promise<AwinAdapterResult>;
}

interface AwinOfferRowRaw {
  merchantUrl?: unknown;
  url?: unknown;
  domain?: unknown;
  code?: unknown;
  voucherCode?: unknown;
  promotionType?: unknown;
  type?: unknown;
  title?: unknown;
  description?: unknown;
  endDate?: unknown;
  validTo?: unknown;
}

function defaultClock(): AwinAdapterClock {
  return {
    nowIso: () => new Date().toISOString(),
    nowMs: () => Date.now(),
  };
}

function safeDomain(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  const direct = validateDomain(trimmed);
  if (direct) return direct;
  // Treat as URL — extract hostname only, no other URL parts kept.
  if (!/^https?:\/\//i.test(trimmed)) return null;
  try {
    const u = new URL(trimmed);
    const host = u.hostname.toLowerCase();
    return validateDomain(host);
  } catch {
    return null;
  }
}

function pickPromotionType(raw: AwinOfferRowRaw): string | null {
  if (typeof raw.promotionType === "string") return raw.promotionType.toLowerCase();
  if (typeof raw.type === "string") return raw.type.toLowerCase();
  return null;
}

function pickCode(raw: AwinOfferRowRaw): unknown {
  if (raw.code !== undefined) return raw.code;
  if (raw.voucherCode !== undefined) return raw.voucherCode;
  return undefined;
}

function pickLabel(raw: AwinOfferRowRaw): unknown {
  if (raw.title !== undefined) return raw.title;
  if (raw.description !== undefined) return raw.description;
  return undefined;
}

function pickExpiresAt(raw: AwinOfferRowRaw): unknown {
  if (raw.endDate !== undefined) return raw.endDate;
  if (raw.validTo !== undefined) return raw.validTo;
  return undefined;
}

function pickAwinDomain(raw: AwinOfferRowRaw): string | null {
  return (
    safeDomain(raw.domain) ??
    safeDomain(raw.merchantUrl) ??
    safeDomain(raw.url)
  );
}

function offerRowAllowed(value: unknown): AwinOfferRowRaw | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const obj = value as Record<string, unknown>;
  for (const denied of AWIN_DENY_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(obj, denied)) {
      delete obj[denied];
    }
  }
  const out: AwinOfferRowRaw = {};
  if ("merchantUrl" in obj) out.merchantUrl = obj.merchantUrl;
  if ("url" in obj) out.url = obj.url;
  if ("domain" in obj) out.domain = obj.domain;
  if ("code" in obj) out.code = obj.code;
  if ("voucherCode" in obj) out.voucherCode = obj.voucherCode;
  if ("promotionType" in obj) out.promotionType = obj.promotionType;
  if ("type" in obj) out.type = obj.type;
  if ("title" in obj) out.title = obj.title;
  if ("description" in obj) out.description = obj.description;
  if ("endDate" in obj) out.endDate = obj.endDate;
  if ("validTo" in obj) out.validTo = obj.validTo;
  return out;
}

function buildAwinUrl(
  baseUrl: string,
  publisherId: string | null,
  domain: string,
): string {
  const root = baseUrl.replace(/\/+$/, "");
  if (publisherId !== null) {
    return `${root}/publishers/${encodeURIComponent(publisherId)}/offers?merchantDomain=${encodeURIComponent(domain)}`;
  }
  return `${root}/offers?merchantDomain=${encodeURIComponent(domain)}`;
}

function makeCacheKey(domain: string, custom?: string): string {
  if (custom !== undefined && custom.length > 0) return custom;
  return `merchant:${domain}`;
}

async function sha256Hex(input: string): Promise<string> {
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(input, "utf8").digest("hex");
}

function mapHttpStatus(status: number): AwinAdapterErrorCode | null {
  if (status >= 200 && status < 300) return null;
  if (status >= 400 && status < 500) return "http_4xx";
  return "http_5xx";
}

function disabledResult(
  errorCode: AwinAdapterErrorCode,
  durationMs: number,
): AwinAdapterResult {
  return {
    ok: false,
    providerId: "awin",
    sourceId: AWIN_SOURCE_ID,
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

export function createAwinAdapter(options: AwinAdapterOptions): AwinAdapter {
  const clock = options.clock ?? defaultClock();
  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  const cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  function ensureSourceRegistered(): boolean {
    if (!options.db) return true;
    try {
      ensureCouponSource(
        options.db,
        {
          id: AWIN_SOURCE_ID,
          name: AWIN_SOURCE_NAME,
          type: AWIN_SOURCE_TYPE,
          enabled: true,
        },
        clock.nowIso(),
      );
      return true;
    } catch {
      return false;
    }
  }

  return {
    providerId: "awin",
    sourceId: AWIN_SOURCE_ID,
    async fetchAndParse(input: AwinFetchInput): Promise<AwinAdapterResult> {
      const startedMs = clock.nowMs();

      if (options.config.enabled !== true) {
        return disabledResult("disabled", 0);
      }
      const apiKey = options.config.apiKey;
      if (typeof apiKey !== "string" || apiKey.length === 0) {
        return disabledResult("missing_api_key", 0);
      }

      const domain = validateDomain(input.domain);
      if (!domain) {
        return disabledResult("parse_error", 0);
      }
      const cacheKey = makeCacheKey(domain, input.cacheKey);

      ensureSourceRegistered();

      // Cache-read short-circuit (v0.33.0). A fresh `ok`-status cache row
      // with a parseable, re-validatable candidate array is returned
      // without invoking the fetcher. Any failure here — missing column,
      // expired entry, corrupt JSON, row-level revalidation failure —
      // falls through to a fresh fetch. The cache is treated as untrusted
      // input on read even though we own the writer.
      if (options.db) {
        try {
          const lookup = getSourceCacheEntry(
            options.db,
            AWIN_SOURCE_ID,
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
              AWIN_SOURCE_ID,
            );
            if (cached !== null) {
              const durationMs = clock.nowMs() - startedMs;
              try {
                recordSourceFetchAttempt(
                  options.db,
                  {
                    sourceId: AWIN_SOURCE_ID,
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
                providerId: "awin",
                sourceId: AWIN_SOURCE_ID,
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

      const url = buildAwinUrl(baseUrl, options.config.publisherId, domain);
      const headers: Record<string, string> = {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      };

      let response: AwinFetcherResponse;
      try {
        response = await options.fetcher(url, { headers, timeoutMs });
      } catch (err) {
        const errorCode: AwinAdapterErrorCode =
          err && typeof err === "object" && (err as { name?: string }).name === "AbortError"
            ? "timeout"
            : "fetch_error";
        const durationMs = clock.nowMs() - startedMs;
        if (options.db) {
          try {
            recordSourceFetchAttempt(
              options.db,
              {
                sourceId: AWIN_SOURCE_ID,
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
          providerId: "awin",
          sourceId: AWIN_SOURCE_ID,
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
        if (options.db) {
          try {
            recordSourceFetchAttempt(
              options.db,
              {
                sourceId: AWIN_SOURCE_ID,
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
          providerId: "awin",
          sourceId: AWIN_SOURCE_ID,
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
        if (options.db) {
          try {
            recordSourceFetchAttempt(
              options.db,
              {
                sourceId: AWIN_SOURCE_ID,
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
          providerId: "awin",
          sourceId: AWIN_SOURCE_ID,
          outcome: "error",
          errorCode: "parse_error",
          candidates: [],
          errors: [],
          fetched: true,
          cacheHit: false,
          durationMs,
        };
      }

      let offers: unknown[] | null = null;
      if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
        const env = parsed as { offers?: unknown };
        if (Array.isArray(env.offers)) offers = env.offers;
      }
      if (offers === null) {
        const durationMs = clock.nowMs() - startedMs;
        if (options.db) {
          try {
            recordSourceFetchAttempt(
              options.db,
              {
                sourceId: AWIN_SOURCE_ID,
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
          providerId: "awin",
          sourceId: AWIN_SOURCE_ID,
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
      offers.forEach((offer, index) => {
        const allowed = offerRowAllowed(offer);
        if (allowed === null) {
          errors.push({ index, reason: "malformed_row" });
          return;
        }
        const promo = pickPromotionType(allowed);
        if (promo === null || !VOUCHER_PROMOTION_TYPES.has(promo)) {
          // Silent drop of non-voucher offers per research §5.5.
          return;
        }
        const merchantDomain = pickAwinDomain(allowed);
        if (merchantDomain === null) {
          errors.push({ index, reason: "invalid_domain" });
          return;
        }
        const row: RawRow = {};
        row.domain = merchantDomain;
        const code = pickCode(allowed);
        if (code !== undefined) row.code = code;
        const label = pickLabel(allowed);
        if (label !== undefined) row.label = label;
        const expiresAt = pickExpiresAt(allowed);
        if (expiresAt !== undefined) row.expiresAt = expiresAt;
        // Re-pick through the standard allowlist to ensure no unknown
        // affiliate fields slip through into the candidate.
        const safe = pickAllowedRow(row);
        if (safe === null) {
          errors.push({ index, reason: "malformed_row" });
          return;
        }
        const candidate = buildCandidate(
          safe,
          index,
          AWIN_SOURCE_ID,
          clock.nowIso,
          seen,
          errors,
        );
        if (candidate !== null) candidates.push(candidate);
      });

      const durationMs = clock.nowMs() - startedMs;
      const outcome: SourceFetchOutcome = candidates.length > 0 ? "ok" : "empty";

      if (options.db) {
        try {
          recordSourceFetchAttempt(
            options.db,
            {
              sourceId: AWIN_SOURCE_ID,
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
          const expiresAt = new Date(clock.nowMs() + cacheTtlMs).toISOString();
          const bodySha = await sha256Hex(response.body);
          // Serialize the normalized candidate array. Skip the column write
          // if it overflows the bound — the next call will re-fetch, but
          // that is preferable to a silently oversized cache row.
          const candidatesJson = JSON.stringify(candidates);
          const candidatesPayload =
            Buffer.byteLength(candidatesJson, "utf8") <= 32 * 1024
              ? candidatesJson
              : null;
          upsertSourceCacheEntry(options.db, {
            sourceId: AWIN_SOURCE_ID,
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
        providerId: "awin",
        sourceId: AWIN_SOURCE_ID,
        outcome,
        candidates,
        errors,
        fetched: true,
        cacheHit: false,
        durationMs,
      };
    },
  };
}

export const AWIN_PROVIDER_SOURCE_ID = AWIN_SOURCE_ID;
export const AWIN_PROVIDER_SOURCE_NAME = AWIN_SOURCE_NAME;
