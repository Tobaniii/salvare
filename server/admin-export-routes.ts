import { buildExportPayloads } from "./db-maintenance";
import { type RouteContext } from "./http-helpers";

export function handleAdminExportRoute(ctx: RouteContext): boolean {
  const { db, req, res, url, requireAuth } = ctx;

  if (req.method === "GET" && url.pathname === "/admin/export/coupons") {
    if (!requireAuth(req, res)) return true;
    const { coupons } = buildExportPayloads(db);
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="salvare-coupons-export.json"',
    );
    res.end(JSON.stringify(coupons));
    return true;
  }

  if (req.method === "GET" && url.pathname === "/admin/export/results") {
    if (!requireAuth(req, res)) return true;
    const { results } = buildExportPayloads(db);
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="salvare-results-export.json"',
    );
    res.end(JSON.stringify(results));
    return true;
  }

  return false;
}
