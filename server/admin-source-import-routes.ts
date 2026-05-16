// Admin source-import boundary (v0.36.0).
//
// Protected, confirmed, additive import of mocked Awin provider candidates
// into coupon_codes + coupon_code_sources. Wraps the same injectable Awin
// preview function used by the v0.34 source-preview route so that:
//
//   - Untrusted candidate arrays from the client are NEVER used as DB
//     writes — the route re-derives candidates server-side from the
//     adapter (cache-preferred via the v0.33 short-circuit).
//   - Server-side `confirm === "IMPORT"` is mandatory; the client gate is
//     UX only.
//   - The response is built from an explicit allowlist and never echoes
//     the API key, Authorization header, raw payloads, raw HTML, env vars,
//     DB paths, stack traces, or affiliate/tracking fields.
//   - coupon_results is never read, written, or deleted.
//   - Existing coupon_codes rows for the store are preserved; non-Awin
//     provenance survives untouched.
//
// Live activation outside local development still depends on the §4 terms
// checklist in docs/SOURCE_PROVIDER_RESEARCH.md; this route only exposes
// the existing mocked/feature-flagged surface.

import { sendJson, readJsonBody, type RouteContext } from "./http-helpers";
import { validateDomain } from "./source-adapters";
import { importProviderCandidates } from "./db-source-import";
import {
  extractProviderId,
  type ProviderRouteResolver,
} from "./admin-source-preview-routes";
import type { ProviderAdapterResult } from "./source-provider-types";

const CONFIRMATION_PHRASE = "IMPORT";
const IMPORT_PREFIX = "/admin/source-import/";

const SAFE_REASONS: ReadonlySet<string> = new Set<string>([
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

interface ImportBody {
  domain: string;
}

type Validation =
  | { ok: true; value: ImportBody }
  | { ok: false; status: number; error: string };

function validateImportBody(body: unknown): Validation {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, status: 400, error: "invalid import payload" };
  }
  const obj = body as Record<string, unknown>;
  const confirm = obj.confirm;
  if (typeof confirm !== "string" || confirm !== CONFIRMATION_PHRASE) {
    return { ok: false, status: 400, error: "confirmation required" };
  }
  const domain = validateDomain(obj.domain);
  if (domain === null) {
    return { ok: false, status: 400, error: "invalid domain" };
  }
  return { ok: true, value: { domain } };
}

function safeReason(errorCode: string | undefined): string {
  if (errorCode !== undefined && SAFE_REASONS.has(errorCode)) return errorCode;
  return "unknown_error";
}

export async function handleAdminSourceImportRoute(
  ctx: RouteContext,
  resolveProvider: ProviderRouteResolver,
): Promise<boolean> {
  const { db, req, res, url, requireAuth } = ctx;

  if (
    req.method !== "POST" ||
    !url.pathname.startsWith(IMPORT_PREFIX)
  ) {
    return false;
  }
  // Auth precedes segment validation so an unauthorized request to any
  // /admin/source-import/* (including an illegal segment) still 401s.
  if (!requireAuth(req, res)) return true;

  const providerId = extractProviderId(url.pathname, IMPORT_PREFIX);
  if (providerId === null) {
    sendJson(res, 400, { ok: false, error: "invalid provider" });
    return true;
  }

  let body: unknown;
  try {
    body = await readJsonBody(req);
  } catch {
    sendJson(res, 400, { ok: false, error: "invalid import payload" });
    return true;
  }

  const validation = validateImportBody(body);
  if (!validation.ok) {
    sendJson(res, validation.status, { ok: false, error: validation.error });
    return true;
  }

  const { domain } = validation.value;

  const resolved = resolveProvider(providerId, "import");
  if (!resolved.ok) {
    // Valid-charset but registry-denied (unknown / not user-exposed /
    // importSupported:false). v0.44 disabled-envelope shape, HTTP 200, no
    // `disabled:true`. This is the fail-closed gate that keeps impact
    // (importSupported:false, userExposed:false) unreachable here.
    sendJson(res, 200, {
      ok: false,
      provider: providerId,
      domain,
      reason: resolved.reason,
      candidatesAccepted: 0,
      codesImported: 0,
      provenanceRecorded: 0,
      rejected: 0,
      errors: [],
    });
    return true;
  }

  // Registry-authoritative provider identity. Never the old AWIN_* constant,
  // never a client-supplied value — the second-pass candidate filter and the
  // importProviderCandidates args are all driven from the descriptor.
  const descriptor = resolved.descriptor;
  const provider = descriptor.providerId;

  let result: ProviderAdapterResult;
  try {
    result = await resolved.closure({ domain });
  } catch {
    sendJson(res, 200, {
      ok: false,
      provider,
      domain,
      reason: "fetch_error",
      candidatesAccepted: 0,
      codesImported: 0,
      provenanceRecorded: 0,
      rejected: 0,
      errors: [],
    });
    return true;
  }

  if (!result.ok) {
    const reason = safeReason(result.errorCode);
    const disabled = reason === "disabled" || reason === "missing_api_key";
    const responseBody: Record<string, unknown> = {
      ok: false,
      provider,
      domain,
      reason,
      candidatesAccepted: 0,
      codesImported: 0,
      provenanceRecorded: 0,
      rejected: 0,
      errors: [],
    };
    if (disabled) responseBody.disabled = true;
    sendJson(res, 200, responseBody);
    return true;
  }

  // The adapter has already validated and redacted candidate fields. Apply a
  // second-pass allowlist + domain match here so the import path itself has
  // an explicit redaction boundary independent of the adapter's contract.
  // The sourceId compared here is the resolved descriptor's, not a constant.
  let rejected = 0;
  const accepted = result.candidates.flatMap((candidate) => {
    if (candidate.sourceId !== descriptor.sourceId) {
      rejected += 1;
      return [];
    }
    if (candidate.domain !== domain) {
      rejected += 1;
      return [];
    }
    return [
      {
        domain: candidate.domain,
        code: candidate.code,
        label: candidate.label,
        expiresAt: candidate.expiresAt,
      },
    ];
  });

  const stats = importProviderCandidates(db, {
    sourceId: descriptor.sourceId,
    sourceName: descriptor.displayName,
    sourceType: descriptor.sourceType,
    domain,
    candidates: accepted,
  });

  sendJson(res, 200, {
    ok: true,
    provider,
    domain,
    candidatesAccepted: stats.candidatesAccepted,
    codesImported: stats.codesImported,
    provenanceRecorded: stats.provenanceRecorded,
    rejected,
    errors: [],
  });
  return true;
}
