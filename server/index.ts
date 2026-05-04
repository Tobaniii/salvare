import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import {
  buildCouponResponse,
  validateAdminBody,
  validateDomainParam,
} from "./coupons";
import { getAdminHtml } from "./admin";
import { validateResultBody } from "./results";
import { buildCorsHeaders } from "./cors";
import { rankCandidateCodes } from "./ranking";
import { buildCouponStats } from "./stats";
import { type Db } from "./db";
import {
  deleteCouponDomain,
  getAllSeedData,
  getCandidateCodesForDomain,
  upsertCouponCodes,
} from "./db-coupons";
import {
  appendResultRecord,
  deleteResultsForDomain,
  getResultsForDomain,
} from "./db-results";
import { buildExportPayloads } from "./db-maintenance";
import {
  importCouponsExport,
  importResultsExport,
  parseCouponsExport,
  parseResultsExport,
  summarizeCouponsPreview,
  summarizeResultsPreview,
} from "./db-import";
import { isAuthorized } from "./auth";
import {
  buildHealthFailureResponse,
  buildHealthResponse,
  SALVARE_VERSION,
} from "./health";

export interface SalvareServerOptions {
  db: Db;
  adminToken: string | null;
  /** Service version reported by GET /health. Defaults to SALVARE_VERSION. */
  version?: string;
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text) return {};
  return JSON.parse(text);
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

    if (req.method === "GET" && url.pathname === "/admin") {
      const html = getAdminHtml();
      if (!html) {
        sendJson(res, 404, { error: "admin page not found" });
        return;
      }
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(html);
      return;
    }

    if (req.method === "GET" && url.pathname === "/admin/coupon-stats") {
      if (!requireAuth(req, res)) return;
      const validation = validateDomainParam(url.searchParams.get("domain"));
      if (!validation.ok) {
        sendJson(res, 400, { error: validation.error });
        return;
      }
      const codes = getCandidateCodesForDomain(db, validation.domain);
      const history = getResultsForDomain(db, validation.domain);
      sendJson(res, 200, {
        domain: validation.domain,
        codes: buildCouponStats(codes, history),
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/admin/coupons") {
      if (!requireAuth(req, res)) return;
      sendJson(res, 200, {
        coupons: getAllSeedData(db),
        updatedAt: new Date().toISOString(),
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/admin/export/coupons") {
      if (!requireAuth(req, res)) return;
      const { coupons } = buildExportPayloads(db);
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      res.setHeader(
        "Content-Disposition",
        'attachment; filename="salvare-coupons-export.json"',
      );
      res.end(JSON.stringify(coupons));
      return;
    }

    if (
      req.method === "POST" &&
      url.pathname === "/admin/import/preview/coupons"
    ) {
      if (!requireAuth(req, res)) return;
      let body: unknown;
      try {
        body = await readJsonBody(req);
      } catch {
        sendJson(res, 400, { ok: false, error: "invalid import payload" });
        return;
      }
      const parsed = parseCouponsExport(body);
      if (!parsed.ok) {
        console.warn("Salvare import preview rejected coupons payload");
        sendJson(res, 400, { ok: false, error: "invalid import payload" });
        return;
      }
      sendJson(res, 200, summarizeCouponsPreview(parsed.value));
      return;
    }

    if (
      req.method === "POST" &&
      url.pathname === "/admin/import/preview/results"
    ) {
      if (!requireAuth(req, res)) return;
      let body: unknown;
      try {
        body = await readJsonBody(req);
      } catch {
        sendJson(res, 400, { ok: false, error: "invalid import payload" });
        return;
      }
      const parsed = parseResultsExport(body);
      if (!parsed.ok) {
        console.warn("Salvare import preview rejected results payload");
        sendJson(res, 400, { ok: false, error: "invalid import payload" });
        return;
      }
      sendJson(res, 200, summarizeResultsPreview(parsed.value));
      return;
    }

    if (
      req.method === "POST" &&
      url.pathname === "/admin/import/apply/coupons"
    ) {
      if (!requireAuth(req, res)) return;
      let body: unknown;
      try {
        body = await readJsonBody(req);
      } catch {
        sendJson(res, 400, { ok: false, error: "invalid import payload" });
        return;
      }
      const parsed = parseCouponsExport(body);
      if (!parsed.ok) {
        console.warn("Salvare import apply rejected coupons payload");
        sendJson(res, 400, { ok: false, error: "invalid import payload" });
        return;
      }
      const stats = importCouponsExport(db, parsed.value);
      sendJson(res, 200, {
        ok: true,
        type: "coupons",
        domainsImported: Object.keys(parsed.value).length,
        codesImported: stats.codesImported,
      });
      return;
    }

    if (
      req.method === "POST" &&
      url.pathname === "/admin/import/apply/results"
    ) {
      if (!requireAuth(req, res)) return;
      let body: unknown;
      try {
        body = await readJsonBody(req);
      } catch {
        sendJson(res, 400, { ok: false, error: "invalid import payload" });
        return;
      }
      const parsed = parseResultsExport(body);
      if (!parsed.ok) {
        console.warn("Salvare import apply rejected results payload");
        sendJson(res, 400, { ok: false, error: "invalid import payload" });
        return;
      }
      const stats = importResultsExport(db, parsed.value);
      sendJson(res, 200, {
        ok: true,
        type: "results",
        recordsImported: stats.resultsImported,
        domainsReplaced: stats.domainsReplaced,
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/admin/export/results") {
      if (!requireAuth(req, res)) return;
      const { results } = buildExportPayloads(db);
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      res.setHeader(
        "Content-Disposition",
        'attachment; filename="salvare-results-export.json"',
      );
      res.end(JSON.stringify(results));
      return;
    }

    if (req.method === "DELETE" && url.pathname === "/admin/coupons") {
      if (!requireAuth(req, res)) return;
      const validation = validateDomainParam(url.searchParams.get("domain"));
      if (!validation.ok) {
        sendJson(res, 400, { error: validation.error });
        return;
      }
      const result = deleteCouponDomain(db, validation.domain);
      if (!result.deleted) {
        sendJson(res, 404, {
          error: "domain not seeded",
          domain: result.domain,
        });
        return;
      }
      sendJson(res, 200, { deleted: true, domain: result.domain });
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

    if (req.method === "POST" && url.pathname === "/admin/coupons") {
      if (!requireAuth(req, res)) return;
      let body: unknown;
      try {
        body = await readJsonBody(req);
      } catch {
        sendJson(res, 400, { error: "invalid json" });
        return;
      }

      const validation = validateAdminBody(body);
      if (!validation.ok) {
        sendJson(res, 400, { error: validation.error });
        return;
      }

      const result = upsertCouponCodes(
        db,
        validation.domain,
        validation.candidateCodes,
      );
      sendJson(res, 200, result);
      return;
    }

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
