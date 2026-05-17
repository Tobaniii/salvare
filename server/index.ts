import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import {
  buildCouponResponse,
  buildSafeProvenance,
  validateDomainParam,
} from "./coupons";
import { normalizeLookupDomain } from "./domain-normalize";
import { getCandidateProvenanceForDomain } from "./db-coupon-provenance";
import { validateResultBody } from "./results";
import { buildCorsHeaders } from "./cors";
import { rankCandidateCodes } from "./ranking";
import { type Db } from "./db";
import { getCandidateCodesForDomain } from "./db-coupons";
import {
  appendResultRecord,
  deleteResultsForDomain,
  getResultsForDomain,
} from "./db-results";
import { isAuthorized } from "./auth";
import {
  buildHealthFailureResponse,
  buildHealthResponse,
  SALVARE_VERSION,
} from "./health";
import {
  readJsonBody,
  sendJson,
  type RouteContext,
} from "./http-helpers";
import { handleAdminCoreRoute } from "./admin-routes";
import { handleAdminExportRoute } from "./admin-export-routes";
import { handleAdminImportRoute } from "./admin-import-routes";
import {
  handleAdminSourcePreviewRoute,
  type AwinPreviewFn,
  type ProviderRouteResolver,
} from "./admin-source-preview-routes";
import { handleAdminSourceImportRoute } from "./admin-source-import-routes";
import { handleAdminSourceSummaryRoute } from "./admin-source-summary-routes";
import { handleAdminSourceStatusRoute } from "./admin-source-status-routes";
import {
  handleAdminSourceProvidersRoute,
  type ProviderListSource,
} from "./admin-source-providers-routes";
import { handleAdminImportHistoryRoute } from "./admin-import-history-routes";
import type { ProviderStatusFn } from "./db-source-status";
import { getSourceAwareCandidateOrder } from "./db-candidate-order";
import {
  createProviderRegistry,
  type ProviderRegistry,
} from "./source-provider-registry";
import type {
  ProviderFetcher,
  ProviderPreviewDeps,
} from "./source-provider-types";

export interface SalvareServerOptions {
  db: Db;
  adminToken: string | null;
  /** Service version reported by GET /health. Defaults to SALVARE_VERSION. */
  version?: string;
  /**
   * Optional Awin preview function used by `POST /admin/source-preview/awin`.
   * Tests inject a stub so the live Node `fetch` path is never reached. When
   * unset, the server constructs a default that reads `readAwinConfig(process.env)`
   * per request and only invokes the network when the feature flag and key
   * are both present (the adapter itself fails closed otherwise).
   */
  awinPreview?: AwinPreviewFn;
  /**
   * Optional per-source provider feature-flag / configured booleans used by
   * `GET /admin/source-status` (v0.40.0). Tests can inject a stub so the
   * handler stays env-free. When unset, the server consults
   * `readAwinConfig(process.env)` for the `awin` source and reports
   * `{ featureEnabled: false, configured: false }` for every other source.
   */
  providerStatus?: ProviderStatusFn;
  /**
   * Optional source-of-truth for the provider list returned by
   * `GET /admin/source-providers` (v0.44.0). Tests inject a stub so the
   * handler is exercised independently of the live registry; production wires
   * this to `registry.list()` so the admin UI gets the userExposed-only
   * subset (impact stays hidden in v0.44).
   */
  providerListSource?: ProviderListSource;
}

const DEFAULT_FETCHER: ProviderFetcher = async (url, init) => {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), init.timeoutMs);
  try {
    const resp = await fetch(url, {
      headers: init.headers,
      signal: ac.signal,
    });
    const text = await resp.text();
    return { status: resp.status, body: text };
  } finally {
    clearTimeout(timer);
  }
};

// v0.43.0 — Awin admin/CLI behavior unchanged on the wire; the default
// preview function and the default `providerStatus` callback are both
// derived from the internal provider registry so future milestones can flip
// capability gates without rewiring this module.

function createDefaultProviderStatus(
  registry: ProviderRegistry,
): ProviderStatusFn {
  return registry.asProviderStatusFn();
}

// v0.45.0 — generic provider preview/import routing. The single injected
// `awinPreview` is replaced by a registry-driven resolver bound to the
// default fetcher. The `options.awinPreview` test seam is preserved: when a
// route resolves the `awin` provider and an override was injected, the
// override closure is substituted (registry-authoritative metadata is still
// used). No generic per-provider override map exists yet — only the awin
// seam current tests rely on.
function createProviderRouteResolver(
  db: Db,
  registry: ProviderRegistry,
  awinOverride: AwinPreviewFn | undefined,
): ProviderRouteResolver {
  const baseDeps: ProviderPreviewDeps = { db, fetcher: DEFAULT_FETCHER };
  return (providerId, purpose) => {
    const resolved = registry.resolveProvider(providerId, purpose, baseDeps);
    if (!resolved.ok) return resolved;
    if (providerId === "awin" && awinOverride) {
      return {
        ok: true,
        descriptor: resolved.descriptor,
        closure: awinOverride,
      };
    }
    return resolved;
  };
}

