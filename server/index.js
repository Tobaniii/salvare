// server/index.ts
import { createServer } from "node:http";

// server/coupons.ts
var SEED_DATA = {
  localhost: ["SAVE10", "TAKE15", "FREESHIP"],
  "salvare-test-store.myshopify.com": ["WELCOME10", "SAVE15", "FREESHIP"],
  "salvare-woo-test.local": ["WELCOME10", "TAKE20", "FREESHIP"]
};
function buildCouponResponse(domain, now = () => /* @__PURE__ */ new Date()) {
  const codes = SEED_DATA[domain];
  if (codes && codes.length > 0) {
    return {
      domain,
      candidateCodes: codes,
      source: "mock-backend",
      updatedAt: now().toISOString()
    };
  }
  return {
    domain,
    candidateCodes: [],
    source: "none",
    updatedAt: now().toISOString()
  };
}

// server/index.ts
var DEFAULT_PORT = 4123;
var port = Number(process.env.PORT ?? DEFAULT_PORT);
function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}
function handleRequest(req, res) {
  if (!req.url || !req.method) {
    sendJson(res, 400, { error: "bad request" });
    return;
  }
  const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);
  if (req.method !== "GET" || url.pathname !== "/coupons") {
    sendJson(res, 404, { error: "not found" });
    return;
  }
  const domain = url.searchParams.get("domain")?.trim();
  if (!domain) {
    sendJson(res, 400, { error: "missing domain" });
    return;
  }
  sendJson(res, 200, buildCouponResponse(domain));
}
var server = createServer(handleRequest);
server.listen(port, () => {
  console.log(`Salvare coupon API listening on http://localhost:${port}`);
});
