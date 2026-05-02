// server/index.ts
import {
  createServer
} from "node:http";
import { realpathSync } from "node:fs";
import { fileURLToPath as fileURLToPath4 } from "node:url";

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
import { dirname as dirname2, join as join2 } from "node:path";
import { fileURLToPath as fileURLToPath2 } from "node:url";
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
function initSchema(db) {
  db.exec(SCHEMA_SQL);
}
function openDatabase(path) {
  const db = new Database(path);
  db.pragma("foreign_keys = ON");
  initSchema(db);
  return db;
}
function defaultDatabasePath() {
  return join2(dirname2(fileURLToPath2(import.meta.url)), "salvare.db");
}

// server/db-bootstrap.ts
import { readFileSync as readFileSync2 } from "node:fs";
import { dirname as dirname3, join as join3 } from "node:path";
import { fileURLToPath as fileURLToPath3 } from "node:url";
var SERVER_DIR = dirname3(fileURLToPath3(import.meta.url));
var SEED_PATH = join3(SERVER_DIR, "coupons.seed.json");
var RESULTS_PATH = join3(SERVER_DIR, "coupon-results.json");
function importSeed(db, seed, now = (/* @__PURE__ */ new Date()).toISOString()) {
  const storeInsert = db.prepare(
    `INSERT OR IGNORE INTO stores (domain, created_at, updated_at) VALUES (?, ?, ?)`
  );
  const storeLookup = db.prepare(`SELECT id FROM stores WHERE domain = ?`);
  const codeInsert = db.prepare(
    `INSERT OR IGNORE INTO coupon_codes (store_id, code, created_at, updated_at) VALUES (?, ?, ?, ?)`
  );
  let storesImported = 0;
  let codesImported = 0;
  const txn = db.transaction((data) => {
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
    const raw = readFileSync2(SEED_PATH, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed;
    }
  } catch {
  }
  return {};
}
function readResultsFromDisk() {
  try {
    const raw = readFileSync2(RESULTS_PATH, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && Array.isArray(parsed.results)) {
      return parsed;
    }
  } catch {
  }
  return { results: [] };
}

// server/db-coupons.ts
function nowIso() {
  return (/* @__PURE__ */ new Date()).toISOString();
}
function getCandidateCodesForDomain(db, domain) {
  const trimmed = domain.trim();
  const rows = db.prepare(
    `SELECT c.code AS code
         FROM coupon_codes c
         JOIN stores s ON s.id = c.store_id
        WHERE s.domain = ?
        ORDER BY c.id ASC`
  ).all(trimmed);
  return rows.map((r) => r.code);
}
function getAllSeedData(db) {
  const rows = db.prepare(
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
function upsertCouponCodes(db, domain, codes) {
  const trimmedDomain = domain.trim();
  const normalizedCodes = [...new Set(codes.map((c) => c.trim()))];
  const now = nowIso();
  const upsertStore = db.prepare(
    `INSERT INTO stores (domain, created_at, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(domain) DO UPDATE SET updated_at = excluded.updated_at`
  );
  const lookupStore = db.prepare(
    `SELECT id FROM stores WHERE domain = ?`
  );
  const deleteCodes = db.prepare(
    `DELETE FROM coupon_codes WHERE store_id = ?`
  );
  const insertCode = db.prepare(
    `INSERT INTO coupon_codes (store_id, code, created_at, updated_at)
       VALUES (?, ?, ?, ?)`
  );
  const txn = db.transaction(() => {
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
function deleteCouponDomain(db, domain) {
  const trimmed = domain.trim();
  const result = db.prepare(`DELETE FROM stores WHERE domain = ?`).run(trimmed);
  return { deleted: result.changes > 0, domain: trimmed };
}
function bootstrapIfEmpty(db, seedOverride) {
  const count = db.prepare(`SELECT COUNT(*) AS c FROM stores`).get().c;
  if (count > 0) {
    return { bootstrapped: false, storesImported: 0, codesImported: 0 };
  }
  const seed = seedOverride ?? readSeedFromDisk();
  const stats = importSeed(db, seed);
  return {
    bootstrapped: true,
    storesImported: stats.storesImported,
    codesImported: stats.codesImported
  };
}

// server/db-results.ts
function nowIso2() {
  return (/* @__PURE__ */ new Date()).toISOString();
}
function rowToRecord(row) {
  return {
    domain: row.domain,
    code: row.code,
    success: row.success === 1,
    savingsCents: row.savings_cents,
    finalTotalCents: row.final_total_cents,
    testedAt: row.tested_at
  };
}
function appendResultRecord(db, record, now = () => /* @__PURE__ */ new Date()) {
  const testedAt = now().toISOString();
  const upsertStore = db.prepare(
    `INSERT INTO stores (domain, created_at, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(domain) DO UPDATE SET updated_at = excluded.updated_at`
  );
  const lookupStore = db.prepare(`SELECT id FROM stores WHERE domain = ?`);
  const insertResult = db.prepare(
    `INSERT INTO coupon_results
       (store_id, code, success, savings_cents, final_total_cents, tested_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  const txn = db.transaction(() => {
    upsertStore.run(record.domain, testedAt, testedAt);
    const storeRow = lookupStore.get(record.domain);
    if (!storeRow) {
      throw new Error("store row missing after upsert");
    }
    insertResult.run(
      storeRow.id,
      record.code,
      record.success ? 1 : 0,
      record.savingsCents,
      record.finalTotalCents,
      testedAt
    );
  });
  txn();
  return { ...record, testedAt };
}
function getResultsForDomain(db, domain) {
  const trimmed = domain.trim();
  const rows = db.prepare(
    `SELECT s.domain AS domain,
              r.code AS code,
              r.success AS success,
              r.savings_cents AS savings_cents,
              r.final_total_cents AS final_total_cents,
              r.tested_at AS tested_at
         FROM coupon_results r
         JOIN stores s ON s.id = r.store_id
        WHERE s.domain = ?
        ORDER BY r.id ASC`
  ).all(trimmed);
  return rows.map(rowToRecord);
}
function deleteResultsForDomain(db, domain) {
  const trimmed = domain.trim();
  const result = db.prepare(
    `DELETE FROM coupon_results
        WHERE store_id IN (SELECT id FROM stores WHERE domain = ?)`
  ).run(trimmed);
  return { domain: trimmed, deletedCount: result.changes };
}
function bootstrapResultsIfEmpty(db, envelopeOverride) {
  const count = db.prepare(`SELECT COUNT(*) AS c FROM coupon_results`).get().c;
  if (count > 0) {
    return { bootstrapped: false, resultsImported: 0 };
  }
  const envelope = envelopeOverride ?? readResultsFromDisk();
  const records = Array.isArray(envelope?.results) ? envelope.results : [];
  if (records.length === 0) {
    return { bootstrapped: false, resultsImported: 0 };
  }
  const now = nowIso2();
  const upsertStore = db.prepare(
    `INSERT OR IGNORE INTO stores (domain, created_at, updated_at)
       VALUES (?, ?, ?)`
  );
  const lookupStore = db.prepare(`SELECT id FROM stores WHERE domain = ?`);
  const insertResult = db.prepare(
    `INSERT INTO coupon_results
       (store_id, code, success, savings_cents, final_total_cents, tested_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  let resultsImported = 0;
  const txn = db.transaction(() => {
    for (const r of records) {
      upsertStore.run(r.domain, now, now);
      const storeRow = lookupStore.get(r.domain);
      if (!storeRow) continue;
      insertResult.run(
        storeRow.id,
        r.code,
        r.success ? 1 : 0,
        r.savingsCents,
        r.finalTotalCents,
        r.testedAt
      );
      resultsImported++;
    }
  });
  txn();
  return { bootstrapped: true, resultsImported };
}

// server/auth.ts
import { timingSafeEqual } from "node:crypto";
function readAdminTokenFromEnv(env = process.env) {
  const raw = env.SALVARE_ADMIN_TOKEN;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}
function constantTimeEquals(a, b) {
  const aBuf = Buffer.from(a, "utf8");
  const bBuf = Buffer.from(b, "utf8");
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}
function isAuthorized(headers, configuredToken) {
  if (configuredToken === null) return true;
  const header = headers.authorization;
  if (typeof header !== "string") return false;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match) return false;
  return constantTimeEquals(match[1].trim(), configuredToken);
}

// server/index.ts
var DEFAULT_PORT = 4123;
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
function createSalvareServer(options) {
  const { db, adminToken } = options;
  function requireAuth(req, res) {
    if (isAuthorized(req.headers, adminToken)) return true;
    sendJson(res, 401, { error: "unauthorized" });
    return false;
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
        getResultsForDomain(db, domain)
      );
      sendJson(res, 200, { ...response, candidateCodes: ranked });
      return;
    }
    if (req.method === "GET" && url.pathname === "/admin") {
      if (!requireAuth(req, res)) return;
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
        codes: buildCouponStats(codes, history)
      });
      return;
    }
    if (req.method === "GET" && url.pathname === "/admin/coupons") {
      if (!requireAuth(req, res)) return;
      sendJson(res, 200, {
        coupons: getAllSeedData(db),
        updatedAt: (/* @__PURE__ */ new Date()).toISOString()
      });
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
      const stored = appendResultRecord(db, {
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
        testedAt: r.testedAt
      }));
      sendJson(res, 200, {
        domain: validation.domain,
        results: records
      });
      return;
    }
    if (req.method === "POST" && url.pathname === "/admin/coupons") {
      if (!requireAuth(req, res)) return;
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
  return createServer((req, res) => {
    handleRequest(req, res).catch((err) => {
      console.error("Salvare server error:", err);
      if (!res.headersSent) {
        sendJson(res, 500, { error: "internal" });
      }
    });
  });
}
function main() {
  const port = Number(process.env.PORT ?? DEFAULT_PORT);
  const db = openDatabase(defaultDatabasePath());
  const bootstrapStats = bootstrapIfEmpty(db);
  if (bootstrapStats.bootstrapped) {
    console.log(
      `Salvare bootstrap on startup: imported ${bootstrapStats.storesImported} store(s) and ${bootstrapStats.codesImported} code(s) from coupons.seed.json`
    );
  }
  const resultsBootstrapStats = bootstrapResultsIfEmpty(db);
  if (resultsBootstrapStats.bootstrapped) {
    console.log(
      `Salvare bootstrap on startup: imported ${resultsBootstrapStats.resultsImported} result record(s) from coupon-results.json`
    );
  }
  const adminToken = readAdminTokenFromEnv();
  if (adminToken) {
    console.log(
      "Salvare admin auth: ENABLED (Authorization: Bearer <token> required for /admin* and DELETE /results)"
    );
  } else {
    console.log(
      "Salvare admin auth: DISABLED (set SALVARE_ADMIN_TOKEN to require a Bearer token; intended for local dev)"
    );
  }
  const server = createSalvareServer({ db, adminToken });
  server.listen(port, () => {
    console.log(`Salvare coupon API listening on http://localhost:${port}`);
  });
}
function isEntryPoint() {
  const argv1 = process.argv[1];
  if (!argv1) return false;
  try {
    return realpathSync(argv1) === fileURLToPath4(import.meta.url);
  } catch {
    return false;
  }
}
if (isEntryPoint()) {
  main();
}
export {
  createSalvareServer
};
