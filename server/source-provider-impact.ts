// impact.com Promotions API provider adapter — second mocked provider
// spike (v0.42.0).
//
// Mocked, feature-flagged, parser-only adapter. NO live HTTP, NO live API
// calls in tests, NO automatic import into `coupon_codes`, NO admin
// preview/import wiring, NO source-refresh CLI wiring, NO extension
// behavior changes, NO ranking changes, NO export/import shape changes,
// NO scheduler, NO scraping, and NO new dependencies.
//
// This is the second adapter spike that proves the trusted-source provider
// architecture from v0.32 generalizes beyond Awin. It mirrors the Awin
// module layout exactly:
//  - disabled by default; missing/blank API key fails closed;
//  - fetcher is injectable so tests never touch the network;
//  - per-source `coupon_sources` row is registered at first call (runtime
//    only — not seeded into bootstrap);
//  - cache-write integration on success only; no cache-read short-circuit
//    in v0.42 (deferred to a generic provider-registry milestone so this
//    spike does not duplicate Awin-specific TTL logic). Fetch-log entries
//    record outcome, status, error code, duration only — never headers,
//    payload, or credentials;
//  - candidates are normalized via the v0.30 validators; affiliate /
//    tracking / payout / partner-id fields are stripped before any
//    candidate is returned;
//  - errors carry only short reason codes; the API key, the raw response
//    body, the account SID, and any provider headers must never appear in
//    the result.
//
// The exact impact.com Promotions API response shape used by the parser is
// CONTRACT-STYLE and `[needs verification]` against developer.impact.com
// once a publisher account exists. The real impact.com API authenticates
// via HTTP Basic with `<accountSid>:<authToken>`; v0.42 uses a `Bearer`
// header to match the existing Awin redaction-assertion surface. Live
// activation must reconcile auth headers, credential format, and the
// response envelope (e.g. `Promotions` vs `promotions`, field name case,
// pagination) with the live API before production use.

import type { Db } from "./db";
import { ensureCouponSource } from "./db-sources";
import {
  recordSourceFetchAttempt,
  upsertSourceCacheEntry,
  type SourceFetchOutcome,
} from "./db-source-cache";
import {
  buildCandidate,
  pickAllowedRow,
  validateDomain,
  type RawRow,
  type SourceAdapterCandidate,
  type SourceAdapterError,
} from "./source-adapters";
import type { ImpactProviderConfig } from "./source-provider-config";

const IMPACT_SOURCE_ID = "impact" as const;
const IMPACT_SOURCE_NAME = "impact.com Promotions API";
const IMPACT_SOURCE_TYPE = "api" as const;

const DEFAULT_BASE_URL = "https://api.impact.com";
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

const PROMO_CODE_TYPES: ReadonlySet<string> = new Set([
  "promo_code",
  "promocode",
  "promotion_code",
  "promotioncode",
  "coupon",
  "coupon_code",
  "couponcode",
  "code",
  "voucher",
  "voucher_code",
]);

const IMPACT_DENY_FIELDS: ReadonlySet<string> = new Set([
  "TrackingUrl",
  "trackingUrl",
  "trackingurl",
  "DeepLink",
  "deepLink",
  "deeplink",
  "DeepLinkUrl",
  "deepLinkUrl",
  "deeplinkurl",
  "ClickUrl",
  "clickUrl",
  "clickurl",
  "ClickThroughUrl",
  "clickThroughUrl",
  "clickthroughurl",
  "AffiliateUrl",
  "affiliateUrl",
  "affiliateurl",
  "AffiliateLink",
  "affiliateLink",
  "affiliatelink",
  "PartnerUrl",
  "partnerUrl",
  "partnerurl",
  "PartnerId",
  "partnerId",
  "partnerid",
  "AdvertiserId",
  "advertiserId",
  "advertiserid",
  "AccountSid",
  "accountSid",
  "accountsid",
  "AuthToken",
  "authToken",
  "authtoken",
  "Payout",
  "payout",
  "PayoutRate",
  "payoutRate",
  "payoutrate",
  "Commission",
  "commission",
  "CommissionRate",
  "commissionRate",
  "commissionrate",
  "EarningsPerClick",
  "earningsPerClick",
  "earningsperclick",
]);

