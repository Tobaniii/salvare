import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { buildCouponResponse } from "./coupons";

const DEFAULT_PORT = 4123;
const port = Number(process.env.PORT ?? DEFAULT_PORT);

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

function handleRequest(req: IncomingMessage, res: ServerResponse) {
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

const server = createServer(handleRequest);
server.listen(port, () => {
  console.log(`Salvare coupon API listening on http://localhost:${port}`);
});
