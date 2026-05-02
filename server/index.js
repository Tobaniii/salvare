// server/index.ts
import { createServer } from "node:http";

// server/coupons.ts
function buildCouponResponse(domain, candidateCodes, now = () => /* @__PURE__ */ new Date()) {
  const updatedAt = now().toISOString();
  if (candidateCodes.length > 0) {
    return {
      domain,
      candidateCodes,
      source: "mock-backend",
      updatedAt
    };
  }
  return {
    domain,
    candidateCodes: [],
    source: "none",
    updatedAt
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
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
var ADMIN_HTML_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "admin.html"
);
var cachedHtml = null;
function getAdminHtml() {
  if (cachedHtml !== null) return cachedHtml;
  try {
    cachedHtml = readFileSync(ADMIN_HTML_PATH, "utf8");
  } catch {
    cachedHtml = "";
  }
  return cachedHtml;
}

// server/results.ts
import { readFileSync as readFileSync2, renameSync, writeFileSync } from "node:fs";
import { dirname as dirname2, join as join2 } from "node:path";
import { fileURLToPath as fileURLToPath2 } from "node:url";
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
var RESULTS_FILE_PATH = join2(
  dirname2(fileURLToPath2(import.meta.url)),
  "coupon-results.json"
);
function isValidResultRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const r = value;
  return typeof r.domain === "string" && typeof r.code === "string" && typeof r.success === "boolean" && typeof r.savingsCents === "number" && typeof r.finalTotalCents === "number" && typeof r.testedAt === "string";
}
function persistResultsToDisk() {
  const tmpPath = `${RESULTS_FILE_PATH}.tmp`;
  writeFileSync(
    tmpPath,
    JSON.stringify({ results: runtimeResults }, null, 2) + "\n",
    "utf8"
  );
  renameSync(tmpPath, RESULTS_FILE_PATH);
}
var persistFn = persistResultsToDisk;
function loadResultsFromDisk() {
  try {
    const raw = readFileSync2(RESULTS_FILE_PATH, "utf8");
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
  persistFn();
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
    persistFn();
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

// server/stats.ts
function buildCouponStats(codes, history) {
  const codeSet = new Set(codes);
  const successes = /* @__PURE__ */ new Map();
  const failures = /* @__PURE__ */ new Map();
  for (const code of codes) {
    successes.set(code, []);
    failures.set(code, []);
  }
  for (const record of history) {
    if (!codeSet.has(record.code)) continue;
    if (record.success) {
      successes.get(record.code).push(record);
    } else {
      failures.get(record.code).push(record);
    }
  }
  const ranked = rankCandidateCodes(codes, history);
  return ranked.map((code, index) => {
    const codeSuccesses = successes.get(code) ?? [];
    const codeFailures = failures.get(code) ?? [];
    let averageSavingsCents = null;
    let lastSuccessAt = null;
    if (codeSuccesses.length > 0) {
      const total = codeSuccesses.reduce((sum, r) => sum + r.savingsCents, 0);
      averageSavingsCents = Math.round(total / codeSuccesses.length);
      lastSuccessAt = codeSuccesses.map((r) => r.testedAt).reduce((latest, t) => t > latest ? t : latest, "");
    }
    return {
      code,
      rank: index + 1,
      successCount: codeSuccesses.length,
      failureCount: codeFailures.length,
      averageSavingsCents,
      lastSuccessAt
    };
  });
}

// server/db.ts
import Database from "better-sqlite3";
import { dirname as dirname3, join as join3 } from "node:path";
import { fileURLToPath as fileURLToPath3 } from "node:url";
var SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS stores (
    id INTEGER PRIMARY KEY,
    domain TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS coupon_codes (
    id INTEGER PRIMARY KEY,
    store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    code TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(store_id, code)
  );

  CREATE TABLE IF NOT EXISTS coupon_results (
    id INTEGER PRIMARY KEY,
    store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    code TEXT NOT NULL,
    success INTEGER NOT NULL,
    savings_cents INTEGER NOT NULL,
    final_total_cents INTEGER NOT NULL,
    tested_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_coupon_results_store_code
    ON coupon_results(store_id, code);

  CREATE INDEX IF NOT EXISTS idx_coupon_results_tested_at
    ON coupon_results(tested_at);
`;
function initSchema(db2) {
  db2.exec(SCHEMA_SQL);
}
function openDatabase(path) {
  const db2 = new Database(path);
  db2.pragma("foreign_keys = ON");
  initSchema(db2);
  return db2;
}
function defaultDatabasePath() {
  return join3(dirname3(fileURLToPath3(import.meta.url)), "salvare.db");
}

// server/db-bootstrap.ts
import { readFileSync as readFileSync3 } from "node:fs";
import { dirname as dirname4, join as join4 } from "node:path";
import { fileURLToPath as fileURLToPath4 } from "node:url";
var SERVER_DIR = dirname4(fileURLToPath4(import.meta.url));
var SEED_PATH = join4(SERVER_DIR, "coupons.seed.json");
var RESULTS_PATH = join4(SERVER_DIR, "coupon-results.json");
function importSeed(db2, seed, now = (/* @__PURE__ */ new Date()).toISOString()) {
  const storeInsert = db2.prepare(
    `INSERT OR IGNORE INTO stores (domain, created_at, updated_at) VALUES (?, ?, ?)`
  );
  const storeLookup = db2.prepare(`SELECT id FROM stores WHERE domain = ?`);
  const codeInsert = db2.prepare(
    `INSERT OR IGNORE INTO coupon_codes (store_id, code, created_at, updated_at) VALUES (?, ?, ?, ?)`
  );
  let storesImported = 0;
  let codesImported = 0;
  const txn = db2.transaction((data) => {
    for (const [domain, codeList] of Object.entries(data)) {
      const storeResult = storeInsert.run(domain, now, now);
      if (storeResult.changes > 0) storesImported++;
      const storeRow = storeLookup.get(domain);
      if (!storeRow) continue;
      const storeId = storeRow.id;
      for (const code of codeList) {
        const codeResult = codeInsert.run(storeId, code, now, now);
        if (codeResult.changes > 0) codesImported++;
      }
    }
  });
  txn(seed);
  return { storesImported, codesImported };
}
function readSeedFromDisk() {
  try {
    const raw = readFileSync3(SEED_PATH, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed;
    }
  } catch {
  }
  return {};
}

// server/db-coupons.ts
function nowIso() {
  return (/* @__PURE__ */ new Date()).toISOString();
}
function getCandidateCodesForDomain(db2, domain) {
  const trimmed = domain.trim();
  const rows = db2.prepare(
    `SELECT c.code AS code
         FROM coupon_codes c
         JOIN stores s ON s.id = c.store_id
        WHERE s.domain = ?
        ORDER BY c.id ASC`
  ).all(trimmed);
  return rows.map((r) => r.code);
}
function getAllSeedData(db2) {
  const rows = db2.prepare(
    `SELECT s.domain AS domain, c.code AS code
         FROM stores s
         LEFT JOIN coupon_codes c ON c.store_id = s.id
        ORDER BY s.id ASC, c.id ASC`
  ).all();
  const result = {};
  for (const row of rows) {
    if (!result[row.domain]) result[row.domain] = [];
    if (row.code !== null) result[row.domain].push(row.code);
  }
  return result;
}
function upsertCouponCodes(db2, domain, codes) {
  const trimmedDomain = domain.trim();
  const normalizedCodes = [...new Set(codes.map((c) => c.trim()))];
  const now = nowIso();
  const upsertStore = db2.prepare(
    `INSERT INTO stores (domain, created_at, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(domain) DO UPDATE SET updated_at = excluded.updated_at`
  );
  const lookupStore = db2.prepare(
    `SELECT id FROM stores WHERE domain = ?`
  );
  const deleteCodes = db2.prepare(
    `DELETE FROM coupon_codes WHERE store_id = ?`
  );
  const insertCode = db2.prepare(
    `INSERT INTO coupon_codes (store_id, code, created_at, updated_at)
       VALUES (?, ?, ?, ?)`
  );
  const txn = db2.transaction(() => {
    upsertStore.run(trimmedDomain, now, now);
    const storeRow = lookupStore.get(trimmedDomain);
    if (!storeRow) {
      throw new Error("store row missing after upsert");
    }
    deleteCodes.run(storeRow.id);
    for (const code of normalizedCodes) {
      insertCode.run(storeRow.id, code, now, now);
    }
  });
  txn();
  return { domain: trimmedDomain, candidateCodes: normalizedCodes };
}
function deleteCouponDomain(db2, domain) {
  const trimmed = domain.trim();
  const result = db2.prepare(`DELETE FROM stores WHERE domain = ?`).run(trimmed);
  return { deleted: result.changes > 0, domain: trimmed };
}
function bootstrapIfEmpty(db2, seedOverride) {
  const count = db2.prepare(`SELECT COUNT(*) AS c FROM stores`).get().c;
  if (count > 0) {
    return { bootstrapped: false, storesImported: 0, codesImported: 0 };
  }
  const seed = seedOverride ?? readSeedFromDisk();
  const stats = importSeed(db2, seed);
  return {
    bootstrapped: true,
    storesImported: stats.storesImported,
    codesImported: stats.codesImported
  };
}

// server/index.ts
var DEFAULT_PORT = 4123;
var port = Number(process.env.PORT ?? DEFAULT_PORT);
var db = openDatabase(defaultDatabasePath());
var bootstrapStats = bootstrapIfEmpty(db);
if (bootstrapStats.bootstrapped) {
  console.log(
    `Salvare bootstrap on startup: imported ${bootstrapStats.storesImported} store(s) and ${bootstrapStats.codesImported} code(s) from coupons.seed.json`
  );
}
loadResultsFromDisk();
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
    const codes = getCandidateCodesForDomain(db, domain);
    const response = buildCouponResponse(domain, codes);
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
  if (req.method === "GET" && url.pathname === "/admin/coupon-stats") {
    const validation = validateDomainParam(url.searchParams.get("domain"));
    if (!validation.ok) {
      sendJson(res, 400, { error: validation.error });
      return;
    }
    const codes = getCandidateCodesForDomain(db, validation.domain);
    const history = getResultsForDomain(validation.domain);
    sendJson(res, 200, {
      domain: validation.domain,
      codes: buildCouponStats(codes, history)
    });
    return;
  }
  if (req.method === "GET" && url.pathname === "/admin/coupons") {
    sendJson(res, 200, {
      coupons: getAllSeedData(db),
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
    const result = deleteCouponDomain(db, validation.domain);
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
    const result = upsertCouponCodes(
      db,
      validation.domain,
      validation.candidateCodes
    );
    sendJson(res, 200, result);
    return;
  }
  sendJson(res, 404, { error: "not found" });
}
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
