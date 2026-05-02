// server/index.ts
import { createServer } from "node:http";

// server/coupons.ts
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// server/coupons.seed.json
var coupons_seed_default = {
  localhost: [
    "SAVE10",
    "TAKE15",
    "FREESHIP"
  ],
  "salvare-test-store.myshopify.com": [
    "WELCOME10",
    "SAVE15",
    "FREESHIP"
  ],
  "salvare-woo-test.local": [
    "WELCOME10",
    "TAKE20",
    "FREESHIP"
  ],
  "example-store.com": [
    "WELCOME10",
    "SAVE15"
  ]
};

// server/coupons.ts
var BUNDLED_DEFAULT = coupons_seed_default && typeof coupons_seed_default === "object" ? coupons_seed_default : {};
var runtimeSeed = { ...BUNDLED_DEFAULT };
var SEED_FILE_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "coupons.seed.json"
);
function persistToDisk() {
  const tmpPath = `${SEED_FILE_PATH}.tmp`;
  writeFileSync(
    tmpPath,
    JSON.stringify(runtimeSeed, null, 2) + "\n",
    "utf8"
  );
  renameSync(tmpPath, SEED_FILE_PATH);
}
var persistFn = persistToDisk;
function isValidSeedShape(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.values(value).every(
    (codes) => Array.isArray(codes) && codes.every((c) => typeof c === "string")
  );
}
function loadSeedFromDisk() {
  try {
    const raw = readFileSync(SEED_FILE_PATH, "utf8");
    const parsed = JSON.parse(raw);
    if (isValidSeedShape(parsed)) {
      runtimeSeed = parsed;
    }
  } catch {
  }
}
function getSeedData() {
  return { ...runtimeSeed };
}
function buildCouponResponse(domain, now = () => /* @__PURE__ */ new Date()) {
  const codes = runtimeSeed[domain];
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
function validateAdminBody(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "body must be an object" };
  }
  const b = body;
  if (typeof b.domain !== "string" || b.domain.trim().length === 0) {
    return { ok: false, error: "domain must be a non-empty string" };
  }
  if (!Array.isArray(b.candidateCodes)) {
    return { ok: false, error: "candidateCodes must be an array" };
  }
  for (const code of b.candidateCodes) {
    if (typeof code !== "string" || code.trim().length === 0) {
      return {
        ok: false,
        error: "candidateCodes must contain only non-empty strings"
      };
    }
  }
  return {
    ok: true,
    domain: b.domain.trim(),
    candidateCodes: b.candidateCodes
  };
}
function upsertCoupons(domain, codes) {
  const normalized = [...new Set(codes.map((c) => c.trim()))];
  runtimeSeed[domain] = normalized;
  persistFn();
  return { domain, candidateCodes: normalized };
}

// server/admin.ts
import { readFileSync as readFileSync2 } from "node:fs";
import { dirname as dirname2, join as join2 } from "node:path";
import { fileURLToPath as fileURLToPath2 } from "node:url";
var ADMIN_HTML_PATH = join2(
  dirname2(fileURLToPath2(import.meta.url)),
  "admin.html"
);
var cachedHtml = null;
function getAdminHtml() {
  if (cachedHtml !== null) return cachedHtml;
  try {
    cachedHtml = readFileSync2(ADMIN_HTML_PATH, "utf8");
  } catch {
    cachedHtml = "";
  }
  return cachedHtml;
}

// server/index.ts
var DEFAULT_PORT = 4123;
var port = Number(process.env.PORT ?? DEFAULT_PORT);
function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}
async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text) return {};
  return JSON.parse(text);
}
async function handleRequest(req, res) {
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
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    });
    return;
  }
  if (req.method === "POST" && url.pathname === "/admin/coupons") {
    let body;
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
var server = createServer((req, res) => {
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
