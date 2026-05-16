// impact.com Promotions API provider adapter — second mocked provider
// spike (v0.42.0).
//
// As of v0.47.0 this is a THIN adapter: it owns only the Impact-specific
// hooks (config shape, endpoint/URL shaping, the `{ Promotions } /
// { promotions }` response envelope, the Impact deny-field set, and
// per-row promo-code filtering) and delegates the shared
// fetch/parse/log/cache scaffolding to `runProviderPipeline` in
// `./source-provider-pipeline`. v0.47.0 brings Impact to INTERNAL
// capability parity with Awin: it now participates in the shared
// cache-read short-circuit (`cacheSupported: true`) and its result carries
// the `cacheHit` field. Impact remains registry-internal — NOT
// user-exposed, NOT import-wired (v0.48/v0.49).
//
// Mocked, feature-flagged, parser-only. NO live HTTP, NO live API calls in
// tests, NO automatic import into `coupon_codes`, NO admin preview/import
// wiring, NO source-refresh CLI wiring, NO extension behavior changes, NO
// ranking changes, NO export/import shape changes, NO scheduler, NO
// scraping, and NO new dependencies.
//
// Per docs/SOURCE_POLICY.md sections 4–6: disabled by default;
// missing/blank API key fails closed; fetcher is injectable so tests never
// touch the network; affiliate/tracking/payout/partner-id fields are
// stripped before any candidate is returned; errors carry only short
// reason codes; the API key, the raw response body, the account SID, and
// any provider headers never appear in the result.
//
// The exact impact.com Promotions API response shape is CONTRACT-STYLE and
// `[needs verification]` against developer.impact.com once a publisher
// account exists. The real impact.com API authenticates via HTTP Basic
// with `<accountSid>:<authToken>`; v0.42 uses a `Bearer` header to match
// the existing Awin redaction-assertion surface. Live activation must
// reconcile auth headers, credential format, and the response envelope
// (e.g. `Promotions` vs `promotions`, field name case, pagination) with
// the live API before production use.

import type { Db } from "./db";
import {
  validateDomain,
  type RawRow,
  type SourceAdapterCandidate,
  type SourceAdapterError,
} from "./source-adapters";
import type { ImpactProviderConfig } from "./source-provider-config";
import {
  runProviderPipeline,
  type ProviderPipelineSpec,
  type RowMap,
} from "./source-provider-pipeline";
import type {
  ProviderAdapterErrorCode,
  ProviderAdapterResult,
} from "./source-provider-types";
import type { SourceFetchOutcome } from "./db-source-cache";

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

export type ImpactAdapterErrorCode = ProviderAdapterErrorCode;

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
  // v0.47.0 — Impact now participates in the shared cache-read
  // short-circuit, so the result carries `cacheHit` like Awin's.
  cacheHit: boolean;
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

function extractPromotionsArray(parsed: unknown): unknown[] | null {
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  const env = parsed as { Promotions?: unknown; promotions?: unknown };
  if (Array.isArray(env.Promotions)) return env.Promotions;
  if (Array.isArray(env.promotions)) return env.promotions;
  return null;
}

function mapImpactRow(value: unknown): RowMap {
  const allowed = promotionRowAllowed(value);
  if (allowed === null) {
    return { kind: "error", reason: "malformed_row" };
  }
  const promo = pickPromotionType(allowed);
  if (promo === null || !PROMO_CODE_TYPES.has(promo)) {
    // Silent drop of non-code promotions (cashback, free-shipping
    // without code, brand awareness, etc.) per impact.com research.
    return { kind: "skip" };
  }
  const advertiserDomain = pickImpactDomain(allowed);
  if (advertiserDomain === null) {
    return { kind: "error", reason: "invalid_domain" };
  }
  const row: RawRow = {};
  row.domain = advertiserDomain;
  const code = pickCode(allowed);
  if (code !== undefined) row.code = code;
  const label = pickLabel(allowed);
  if (label !== undefined) row.label = label;
  const expiresAt = pickExpiresAt(allowed);
  if (expiresAt !== undefined) row.expiresAt = expiresAt;
  return { kind: "row", row };
}

export function createImpactAdapter(
  options: ImpactAdapterOptions,
): ImpactAdapter {
  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  const cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const spec: ProviderPipelineSpec = {
    providerId: "impact",
    sourceId: IMPACT_SOURCE_ID,
    sourceName: IMPACT_SOURCE_NAME,
    sourceType: IMPACT_SOURCE_TYPE,
    cacheSupported: true,
    config: options.config,
    buildUrl: (domain: string) =>
      buildImpactUrl(baseUrl, options.config.accountSid ?? null, domain),
    extractEnvelope: extractPromotionsArray,
    mapRow: mapImpactRow,
  };

  return {
    providerId: "impact",
    sourceId: IMPACT_SOURCE_ID,
    async fetchAndParse(input: ImpactFetchInput): Promise<ImpactAdapterResult> {
      const result: ProviderAdapterResult = await runProviderPipeline(
        spec,
        {
          db: options.db,
          fetcher: options.fetcher,
          clock: options.clock,
          timeoutMs,
          cacheTtlMs,
        },
        input,
      );
      return result as ImpactAdapterResult;
    },
  };
}

export const IMPACT_PROVIDER_SOURCE_ID = IMPACT_SOURCE_ID;
export const IMPACT_PROVIDER_SOURCE_NAME = IMPACT_SOURCE_NAME;