export type ImpactAdapterErrorCode =
  | "disabled"
  | "missing_api_key"
  | "http_4xx"
  | "http_5xx"
  | "fetch_error"
  | "timeout"
  | "parse_error"
  | "empty_response";

export interface ImpactFetcherResponse {
  status: number;
  body: string;
}

export type ImpactFetcher = (
  url: string,
  init: { headers: Record<string, string>; timeoutMs: number },
) => Promise<ImpactFetcherResponse>;

export interface ImpactAdapterClock {
  nowIso: () => string;
  nowMs: () => number;
}

export interface ImpactAdapterOptions {
  config: ImpactProviderConfig;
  fetcher: ImpactFetcher;
  db?: Db;
  clock?: ImpactAdapterClock;
  baseUrl?: string;
  cacheTtlMs?: number;
  timeoutMs?: number;
}

export interface ImpactFetchInput {
  domain: string;
  cacheKey?: string;
}

export interface ImpactAdapterResult {
  ok: boolean;
  providerId: "impact";
  sourceId: typeof IMPACT_SOURCE_ID;
  outcome: SourceFetchOutcome;
  errorCode?: ImpactAdapterErrorCode;
  candidates: SourceAdapterCandidate[];
  errors: SourceAdapterError[];
  fetched: boolean;
  durationMs: number;
}

export interface ImpactAdapter {
  readonly providerId: "impact";
  readonly sourceId: typeof IMPACT_SOURCE_ID;
  fetchAndParse(input: ImpactFetchInput): Promise<ImpactAdapterResult>;
}

interface ImpactPromotionRowRaw {
  AdvertiserUrl?: unknown;
  advertiserUrl?: unknown;
  MerchantUrl?: unknown;
  merchantUrl?: unknown;
  Url?: unknown;
  url?: unknown;
  Domain?: unknown;
  domain?: unknown;
  PromoCode?: unknown;
  promoCode?: unknown;
  Code?: unknown;
  code?: unknown;
  CouponCode?: unknown;
  couponCode?: unknown;
  PromotionType?: unknown;
  promotionType?: unknown;
  Type?: unknown;
  type?: unknown;
  OfferType?: unknown;
  offerType?: unknown;
  Name?: unknown;
  name?: unknown;
  Description?: unknown;
  description?: unknown;
  Title?: unknown;
  title?: unknown;
  EndDate?: unknown;
  endDate?: unknown;
  EndsAt?: unknown;
  endsAt?: unknown;
  ExpiresAt?: unknown;
  expiresAt?: unknown;
  ValidTo?: unknown;
  validTo?: unknown;
}

const ALLOWED_RAW_KEYS: ReadonlySet<string> = new Set([
  "AdvertiserUrl",
  "advertiserUrl",
  "MerchantUrl",
  "merchantUrl",
  "Url",
  "url",
  "Domain",
  "domain",
  "PromoCode",
  "promoCode",
  "Code",
  "code",
  "CouponCode",
  "couponCode",
  "PromotionType",
  "promotionType",
  "Type",
  "type",
  "OfferType",
  "offerType",
  "Name",
  "name",
  "Description",
  "description",
  "Title",
  "title",
  "EndDate",
  "endDate",
  "EndsAt",
  "endsAt",
  "ExpiresAt",
  "expiresAt",
  "ValidTo",
  "validTo",
]);

