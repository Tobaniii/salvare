// Coupon source / provenance helpers.
//
// Pure functions over the SQLite tables `coupon_sources` and
// `coupon_code_sources` introduced in v0.27.0. These helpers exist so future
// trusted source-ingestion milestones can record where candidate codes came
// from. No ingestion happens here.
//
// Helper outputs are deliberately redacted: nothing in this module returns
// raw source payloads, raw HTML, environment variables, request headers,
// auth tokens, cookies, localStorage, or filesystem paths. Callers that
// surface these rows (e.g. future admin endpoints) must keep that contract.

import {
  COUPON_SOURCE_TYPES,
  type CouponSourceType,
  type Db,
} from "./db";

const SOURCE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const SOURCE_NAME_MAX = 200;
const LABEL_MAX = 200;
const EXPIRES_AT_MAX = 64;
const SOURCE_URL_MAX = 2048;

// Canonical source ids for the three local writer surfaces. Any future
// trusted ingestion source must be registered via `ensureCouponSource` and
// gated behind the allowlist policy in docs/SOURCE_POLICY.md; do not add
// new entries here unless they are guaranteed to ship with that gating.
export const BUILTIN_SOURCE_IDS = {
  seed: "seed",
  admin: "admin",
  import: "import",
} as const;

export type BuiltinSourceId =
  (typeof BUILTIN_SOURCE_IDS)[keyof typeof BUILTIN_SOURCE_IDS];

export interface CouponSource {
  id: string;
  name: string;
  type: CouponSourceType;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CouponSourceInput {
  id: string;
  name: string;
  type: CouponSourceType;
  enabled?: boolean;
}

export interface CouponCodeSourceInput {
  storeId: number;
  code: string;
  sourceId: string;
  discoveredAt?: string;
  label?: string | null;
  expiresAt?: string | null;
  sourceUrl?: string | null;
  confidence?: number | null;
}

export interface CouponCodeSourceRow {
  id: number;
  storeId: number;
  code: string;
  sourceId: string;
  discoveredAt: string;
  label: string | null;
  expiresAt: string | null;
  sourceUrl: string | null;
  confidence: number | null;
}

export interface CouponSourceSummaryRow {
  sourceId: string;
  type: CouponSourceType;
  enabled: boolean;
  codeCount: number;
  storeCount: number;
}

function nowIso(): string {
  return new Date().toISOString();
}

export function isValidSourceId(id: unknown): id is string {
  return typeof id === "string" && SOURCE_ID_PATTERN.test(id);
}

export function validateSourceId(id: unknown): string {
  if (typeof id !== "string" || id.length === 0) {
    throw new Error("source id must be a non-empty string");
  }
  if (!SOURCE_ID_PATTERN.test(id)) {
    throw new Error(
      "source id must be lowercase letters, digits, or dashes (start alphanumeric, max 64 chars)",
    );
  }
  return id;
}

function validateSourceName(name: unknown): string {
  if (typeof name !== "string") {
    throw new Error("source name must be a string");
  }
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    throw new Error("source name must be non-empty");
  }
  if (trimmed.length > SOURCE_NAME_MAX) {
    throw new Error(`source name exceeds ${SOURCE_NAME_MAX} characters`);
  }
  return trimmed;
}

function validateSourceType(type: unknown): CouponSourceType {
  if (
    typeof type !== "string" ||
    !(COUPON_SOURCE_TYPES as readonly string[]).includes(type)
  ) {
    throw new Error(
      `source type must be one of: ${COUPON_SOURCE_TYPES.join(", ")}`,
    );
  }
  return type as CouponSourceType;
}

function validateBoundedString(
  value: unknown,
  field: string,
  max: number,
): string {
  if (typeof value !== "string") {
    throw new Error(`${field} must be a string`);
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error(`${field} must be non-empty`);
  }
  if (trimmed.length > max) {
    throw new Error(`${field} exceeds ${max} characters`);
  }
  return trimmed;
}

function validateOptionalBoundedString(
  value: unknown,
  field: string,
  max: number,
): string | null {
  if (value === null || value === undefined) return null;
  return validateBoundedString(value, field, max);
}

function validateConfidence(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > 100
  ) {
    throw new Error("confidence must be an integer between 0 and 100");
  }
  return value;
}

