import { type IncomingMessage, type ServerResponse } from "node:http";
import {
  importCouponsExport,
  importResultsExport,
  parseCouponsExport,
  parseResultsExport,
  summarizeCouponsPreview,
  summarizeResultsPreview,
} from "./db-import";
import { readJsonBody, sendJson, type RouteContext } from "./http-helpers";

type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

async function parseImportBody<T>(
  req: IncomingMessage,
  res: ServerResponse,
  parser: (body: unknown) => ParseResult<T>,
  rejectionLog: string,
): Promise<{ ok: true; value: T } | { ok: false }> {
  let body: unknown;
  try {
    body = await readJsonBody(req);
  } catch {
    sendJson(res, 400, { ok: false, error: "invalid import payload" });
    return { ok: false };
  }
  const parsed = parser(body);
  if (!parsed.ok) {
    console.warn(rejectionLog);
    sendJson(res, 400, { ok: false, error: "invalid import payload" });
    return { ok: false };
  }
  return { ok: true, value: parsed.value };
}

export async function handleAdminImportRoute(
  ctx: RouteContext,
): Promise<boolean> {
  const { db, req, res, url, requireAuth } = ctx;

  if (
    req.method === "POST" &&
    url.pathname === "/admin/import/preview/coupons"
  ) {
    if (!requireAuth(req, res)) return true;
    const result = await parseImportBody(
      req,
      res,
      parseCouponsExport,
      "Salvare import preview rejected coupons payload",
    );
    if (!result.ok) return true;
    sendJson(res, 200, summarizeCouponsPreview(result.value));
    return true;
  }

  if (
    req.method === "POST" &&
    url.pathname === "/admin/import/preview/results"
  ) {
    if (!requireAuth(req, res)) return true;
    const result = await parseImportBody(
      req,
      res,
      parseResultsExport,
      "Salvare import preview rejected results payload",
    );
    if (!result.ok) return true;
    sendJson(res, 200, summarizeResultsPreview(result.value));
    return true;
  }

  if (
    req.method === "POST" &&
    url.pathname === "/admin/import/apply/coupons"
  ) {
    if (!requireAuth(req, res)) return true;
    const result = await parseImportBody(
      req,
      res,
      parseCouponsExport,
      "Salvare import apply rejected coupons payload",
    );
    if (!result.ok) return true;
    const stats = importCouponsExport(db, result.value);
    sendJson(res, 200, {
      ok: true,
      type: "coupons",
      domainsImported: Object.keys(result.value).length,
      codesImported: stats.codesImported,
    });
    return true;
  }

  if (
    req.method === "POST" &&
    url.pathname === "/admin/import/apply/results"
  ) {
    if (!requireAuth(req, res)) return true;
    const result = await parseImportBody(
      req,
      res,
      parseResultsExport,
      "Salvare import apply rejected results payload",
    );
    if (!result.ok) return true;
    const stats = importResultsExport(db, result.value);
    sendJson(res, 200, {
      ok: true,
      type: "results",
      recordsImported: stats.resultsImported,
      domainsReplaced: stats.domainsReplaced,
    });
    return true;
  }

  return false;
}
