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
  ],
  "refxem.com": [
    "PRELUV10",
    "NICHE",
    "WELCOME15"
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
function deleteCoupons(domain) {
  const trimmed = domain.trim();
  if (!(trimmed in runtimeSeed)) {
    return { deleted: false, domain: trimmed };
  }
  delete runtimeSeed[trimmed];
  persistFn();
  return { deleted: true, domain: trimmed };
}
function validateDomainParam(raw) {
  if (typeof raw !== "string") {
    return { ok: false, error: "missing domain" };
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { ok: false, error: "missing domain" };
  }
  return { ok: true, domain: trimmed };
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

// server/results.ts
import { readFileSync as readFileSync3, renameSync as renameSync2, writeFileSync as writeFileSync2 } from "node:fs";
import { dirname as dirname3, join as join3 } from "node:path";
import { fileURLToPath as fileURLToPath3 } from "node:url";
function validateResultBody(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "body must be an object" };
  }
  const b = body;
  if (typeof b.domain !== "string" || b.domain.trim().length === 0) {
    return { ok: false, error: "domain must be a non-empty string" };
  }
  if (typeof b.code !== "string" || b.code.trim().length === 0) {
    return { ok: false, error: "code must be a non-empty string" };
  }
  if (typeof b.success !== "boolean") {
    return { ok: false, error: "success must be a boolean" };
  }
  if (typeof b.savingsCents !== "number" || !Number.isInteger(b.savingsCents) || b.savingsCents < 0) {
    return {
      ok: false,
      error: "savingsCents must be a non-negative integer"
    };
  }
  if (typeof b.finalTotalCents !== "number" || !Number.isInteger(b.finalTotalCents) || b.finalTotalCents < 0) {
    return {
      ok: false,
      error: "finalTotalCents must be a non-negative integer"
    };
  }
  return {
    ok: true,
    domain: b.domain.trim(),
    code: b.code.trim(),
    success: b.success,
    savingsCents: b.savingsCents,
    finalTotalCents: b.finalTotalCents
  };
}
var runtimeResults = [];
var RESULTS_FILE_PATH = join3(
  dirname3(fileURLToPath3(import.meta.url)),
  "coupon-results.json"
);
function isValidResultRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const r = value;
  return typeof r.domain === "string" && typeof r.code === "string" && typeof r.success === "boolean" && typeof r.savingsCents === "number" && typeof r.finalTotalCents === "number" && typeof r.testedAt === "string";
}
function persistResultsToDisk() {
  const tmpPath = `${RESULTS_FILE_PATH}.tmp`;
  writeFileSync2(
    tmpPath,
    JSON.stringify({ results: runtimeResults }, null, 2) + "\n",
    "utf8"
  );
  renameSync2(tmpPath, RESULTS_FILE_PATH);
}
var persistFn2 = persistResultsToDisk;
function loadResultsFromDisk() {
  try {
    const raw = readFileSync3(RESULTS_FILE_PATH, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && Array.isArray(parsed.results) && parsed.results.every(isValidResultRecord)) {
      runtimeResults = parsed.results;
    }
  } catch {
  }
}
function appendResult(record, now = () => /* @__PURE__ */ new Date()) {
  const stored = {
    ...record,
    testedAt: now().toISOString()
  };
  runtimeResults.push(stored);
  persistFn2();
  return stored;
}
function getResultsForDomain(domain) {
  const trimmed = domain.trim();
  return runtimeResults.filter((r) => r.domain === trimmed);
}
function deleteResultsForDomain(domain) {
  const trimmed = domain.trim();
  const before = runtimeResults.length;
  runtimeResults = runtimeResults.filter((r) => r.domain !== trimmed);
  const deletedCount = before - runtimeResults.length;
  if (deletedCount > 0) {
    persistFn2();
  }
  return { domain: trimmed, deletedCount };
}

// server/cors.ts
var ALLOWED_ORIGINS = /* @__PURE__ */ new Set([
  "http://localhost",
  "http://localhost:5173",
  "http://salvare-woo-test.local",
  "https://salvare-test-store.myshopify.com"
]);
function buildCorsHeaders(origin) {
  if (!origin || !ALLOWED_ORIGINS.has(origin)) return null;
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
}

// server/ranking.ts
var BUCKET_ORDER = {
  success: 0,
  none: 1,
  failure: 2
};
function rankCandidateCodes(codes, history) {
  const stats = /* @__PURE__ */ new Map();
  for (const code of codes) {
    stats.set(code, { successes: [], failures: [] });
  }
  for (const record of history) {
    const entry = stats.get(record.code);
    if (!entry) continue;
    if (record.success) entry.successes.push(record);
    else entry.failures.push(record);
  }
  const ranked = codes.map((code, seedIndex) => {
    const entry = stats.get(code);
    if (entry.successes.length > 0) {
      const total = entry.successes.reduce((sum, r) => sum + r.savingsCents, 0);
      const averageSavings = total / entry.successes.length;
      const mostRecentSuccessAt = entry.successes.map((r) => r.testedAt).reduce((latest, t) => t > latest ? t : latest, "");
      return {
        code,
        seedIndex,
        bucket: "success",
        averageSavings,
        mostRecentSuccessAt
      };
    }
    if (entry.failures.length > 0) {
      return {
        code,
        seedIndex,
        bucket: "failure",
        averageSavings: 0,
        mostRecentSuccessAt: ""
      };
    }
    return {
      code,
      seedIndex,
      bucket: "none",
      averageSavings: 0,
      mostRecentSuccessAt: ""
    };
  });
  ranked.sort((a, b) => {
    if (BUCKET_ORDER[a.bucket] !== BUCKET_ORDER[b.bucket]) {
      return BUCKET_ORDER[a.bucket] - BUCKET_ORDER[b.bucket];
    }
    if (a.bucket === "success") {
      if (a.averageSavings !== b.averageSavings) {
        return b.averageSavings - a.averageSavings;
      }
      if (a.mostRecentSuccessAt !== b.mostRecentSuccessAt) {
        return b.mostRecentSuccessAt.localeCompare(a.mostRecentSuccessAt);
      }
    }
    return a.seedIndex - b.seedIndex;
  });
  return ranked.map((r) => r.code);
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
  if (req.method === "GET" && url.pathname === "/coupons") {
    const domain = url.searchParams.get("domain")?.trim();
    if (!domain) {
      sendJson(res, 400, { error: "missing domain" });
      return;
    }
    const response = buildCouponResponse(domain);
    const ranked = rankCandidateCodes(
      response.candidateCodes,
      getResultsForDomain(domain)
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
  if (req.method === "GET" && url.pathname === "/admin/coupons") {
    sendJson(res, 200, {
      coupons: getSeedData(),
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
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
        domain: result.domain
      });
      return;
    }
    sendJson(res, 200, { deleted: true, domain: result.domain });
    return;
  }
  if (req.method === "POST" && url.pathname === "/results") {
    let body;
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
      finalTotalCents: validation.finalTotalCents
    });
    sendJson(res, 200, stored);
    return;
  }
  if (req.method === "DELETE" && url.pathname === "/results") {
    const validation = validateDomainParam(url.searchParams.get("domain"));
    if (!validation.ok) {
      sendJson(res, 400, { error: validation.error });
      return;
    }
    const result = deleteResultsForDomain(validation.domain);
    sendJson(res, 200, result);
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
      testedAt: r.testedAt
    }));
    sendJson(res, 200, {
      domain: validation.domain,
      results: records
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
loadResultsFromDisk();
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