function rowToCouponSource(row: {
  id: string;
  name: string;
  type: string;
  enabled: number;
  created_at: string;
  updated_at: string;
}): CouponSource {
  return {
    id: row.id,
    name: row.name,
    type: row.type as CouponSourceType,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToCodeSource(row: {
  id: number;
  store_id: number;
  code: string;
  source_id: string;
  discovered_at: string;
  label: string | null;
  expires_at: string | null;
  source_url: string | null;
  confidence: number | null;
}): CouponCodeSourceRow {
  return {
    id: row.id,
    storeId: row.store_id,
    code: row.code,
    sourceId: row.source_id,
    discoveredAt: row.discovered_at,
    label: row.label,
    expiresAt: row.expires_at,
    sourceUrl: row.source_url,
    confidence: row.confidence,
  };
}

export function ensureCouponSource(
  db: Db,
  input: CouponSourceInput,
  now: string = nowIso(),
): CouponSource {
  const id = validateSourceId(input.id);
  const name = validateSourceName(input.name);
  const type = validateSourceType(input.type);
  const enabled = input.enabled === false ? 0 : 1;

  db.prepare(
    `INSERT INTO coupon_sources (id, name, type, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         type = excluded.type,
         enabled = excluded.enabled,
         updated_at = excluded.updated_at`,
  ).run(id, name, type, enabled, now, now);

  const row = db
    .prepare(
      `SELECT id, name, type, enabled, created_at, updated_at
         FROM coupon_sources WHERE id = ?`,
    )
    .get(id) as
    | {
        id: string;
        name: string;
        type: string;
        enabled: number;
        created_at: string;
        updated_at: string;
      }
    | undefined;
  if (!row) {
    throw new Error("coupon source row missing after upsert");
  }
  return rowToCouponSource(row);
}

export function listCouponSources(db: Db): CouponSource[] {
  const rows = db
    .prepare(
      `SELECT id, name, type, enabled, created_at, updated_at
         FROM coupon_sources
         ORDER BY id ASC`,
    )
    .all() as Array<{
    id: string;
    name: string;
    type: string;
    enabled: number;
    created_at: string;
    updated_at: string;
  }>;
  return rows.map(rowToCouponSource);
}

export function recordCouponCodeSource(
  db: Db,
  input: CouponCodeSourceInput,
): CouponCodeSourceRow {
  if (!Number.isInteger(input.storeId) || input.storeId <= 0) {
    throw new Error("storeId must be a positive integer");
  }
  const code = validateBoundedString(input.code, "code", 200);
  const sourceId = validateSourceId(input.sourceId);
  const discoveredAt = input.discoveredAt
    ? validateBoundedString(input.discoveredAt, "discoveredAt", EXPIRES_AT_MAX)
    : nowIso();
  const label = validateOptionalBoundedString(input.label, "label", LABEL_MAX);
  const expiresAt = validateOptionalBoundedString(
    input.expiresAt,
    "expiresAt",
    EXPIRES_AT_MAX,
  );
  const sourceUrl = validateOptionalBoundedString(
    input.sourceUrl,
    "sourceUrl",
    SOURCE_URL_MAX,
  );
  const confidence = validateConfidence(input.confidence);

  db.prepare(
    `INSERT OR IGNORE INTO coupon_code_sources
       (store_id, code, source_id, discovered_at, label, expires_at, source_url, confidence)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.storeId,
    code,
    sourceId,
    discoveredAt,
    label,
    expiresAt,
    sourceUrl,
    confidence,
  );

  const row = db
    .prepare(
      `SELECT id, store_id, code, source_id, discovered_at, label,
              expires_at, source_url, confidence
         FROM coupon_code_sources
         WHERE store_id = ? AND code = ? AND source_id = ?`,
    )
    .get(input.storeId, code, sourceId) as
    | {
        id: number;
        store_id: number;
        code: string;
        source_id: string;
        discovered_at: string;
        label: string | null;
        expires_at: string | null;
        source_url: string | null;
        confidence: number | null;
      }
    | undefined;
  if (!row) {
    throw new Error("coupon_code_sources row missing after insert");
  }
  return rowToCodeSource(row);
}

export function listSourcesForCoupon(
  db: Db,
  storeId: number,
  code: string,
): CouponCodeSourceRow[] {
  const rows = db
    .prepare(
      `SELECT id, store_id, code, source_id, discovered_at, label,
              expires_at, source_url, confidence
         FROM coupon_code_sources
         WHERE store_id = ? AND code = ?
         ORDER BY id ASC`,
    )
    .all(storeId, code) as Array<{
    id: number;
    store_id: number;
    code: string;
    source_id: string;
    discovered_at: string;
    label: string | null;
    expires_at: string | null;
    source_url: string | null;
    confidence: number | null;
  }>;
  return rows.map(rowToCodeSource);
}

// Drop coupon_code_sources rows for codes that are no longer present in
// coupon_codes for `storeId`, scoped to a single store. Intended for use
// inside a destructive replace transaction (e.g. `upsertCouponCodes`,
// `importCouponsExport`) right after the coupon_codes for a store have
// been deleted and before the new normalized list is inserted, so that
// provenance does not outlive the codes it referred to.
//
// Scope is store-local: provenance for other stores is never touched.
// `keepCodes` should be the post-trim/dedup list about to be reinserted.
export function pruneCouponCodeSourcesForStore(
  db: Db,
  storeId: number,
  keepCodes: readonly string[],
): { deleted: number } {
  if (!Number.isInteger(storeId) || storeId <= 0) {
    throw new Error("storeId must be a positive integer");
  }
  if (keepCodes.length === 0) {
    const r = db
      .prepare(`DELETE FROM coupon_code_sources WHERE store_id = ?`)
      .run(storeId);
    return { deleted: r.changes };
  }
  const placeholders = keepCodes.map(() => "?").join(",");
  const r = db
    .prepare(
      `DELETE FROM coupon_code_sources
         WHERE store_id = ?
           AND code NOT IN (${placeholders})`,
    )
    .run(storeId, ...keepCodes);
  return { deleted: r.changes };
}

export function getCouponSourceSummary(db: Db): CouponSourceSummaryRow[] {
  const rows = db
    .prepare(
      `SELECT s.id           AS source_id,
              s.type         AS type,
              s.enabled      AS enabled,
              COUNT(cs.id)   AS code_count,
              COUNT(DISTINCT cs.store_id) AS store_count
         FROM coupon_sources s
         LEFT JOIN coupon_code_sources cs ON cs.source_id = s.id
        GROUP BY s.id
        ORDER BY s.id ASC`,
    )
    .all() as Array<{
    source_id: string;
    type: string;
    enabled: number;
    code_count: number;
    store_count: number;
  }>;
  return rows.map((r) => ({
    sourceId: r.source_id,
    type: r.type as CouponSourceType,
    enabled: r.enabled === 1,
    codeCount: r.code_count,
    storeCount: r.store_count,
  }));
}