export function createSalvareServer(options: SalvareServerOptions): Server {
  const { db, adminToken } = options;
  const version = options.version ?? SALVARE_VERSION;
  const registry = createProviderRegistry();
  const resolveProviderForRoute: ProviderRouteResolver =
    createProviderRouteResolver(db, registry, options.awinPreview);
  const providerStatus: ProviderStatusFn =
    options.providerStatus ?? createDefaultProviderStatus(registry);
  const providerListSource: ProviderListSource =
    options.providerListSource ?? (() => registry.list());

  function requireAuth(req: IncomingMessage, res: ServerResponse): boolean {
    if (isAuthorized(req.headers, adminToken)) return true;
    sendJson(res, 401, { error: "unauthorized" });
    return false;
  }

  async function handleRequest(req: IncomingMessage, res: ServerResponse) {
    const corsHeaders = buildCorsHeaders(req.headers.origin);
    if (corsHeaders) {
      for (const [key, value] of Object.entries(corsHeaders)) {
        res.setHeader(key, value);
      }
    }

    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      res.end();
      return;
    }

    if (!req.url || !req.method) {
      sendJson(res, 400, { error: "bad request" });
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);

    // Unprotected — exposes only coarse status booleans + service/version.
    // See server/health.ts for the redaction rationale.
    if (req.method === "GET" && url.pathname === "/health") {
      try {
        sendJson(
          res,
          200,
          buildHealthResponse({
            db,
            adminTokenConfigured: adminToken !== null,
            version,
          }),
        );
      } catch (err) {
        console.error("Salvare health check failed:", err);
        sendJson(res, 500, buildHealthFailureResponse());
      }
      return;
    }

    if (req.method === "GET" && url.pathname === "/coupons") {
      const rawDomain = url.searchParams.get("domain")?.trim();
      if (!rawDomain) {
        sendJson(res, 400, { error: "missing domain" });
        return;
      }
      // Conservative inbound-key normalization (v0.50.0). Stored rows are
      // canonical, so this is a no-op on existing data; it only makes
      // www/case/whitespace variants resolve to the same canonical key.
      const domain = normalizeLookupDomain(rawDomain);
      const codes = getCandidateCodesForDomain(db, domain);
      // Source-aware pre-rank (v0.38.0): re-orders codes using only
      // allowlisted provenance fields. Internal-only reordering — the
      // response shape and the set of codes returned are unchanged.
      // History-based `rankCandidateCodes` runs after this and continues
      // to dominate; this only seeds the input order for untested or
      // history-tied codes.
      const sourceOrdered = getSourceAwareCandidateOrder(db, domain, codes);
      const response = buildCouponResponse(domain, sourceOrdered);
      const ranked = rankCandidateCodes(
        response.candidateCodes,
        getResultsForDomain(db, domain),
      );
      // Additive, optional, allowlist-only per-code provenance (v0.50.0).
      // Built from the final ranked order; omitted entirely when no code
      // has any source claim. Never carries sourceId/sourceUrl/affiliate.
      const candidateProvenance = buildSafeProvenance(
        ranked,
        getCandidateProvenanceForDomain(db, domain),
      );
      sendJson(res, 200, {
        ...response,
        candidateCodes: ranked,
        ...(candidateProvenance ? { candidateProvenance } : {}),
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/results") {
      let body: unknown;
      try {
        body = await readJsonBody(req);
      } catch {
        sendJson(res, 400, { error: "invalid json" });
        return;
      }

      const validation = validateResultBody(body);
      if (!validation.ok) {
        sendJson(res, 400, { error: validation.error });
        return;
      }

      const stored = appendResultRecord(db, {
        domain: normalizeLookupDomain(validation.domain),
        code: validation.code,
        success: validation.success,
        savingsCents: validation.savingsCents,
        finalTotalCents: validation.finalTotalCents,
      });
      sendJson(res, 200, stored);
      return;
    }

    if (req.method === "DELETE" && url.pathname === "/results") {
      if (!requireAuth(req, res)) return;
      const validation = validateDomainParam(url.searchParams.get("domain"));
      if (!validation.ok) {
        sendJson(res, 400, { error: validation.error });
        return;
      }
      const result = deleteResultsForDomain(
        db,
        normalizeLookupDomain(validation.domain),
      );
      sendJson(res, 200, result);
      return;
    }

    if (req.method === "GET" && url.pathname === "/results") {
      const validation = validateDomainParam(url.searchParams.get("domain"));
      if (!validation.ok) {
        sendJson(res, 400, { error: validation.error });
        return;
      }

      const resultsDomain = normalizeLookupDomain(validation.domain);
      const records = getResultsForDomain(db, resultsDomain).map((r) => ({
        code: r.code,
        success: r.success,
        savingsCents: r.savingsCents,
        finalTotalCents: r.finalTotalCents,
        testedAt: r.testedAt,
      }));

      sendJson(res, 200, {
        domain: resultsDomain,
        results: records,
      });
      return;
    }

    const ctx: RouteContext = { db, req, res, url, requireAuth };
    if (await handleAdminCoreRoute(ctx)) return;
    if (handleAdminExportRoute(ctx)) return;
    if (await handleAdminImportRoute(ctx)) return;
    if (await handleAdminSourcePreviewRoute(ctx, resolveProviderForRoute))
      return;
    if (await handleAdminSourceImportRoute(ctx, resolveProviderForRoute))
      return;
    if (handleAdminSourceSummaryRoute(ctx)) return;
    if (handleAdminSourceStatusRoute(ctx, providerStatus)) return;
    if (handleAdminSourceProvidersRoute(ctx, providerListSource)) return;
    if (
      handleAdminImportHistoryRoute(
        ctx,
        (id) => registry.get(id) !== null,
      )
    )
      return;

    sendJson(res, 404, { error: "not found" });
  }

  return createServer((req, res) => {
    handleRequest(req, res).catch((err) => {
      console.error("Salvare server error:", err);
      if (!res.headersSent) {
        sendJson(res, 500, { error: "internal" });
      }
    });
  });
}
