import { getAdminHtml } from "./admin";
import { validateAdminBody, validateDomainParam } from "./coupons";
import {
  deleteCouponDomain,
  getAllSeedData,
  getCandidateCodesForDomain,
  upsertCouponCodes,
} from "./db-coupons";
import { getResultsForDomain } from "./db-results";
import { buildCouponStats } from "./stats";
import { readJsonBody, sendJson, type RouteContext } from "./http-helpers";

export async function handleAdminCoreRoute(
  ctx: RouteContext,
): Promise<boolean> {
  const { db, req, res, url, requireAuth } = ctx;

  if (req.method === "GET" && url.pathname === "/admin") {
    const html = getAdminHtml();
    if (!html) {
      sendJson(res, 404, { error: "admin page not found" });
      return true;
    }
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(html);
    return true;
  }

  if (req.method === "GET" && url.pathname === "/admin/coupon-stats") {
    if (!requireAuth(req, res)) return true;
    const validation = validateDomainParam(url.searchParams.get("domain"));
    if (!validation.ok) {
      sendJson(res, 400, { error: validation.error });
      return true;
    }
    const codes = getCandidateCodesForDomain(db, validation.domain);
    const history = getResultsForDomain(db, validation.domain);
    sendJson(res, 200, {
      domain: validation.domain,
      codes: buildCouponStats(codes, history),
    });
    return true;
  }

  if (req.method === "GET" && url.pathname === "/admin/coupons") {
    if (!requireAuth(req, res)) return true;
    sendJson(res, 200, {
      coupons: getAllSeedData(db),
      updatedAt: new Date().toISOString(),
    });
    return true;
  }

  if (req.method === "DELETE" && url.pathname === "/admin/coupons") {
    if (!requireAuth(req, res)) return true;
    const validation = validateDomainParam(url.searchParams.get("domain"));
    if (!validation.ok) {
      sendJson(res, 400, { error: validation.error });
      return true;
    }
    const result = deleteCouponDomain(db, validation.domain);
    if (!result.deleted) {
      sendJson(res, 404, {
        error: "domain not seeded",
        domain: result.domain,
      });
      return true;
    }
    sendJson(res, 200, { deleted: true, domain: result.domain });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/admin/coupons") {
    if (!requireAuth(req, res)) return true;
    let body: unknown;
    try {
      body = await readJsonBody(req);
    } catch {
      sendJson(res, 400, { error: "invalid json" });
      return true;
    }

    const validation = validateAdminBody(body);
    if (!validation.ok) {
      sendJson(res, 400, { error: validation.error });
      return true;
    }

    const result = upsertCouponCodes(
      db,
      validation.domain,
      validation.candidateCodes,
    );
    sendJson(res, 200, result);
    return true;
  }

  return false;
}
