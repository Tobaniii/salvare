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

export interface SalvareServerOptions {
  db: Db;
  adminToken: string | null;
  /** Service version reported by GET /health. Defaults to SALVARE_VERSION. */
  version?: string;
}

export function createSalvareServer(options: SalvareServerOptions): Server {
  const { db, adminToken } = options;
  const version = options.version ?? SALVARE_VERSION;

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
      const response = buildCouponResponse(domain, codes);
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
