import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import {
  buildCouponResponse,
  deleteCoupons,
  getSeedData,
  loadSeedFromDisk,
  upsertCoupons,
  validateAdminBody,
  validateDomainParam,
} from "./coupons";
import { getAdminHtml } from "./admin";
import {
  appendResult,
  getResultsForDomain,
  loadResultsFromDisk,
  validateResultBody,
} from "./results";

const DEFAULT_PORT = 4123;
const port = Number(process.env.PORT ?? DEFAULT_PORT);

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

async function handleRequest(req: IncomingMessage, res: ServerResponse) {
  if (!req.url || !req.method) {
    sendJson(res, 400, { error: "bad request" });
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);

  if (req.method === "GET" && url.pathname === "/coupons") {
    const domain = url.searchParams.get("domain")?.trim();
    if (!domain) {
      sendJson(res, 400, { error: "missing domain" });
      return;
    }
    sendJson(res, 200, buildCouponResponse(domain));
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

  if (req.method === "GET" && url.pathname === "/admin/coupons") {
    sendJson(res, 200, {
      coupons: getSeedData(),
      updatedAt: new Date().toISOString(),
    });
    return;
  }

  if (req.method === "DELETE" && url.pathname === "/admin/coupons") {
    const validation = validateDomainParam(url.searchParams.get("domain"));
    if (!validation.ok) {
      sendJson(res, 400, { error: validation.error });
      return;
    }
    const result = deleteCoupons(validation.domain);
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

    const stored = appendResult({
      domain: validation.domain,
      code: validation.code,
      success: validation.success,
      savingsCents: validation.savingsCents,
      finalTotalCents: validation.finalTotalCents,
    });
    sendJson(res, 200, stored);
    return;
  }

  if (req.method === "GET" && url.pathname === "/results") {
    const validation = validateDomainParam(url.searchParams.get("domain"));
    if (!validation.ok) {
      sendJson(res, 400, { error: validation.error });
      return;
    }

    const records = getResultsForDomain(validation.domain).map((r) => ({
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

    const result = upsertCoupons(validation.domain, validation.candidateCodes);
    sendJson(res, 200, result);
    return;
  }

  sendJson(res, 404, { error: "not found" });
}

loadSeedFromDisk();
loadResultsFromDisk();

const server = createServer((req, res) => {
  handleRequest(req, res).catch((err) => {
    console.error("Salvare server error:", err);
    if (!res.headersSent) {
      sendJson(res, 500, { error: "internal" });
    }
  });
});
server.listen(port, () => {
  console.log(`Salvare coupon API listening on http://localhost:${port}`);
});
