// Awin Offers API provider adapter — first real-provider spike (v0.32.0).
//
// As of v0.47.0 this is a THIN adapter: it owns only the Awin-specific
// hooks (config shape, endpoint/URL shaping, the `{ offers }` response
// envelope, the Awin deny-field set, and per-row voucher filtering) and
// delegates the shared fetch/parse/log/cache scaffolding to
// `runProviderPipeline` in `./source-provider-pipeline`. Observable
// behavior is byte-identical to v0.46: same candidate order, per-row
// error sequence, fetch-log call sites/counts, cache-write signature, and
// the v0.33 cache-read short-circuit.
//
// Mocked, feature-flagged, parser-only. NO live HTTP, NO live API calls in
// tests, NO automatic import into `coupon_codes`, NO extension behavior
// changes, NO ranking changes, NO export/import shape changes.
//
// Per docs/SOURCE_POLICY.md sections 4–6: disabled by default;
// missing/blank API key fails closed; fetcher is injectable so tests never
// touch the network; affiliate/tracking fields are stripped before any
// candidate is returned; errors carry only short reason codes; the API
// key, the raw response body, and any provider headers never appear in the
// result.
//
// The exact Awin Offers API response shape is `[needs verification]`
// against current developer.awin.com docs once a publisher account exists.

import type { Db } from "./db";
import {
  validateDomain,
  type RawRow,
  type SourceAdapterCandidate,
  type SourceAdapterError,
} from "./source-adapters";
import type { AwinProviderConfig } from "./source-provider-config";
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

export type AwinAdapterErrorCode = ProviderAdapterErrorCode;

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

function extractAwinEnvelope(parsed: unknown): unknown[] | null {
  if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
    const env = parsed as { offers?: unknown };
    if (Array.isArray(env.offers)) return env.offers;
  }
  return null;
}

function mapAwinRow(value: unknown): RowMap {
  const allowed = offerRowAllowed(value);
  if (allowed === null) {
    return { kind: "error", reason: "malformed_row" };
  }
  const promo = pickPromotionType(allowed);
  if (promo === null || !VOUCHER_PROMOTION_TYPES.has(promo)) {
    // Silent drop of non-voucher offers per research §5.5.
    return { kind: "skip" };
  }
  const merchantDomain = pickAwinDomain(allowed);
  if (merchantDomain === null) {
    return { kind: "error", reason: "invalid_domain" };
  }
  const row: RawRow = {};
  row.domain = merchantDomain;
  const code = pickCode(allowed);
  if (code !== undefined) row.code = code;
  const label = pickLabel(allowed);
  if (label !== undefined) row.label = label;
  const expiresAt = pickExpiresAt(allowed);
  if (expiresAt !== undefined) row.expiresAt = expiresAt;
  return { kind: "row", row };
}

export function createAwinAdapter(options: AwinAdapterOptions): AwinAdapter {
  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  const cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const spec: ProviderPipelineSpec = {
    providerId: "awin",
    sourceId: AWIN_SOURCE_ID,
    sourceName: AWIN_SOURCE_NAME,
    sourceType: AWIN_SOURCE_TYPE,
    cacheSupported: true,
    config: options.config,
    buildUrl: (domain: string) =>
      buildAwinUrl(baseUrl, options.config.publisherId ?? null, domain),
    extractEnvelope: extractAwinEnvelope,
    mapRow: mapAwinRow,
  };

  return {
    providerId: "awin",
    sourceId: AWIN_SOURCE_ID,
    async fetchAndParse(input: AwinFetchInput): Promise<AwinAdapterResult> {
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
      return result as AwinAdapterResult;
    },
  };
}

export const AWIN_PROVIDER_SOURCE_ID = AWIN_SOURCE_ID;
export const AWIN_PROVIDER_SOURCE_NAME = AWIN_SOURCE_NAME;
