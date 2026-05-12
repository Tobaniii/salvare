// Admin source-preview boundary (v0.34.0).
//
// Preview-only HTTP wrapper around the mocked, feature-flagged Awin provider
// adapter from v0.32/v0.33. It calls the adapter through an injectable
// preview function so the route can be exercised in tests without any live
// HTTP. The handler itself performs zero writes — only the adapter's
// existing internal writes (source_fetch_log, source_cache, and runtime
// coupon_sources registration) ever happen, and only when the provider is
// enabled with a non-blank API key.
//
// Per docs/SOURCE_POLICY.md §6 and the redaction rules in
// docs/SOURCE_PROVIDER_RESEARCH.md §5, the response is built from an
// explicit allowlist: it never echoes the request body, the provider API
// key, the Authorization header, raw provider payloads, raw HTML, cookies,
// localStorage, env vars, DB paths, or stack traces. Affiliate / tracking
// fields are already stripped by the adapter and are re-confirmed here by
// rebuilding each candidate from the allowlist below.
//
// Live activation outside local development still requires the §4 terms
// checklist in docs/SOURCE_PROVIDER_RESEARCH.md; this route only exposes
// the existing mocked/feature-flagged surface.

import { sendJson, readJsonBody, type RouteContext } from "./http-helpers";
import { validateDomain } from "./source-adapters";
import type {
  AwinAdapterErrorCode,
  AwinAdapterResult,
  AwinFetchInput,
} from "./source-provider-awin";

const CACHE_KEY_PATTERN = /^[a-z0-9][a-z0-9._:/-]{0,255}$/;

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

export type AwinPreviewFn = (input: AwinFetchInput) => Promise<AwinAdapterResult>;

interface PreviewBody {
  domain: string;
  query?: string;
}

type Validation =
  | { ok: true; value: PreviewBody }
  | { ok: false; error: string };

function validatePreviewBody(body: unknown): Validation {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "invalid preview payload" };
  }
  const obj = body as Record<string, unknown>;
  const domain = validateDomain(obj.domain);
  if (domain === null) {
    return { ok: false, error: "invalid domain" };
  }
  let query: string | undefined;
  if (obj.query !== undefined && obj.query !== null) {
    if (typeof obj.query !== "string") {
      return { ok: false, error: "invalid query" };
    }
    const trimmed = obj.query.trim();
    if (trimmed.length > 0) {
      if (!CACHE_KEY_PATTERN.test(trimmed)) {
        return { ok: false, error: "invalid query" };
      }
      query = trimmed;
    }
  }
  return { ok: true, value: { domain, query } };
}

interface SafeCandidate {
  sourceId: string;
  domain: string;
  code: string;
  label?: string;
  expiresAt?: string;
  sourceUrl?: string;
  confidence?: number;
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

function safeReason(errorCode: AwinAdapterErrorCode | undefined): string {
  if (errorCode !== undefined && SAFE_REASONS.has(errorCode)) return errorCode;
  return "unknown_error";
}

export async function handleAdminSourcePreviewRoute(
  ctx: RouteContext,
  awinPreview: AwinPreviewFn,
): Promise<boolean> {
  const { req, res, url, requireAuth } = ctx;

  if (req.method !== "POST" || url.pathname !== "/admin/source-preview/awin") {
    return false;
  }
  if (!requireAuth(req, res)) return true;

  let body: unknown;
  try {
    body = await readJsonBody(req);
  } catch {
    sendJson(res, 400, { ok: false, error: "invalid preview payload" });
    return true;
  }

  const validation = validatePreviewBody(body);
  if (!validation.ok) {
    sendJson(res, 400, { ok: false, error: validation.error });
    return true;
  }

  let result: AwinAdapterResult;
  try {
    result = await awinPreview({
      domain: validation.value.domain,
      cacheKey: validation.value.query,
    });
  } catch {
    sendJson(res, 200, {
      ok: false,
      provider: "awin",
      domain: validation.value.domain,
      cacheHit: false,
      fetched: false,
      reason: "fetch_error",
      candidateCount: 0,
      candidates: [],
      errors: [],
    });
    return true;
  }

  if (result.ok) {
    const candidates = buildSafeCandidates(result);
    sendJson(res, 200, {
      ok: true,
      provider: "awin",
      domain: validation.value.domain,
      cacheHit: result.cacheHit,
      fetched: result.fetched,
      candidateCount: candidates.length,
      candidates,
      errors: result.errors.map((e) => ({ index: e.index, reason: e.reason })),
    });
    return true;
  }

  const reason = safeReason(result.errorCode);
  const disabled = reason === "disabled" || reason === "missing_api_key";
  const body200: Record<string, unknown> = {
    ok: false,
    provider: "awin",
    domain: validation.value.domain,
    cacheHit: result.cacheHit,
    fetched: result.fetched,
    reason,
    candidateCount: 0,
    candidates: [],
    errors: [],
  };
  if (disabled) body200.disabled = true;
  sendJson(res, 200, body200);
  return true;
}