function defaultClock(): ImpactAdapterClock {
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
  if (!/^https?:\/\//i.test(trimmed)) return null;
  try {
    const u = new URL(trimmed);
    const host = u.hostname.toLowerCase();
    return validateDomain(host);
  } catch {
    return null;
  }
}

function pickPromotionType(raw: ImpactPromotionRowRaw): string | null {
  const value =
    (typeof raw.PromotionType === "string" && raw.PromotionType) ||
    (typeof raw.promotionType === "string" && raw.promotionType) ||
    (typeof raw.Type === "string" && raw.Type) ||
    (typeof raw.type === "string" && raw.type) ||
    (typeof raw.OfferType === "string" && raw.OfferType) ||
    (typeof raw.offerType === "string" && raw.offerType) ||
    null;
  if (typeof value !== "string") return null;
  return value.toLowerCase();
}

function pickCode(raw: ImpactPromotionRowRaw): unknown {
  if (raw.PromoCode !== undefined) return raw.PromoCode;
  if (raw.promoCode !== undefined) return raw.promoCode;
  if (raw.Code !== undefined) return raw.Code;
  if (raw.code !== undefined) return raw.code;
  if (raw.CouponCode !== undefined) return raw.CouponCode;
  if (raw.couponCode !== undefined) return raw.couponCode;
  return undefined;
}

function pickLabel(raw: ImpactPromotionRowRaw): unknown {
  if (raw.Name !== undefined) return raw.Name;
  if (raw.name !== undefined) return raw.name;
  if (raw.Description !== undefined) return raw.Description;
  if (raw.description !== undefined) return raw.description;
  if (raw.Title !== undefined) return raw.Title;
  if (raw.title !== undefined) return raw.title;
  return undefined;
}

function pickExpiresAt(raw: ImpactPromotionRowRaw): unknown {
  if (raw.EndDate !== undefined) return raw.EndDate;
  if (raw.endDate !== undefined) return raw.endDate;
  if (raw.EndsAt !== undefined) return raw.EndsAt;
  if (raw.endsAt !== undefined) return raw.endsAt;
  if (raw.ExpiresAt !== undefined) return raw.ExpiresAt;
  if (raw.expiresAt !== undefined) return raw.expiresAt;
  if (raw.ValidTo !== undefined) return raw.ValidTo;
  if (raw.validTo !== undefined) return raw.validTo;
  return undefined;
}

function pickImpactDomain(raw: ImpactPromotionRowRaw): string | null {
  return (
    safeDomain(raw.Domain) ??
    safeDomain(raw.domain) ??
    safeDomain(raw.AdvertiserUrl) ??
    safeDomain(raw.advertiserUrl) ??
    safeDomain(raw.MerchantUrl) ??
    safeDomain(raw.merchantUrl) ??
    safeDomain(raw.Url) ??
    safeDomain(raw.url)
  );
}

function promotionRowAllowed(value: unknown): ImpactPromotionRowRaw | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const obj = value as Record<string, unknown>;
  for (const denied of IMPACT_DENY_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(obj, denied)) {
      delete obj[denied];
    }
  }
  const out: ImpactPromotionRowRaw = {};
  for (const key of ALLOWED_RAW_KEYS) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      (out as Record<string, unknown>)[key] = obj[key];
    }
  }
  return out;
}

function buildImpactUrl(
  baseUrl: string,
  accountSid: string | null,
  domain: string,
): string {
  const root = baseUrl.replace(/\/+$/, "");
  if (accountSid !== null) {
    return `${root}/Mediapartners/${encodeURIComponent(accountSid)}/Promotions?advertiserDomain=${encodeURIComponent(domain)}`;
  }
  return `${root}/Promotions?advertiserDomain=${encodeURIComponent(domain)}`;
}

function makeCacheKey(domain: string, custom?: string): string {
  if (custom !== undefined && custom.length > 0) return custom;
  return `merchant:${domain}`;
}

async function sha256Hex(input: string): Promise<string> {
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(input, "utf8").digest("hex");
}

function mapHttpStatus(status: number): ImpactAdapterErrorCode | null {
  if (status >= 200 && status < 300) return null;
  if (status >= 400 && status < 500) return "http_4xx";
  return "http_5xx";
}

function disabledResult(
  errorCode: ImpactAdapterErrorCode,
  durationMs: number,
): ImpactAdapterResult {
  return {
    ok: false,
    providerId: "impact",
    sourceId: IMPACT_SOURCE_ID,
    outcome: "error",
    errorCode,
    candidates: [],
    errors: [],
    fetched: false,
    durationMs,
  };
}

function extractPromotionsArray(parsed: unknown): unknown[] | null {
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  const env = parsed as { Promotions?: unknown; promotions?: unknown };
  if (Array.isArray(env.Promotions)) return env.Promotions;
  if (Array.isArray(env.promotions)) return env.promotions;
  return null;
}

