import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { buildCouponResponse, validateDomainParam } from "./coupons";
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
} from "./admin-source-preview-routes";
import { handleAdminSourceImportRoute } from "./admin-source-import-routes";
import { handleAdminSourceSummaryRoute } from "./admin-source-summary-routes";
import { getSourceAwareCandidateOrder } from "./db-candidate-order";
import { readAwinConfig, type AwinProviderConfig } from "./source-provider-config";
import {
  createAwinAdapter,
  type AwinFetcher,
  type AwinFetchInput,
} from "./source-provider-awin";

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
}

const DEFAULT_AWIN_FETCHER: AwinFetcher = async (url, init) => {
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

function createDefaultAwinPreview(db: Db): AwinPreviewFn {
  return (input: AwinFetchInput) => {
    const config = readAwinConfig(process.env);
    const adapter = createAwinAdapter({
      // The adapter validates `config.enabled` at call time; the disabled
      // branch never reaches the fetcher. Cast widens the union to the
      // enabled shape the adapter expects in its options type.
      config: config as AwinProviderConfig,
      fetcher: DEFAULT_AWIN_FETCHER,
      db,
    });
    return adapter.fetchAndParse(input);
  };
}

export function createSalvareServer(options: SalvareServerOptions): Server {
  const { db, adminToken } = options;
  const version = options.version ?? SALVARE_VERSION;
  const awinPreview: AwinPreviewFn =
    options.awinPreview ?? createDefaultAwinPreview(db);

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
      const domain = url.searchParams.get("domain")?.trim();
      if (!domain) {
        sendJson(res, 400, { error: "missing domain" });
        return;
      }
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
      sendJson(res, 200, { ...response, candidateCodes: ranked });
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
        domain: validation.domain,
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
      const result = deleteResultsForDomain(db, validation.domain);
      sendJson(res, 200, result);
      return;
    }

    if (req.method === "GET" && url.pathname === "/results") {
      const validation = validateDomainParam(url.searchParams.get("domain"));
      if (!validation.ok) {
        sendJson(res, 400, { error: validation.error });
        return;
      }

      const records = getResultsForDomain(db, validation.domain).map((r) => ({
        code: r.code,
        success: r.success,
        savingsCents: r.savingsCents,
        finalTotalCents: r.finalTotalCents,
        testedAt: r.testedAt,
      }));

      sendJson(res, 200, {
        domain: validation.domain,
        results: records,
      });
      return;
    }

    const ctx: RouteContext = { db, req, res, url, requireAuth };
    if (await handleAdminCoreRoute(ctx)) return;
    if (handleAdminExportRoute(ctx)) return;
    if (await handleAdminImportRoute(ctx)) return;
    if (await handleAdminSourcePreviewRoute(ctx, awinPreview)) return;
    if (await handleAdminSourceImportRoute(ctx, awinPreview)) return;
    if (handleAdminSourceSummaryRoute(ctx)) return;

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