export function createImpactAdapter(options: ImpactAdapterOptions): ImpactAdapter {
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
          id: IMPACT_SOURCE_ID,
          name: IMPACT_SOURCE_NAME,
          type: IMPACT_SOURCE_TYPE,
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
    providerId: "impact",
    sourceId: IMPACT_SOURCE_ID,
    async fetchAndParse(input: ImpactFetchInput): Promise<ImpactAdapterResult> {
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

      const url = buildImpactUrl(baseUrl, options.config.accountSid, domain);
      const headers: Record<string, string> = {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      };

      let response: ImpactFetcherResponse;
      try {
        response = await options.fetcher(url, { headers, timeoutMs });
      } catch (err) {
        const errorCode: ImpactAdapterErrorCode =
          err && typeof err === "object" && (err as { name?: string }).name === "AbortError"
            ? "timeout"
            : "fetch_error";
        const durationMs = clock.nowMs() - startedMs;
        if (options.db) {
          try {
            recordSourceFetchAttempt(
              options.db,
              {
                sourceId: IMPACT_SOURCE_ID,
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
          providerId: "impact",
          sourceId: IMPACT_SOURCE_ID,
          outcome: "error",
          errorCode,
          candidates: [],
          errors: [],
          fetched: true,
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
                sourceId: IMPACT_SOURCE_ID,
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
          providerId: "impact",
          sourceId: IMPACT_SOURCE_ID,
          outcome: "error",
          errorCode: httpErr,
          candidates: [],
          errors: [],
          fetched: true,
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
                sourceId: IMPACT_SOURCE_ID,
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
          providerId: "impact",
          sourceId: IMPACT_SOURCE_ID,
          outcome: "error",
          errorCode: "parse_error",
          candidates: [],
          errors: [],
          fetched: true,
          durationMs,
        };
      }

      const promotions = extractPromotionsArray(parsed);
      if (promotions === null) {
        const durationMs = clock.nowMs() - startedMs;
        if (options.db) {
          try {
            recordSourceFetchAttempt(
              options.db,
              {
                sourceId: IMPACT_SOURCE_ID,
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
          providerId: "impact",
          sourceId: IMPACT_SOURCE_ID,
          outcome: "error",
          errorCode: "parse_error",
          candidates: [],
          errors: [],
          fetched: true,
          durationMs,
        };
      }

      const errors: SourceAdapterError[] = [];
      const candidates: SourceAdapterCandidate[] = [];
      const seen = new Set<string>();
      promotions.forEach((promotion, index) => {
        const allowed = promotionRowAllowed(promotion);
        if (allowed === null) {
          errors.push({ index, reason: "malformed_row" });
          return;
        }
        const promo = pickPromotionType(allowed);
        if (promo === null || !PROMO_CODE_TYPES.has(promo)) {
          // Silent drop of non-code promotions (cashback, free-shipping
          // without code, brand awareness, etc.) per impact.com research.
          return;
        }
        const advertiserDomain = pickImpactDomain(allowed);
        if (advertiserDomain === null) {
          errors.push({ index, reason: "invalid_domain" });
          return;
        }
        const row: RawRow = {};
        row.domain = advertiserDomain;
        const code = pickCode(allowed);
        if (code !== undefined) row.code = code;
        const label = pickLabel(allowed);
        if (label !== undefined) row.label = label;
        const expiresAt = pickExpiresAt(allowed);
        if (expiresAt !== undefined) row.expiresAt = expiresAt;
        const safe = pickAllowedRow(row);
        if (safe === null) {
          errors.push({ index, reason: "malformed_row" });
          return;
        }
        const candidate = buildCandidate(
          safe,
          index,
          IMPACT_SOURCE_ID,
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
              sourceId: IMPACT_SOURCE_ID,
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
          const candidatesJson = JSON.stringify(candidates);
          const candidatesPayload =
            Buffer.byteLength(candidatesJson, "utf8") <= 32 * 1024
              ? candidatesJson
              : null;
          upsertSourceCacheEntry(options.db, {
            sourceId: IMPACT_SOURCE_ID,
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
        providerId: "impact",
        sourceId: IMPACT_SOURCE_ID,
        outcome,
        candidates,
        errors,
        fetched: true,
        durationMs,
      };
    },
  };
}

export const IMPACT_PROVIDER_SOURCE_ID = IMPACT_SOURCE_ID;
export const IMPACT_PROVIDER_SOURCE_NAME = IMPACT_SOURCE_NAME;
