// Local source-adapter foundation (v0.30.0).
//
// Pure parsers that turn deterministic local fixture content (JSON or HTML)
// into normalized coupon candidates. This module is intentionally I/O-free:
// no `fetch`, no `node:http` / `node:https`, no `URL` networking, no
// filesystem reads, no environment-variable reads. Adapters accept a string
// the caller already loaded and return a redacted result.
//
// Per docs/SOURCE_POLICY.md sections 5 and 6:
//  - no scraping, no live network fetches, no provider/API/feed integration;
//  - parsers must validate strictly and never echo raw payloads, headers,
//    cookies, tokens, env vars, DB paths, raw HTML, or any unallowed field
//    in the returned candidates or errors;
//  - source identifiers must satisfy the same allowlist gate that the
//    provenance writers use (`isValidSourceId`).
//
// This milestone does not write parsed candidates back into SQLite. The
// existing seed/admin/import write paths in `db-coupons.ts` and
// `admin-import-routes.ts` are unchanged.
//
// Adapters are designed so per-row failures are reported as redacted
// `SourceAdapterError` entries while `ok` stays true. `ok` flips to false
// only when the payload itself is unreadable (e.g. invalid JSON, JSON whose
// top-level shape is not the documented `{ sourceId, items: [...] }`
// envelope, or HTML that contains zero recognizable micro-format elements
// at all).

import { isValidSourceId } from "./db-sources";

const DOMAIN_PATTERN = /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/;
const DOMAIN_MAX = 253;
const CODE_MIN = 1;
const CODE_MAX = 64;
const LABEL_MAX = 200;
const EXPIRES_AT_MAX = 64;
const SOURCE_URL_MAX = 2048;
const ISO_DATE_LIKE = /^[0-9T:\-+.Z ]{1,64}$/;
const SOURCE_URL_PATTERN = /^https?:\/\/[a-z0-9.-]+(?::\d+)?(?:\/[^\s"'<>]*)?$/i;

const ALLOWED_CANDIDATE_KEYS = [
  "domain",
  "code",
  "sourceId",
  "discoveredAt",
  "label",
  "expiresAt",
  "sourceUrl",
  "confidence",
] as const;

export type SourceAdapterType = "json" | "html";

export type SourceAdapterErrorReason =
  | "invalid_domain"
  | "invalid_code"
  | "invalid_label"
  | "invalid_expires_at"
  | "invalid_source_url"
  | "invalid_confidence"
  | "missing_field"
  | "duplicate"
  | "malformed_row"
  | "malformed_input";

export interface SourceAdapterContext {
  now?: () => string;
}

export interface SourceAdapterCandidate {
  domain: string;
  code: string;
  sourceId: string;
  discoveredAt: string;
  label?: string;
  expiresAt?: string;
  sourceUrl?: string;
  confidence?: number;
}

export interface SourceAdapterError {
  index: number;
  reason: SourceAdapterErrorReason;
}

export interface SourceAdapterResult {
  ok: boolean;
  adapterId: string;
  sourceId: string;
  candidates: SourceAdapterCandidate[];
  errors: SourceAdapterError[];
}

export interface SourceAdapter {
  readonly id: string;
  readonly sourceId: string;
  readonly type: SourceAdapterType;
  parse(input: string, context?: SourceAdapterContext): SourceAdapterResult;
}

export interface SourceAdapterOptions {
  id: string;
  sourceId: string;
}

export interface RawRow {
  domain?: unknown;
  code?: unknown;
  label?: unknown;
  expiresAt?: unknown;
  sourceUrl?: unknown;
  confidence?: unknown;
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function hasControlChars(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

function isAsciiPrintableNoSpace(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code <= 0x20 || code >= 0x7f) return false;
  }
  return true;
}

export function validateDomain(value: unknown): string | null {
  if (!isNonEmptyString(value)) return null;
  const lowered = value.trim().toLowerCase();
  if (lowered.length === 0 || lowered.length > DOMAIN_MAX) return null;
  if (!DOMAIN_PATTERN.test(lowered)) return null;
  return lowered;
}

export function validateCode(value: unknown): string | null {
  if (!isString(value)) return null;
  const trimmed = value.trim();
  if (trimmed.length < CODE_MIN || trimmed.length > CODE_MAX) return null;
  if (!isAsciiPrintableNoSpace(trimmed)) return null;
  return trimmed;
}

export function validateLabel(value: unknown): { ok: true; value?: string } | { ok: false } {
  if (value === undefined || value === null) return { ok: true };
  if (!isString(value)) return { ok: false };
  const trimmed = value.trim();
  if (trimmed.length === 0) return { ok: true };
  if (trimmed.length > LABEL_MAX) return { ok: false };
  if (hasControlChars(trimmed)) return { ok: false };
  return { ok: true, value: trimmed };
}

export function validateExpiresAt(
  value: unknown,
): { ok: true; value?: string } | { ok: false } {
  if (value === undefined || value === null) return { ok: true };
  if (!isString(value)) return { ok: false };
  const trimmed = value.trim();
  if (trimmed.length === 0) return { ok: true };
  if (trimmed.length > EXPIRES_AT_MAX) return { ok: false };
  if (!ISO_DATE_LIKE.test(trimmed)) return { ok: false };
  return { ok: true, value: trimmed };
}

export function validateSourceUrl(
  value: unknown,
): { ok: true; value?: string } | { ok: false } {
  if (value === undefined || value === null) return { ok: true };
  if (!isString(value)) return { ok: false };
  const trimmed = value.trim();
  if (trimmed.length === 0) return { ok: true };
  if (trimmed.length > SOURCE_URL_MAX) return { ok: false };
  if (!SOURCE_URL_PATTERN.test(trimmed)) return { ok: false };
  return { ok: true, value: trimmed };
}

export function validateConfidence(
  value: unknown,
): { ok: true; value?: number } | { ok: false } {
  if (value === undefined || value === null) return { ok: true };
  if (typeof value !== "number") return { ok: false };
  if (!Number.isFinite(value)) return { ok: false };
  if (value < 0 || value > 1) return { ok: false };
  return { ok: true, value };
}

function defaultNow(): string {
  return new Date().toISOString();
}

export function buildCandidate(
  raw: RawRow,
  index: number,
  sourceId: string,
  now: () => string,
  seen: Set<string>,
  errors: SourceAdapterError[],
): SourceAdapterCandidate | null {
  if (raw === null || typeof raw !== "object") {
    errors.push({ index, reason: "malformed_row" });
    return null;
  }
  if (raw.domain === undefined || raw.code === undefined) {
    errors.push({ index, reason: "missing_field" });
    return null;
  }
  const domain = validateDomain(raw.domain);
  if (domain === null) {
    errors.push({ index, reason: "invalid_domain" });
    return null;
  }
  const code = validateCode(raw.code);
  if (code === null) {
    errors.push({ index, reason: "invalid_code" });
    return null;
  }
  const label = validateLabel(raw.label);
  if (!label.ok) {
    errors.push({ index, reason: "invalid_label" });
    return null;
  }
  const expiresAt = validateExpiresAt(raw.expiresAt);
  if (!expiresAt.ok) {
    errors.push({ index, reason: "invalid_expires_at" });
    return null;
  }
  const sourceUrl = validateSourceUrl(raw.sourceUrl);
  if (!sourceUrl.ok) {
    errors.push({ index, reason: "invalid_source_url" });
    return null;
  }
  const confidence = validateConfidence(raw.confidence);
  if (!confidence.ok) {
    errors.push({ index, reason: "invalid_confidence" });
    return null;
  }

  const dedupeKey = `${sourceId}|${domain}|${code}`;
  if (seen.has(dedupeKey)) {
    errors.push({ index, reason: "duplicate" });
    return null;
  }
  seen.add(dedupeKey);

  const candidate: SourceAdapterCandidate = {
    domain,
    code,
    sourceId,
    discoveredAt: now(),
  };
  if (label.value !== undefined) candidate.label = label.value;
  if (expiresAt.value !== undefined) candidate.expiresAt = expiresAt.value;
  if (sourceUrl.value !== undefined) candidate.sourceUrl = sourceUrl.value;
  if (confidence.value !== undefined) candidate.confidence = confidence.value;
  return candidate;
}

export function pickAllowedRow(value: unknown): RawRow | null {
  if (value === null || typeof value !== "object") return null;
  const obj = value as Record<string, unknown>;
  const out: RawRow = {};
  if (Object.prototype.hasOwnProperty.call(obj, "domain")) out.domain = obj.domain;
  if (Object.prototype.hasOwnProperty.call(obj, "code")) out.code = obj.code;
  if (Object.prototype.hasOwnProperty.call(obj, "label")) out.label = obj.label;
  if (Object.prototype.hasOwnProperty.call(obj, "expiresAt"))
    out.expiresAt = obj.expiresAt;
  if (Object.prototype.hasOwnProperty.call(obj, "sourceUrl"))
    out.sourceUrl = obj.sourceUrl;
  if (Object.prototype.hasOwnProperty.call(obj, "confidence"))
    out.confidence = obj.confidence;
  return out;
}

function validateAdapterOptions(options: SourceAdapterOptions): void {
  if (!isValidSourceId(options.id)) {
    throw new Error("source adapter id is invalid");
  }
  if (!isValidSourceId(options.sourceId)) {
    throw new Error("source adapter sourceId is invalid");
  }
}

export function createJsonFixtureAdapter(
  options: SourceAdapterOptions,
): SourceAdapter {
  validateAdapterOptions(options);
  const adapterId = options.id;
  const sourceId = options.sourceId;
  return {
    id: adapterId,
    sourceId,
    type: "json",
    parse(input: string, context?: SourceAdapterContext): SourceAdapterResult {
      const errors: SourceAdapterError[] = [];
      const candidates: SourceAdapterCandidate[] = [];
      const now = context?.now ?? defaultNow;

      let parsed: unknown;
      try {
        parsed = JSON.parse(input);
      } catch {
        return {
          ok: false,
          adapterId,
          sourceId,
          candidates,
          errors: [{ index: -1, reason: "malformed_input" }],
        };
      }

      if (
        parsed === null ||
        typeof parsed !== "object" ||
        Array.isArray(parsed)
      ) {
        return {
          ok: false,
          adapterId,
          sourceId,
          candidates,
          errors: [{ index: -1, reason: "malformed_input" }],
        };
      }

      const envelope = parsed as { items?: unknown };
      if (!Array.isArray(envelope.items)) {
        return {
          ok: false,
          adapterId,
          sourceId,
          candidates,
          errors: [{ index: -1, reason: "malformed_input" }],
        };
      }

      const seen = new Set<string>();
      envelope.items.forEach((item, index) => {
        const row = pickAllowedRow(item);
        if (row === null) {
          errors.push({ index, reason: "malformed_row" });
          return;
        }
        const candidate = buildCandidate(row, index, sourceId, now, seen, errors);
        if (candidate !== null) candidates.push(candidate);
      });

      return { ok: true, adapterId, sourceId, candidates, errors };
    },
  };
}

const HTML_ITEM_PATTERN =
  /<li\b[^>]*\bclass\s*=\s*"salvare-coupon"[^>]*>/gi;

function extractAttr(tag: string, name: string): string | undefined {
  const pattern = new RegExp(
    `\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`,
    "i",
  );
  const match = pattern.exec(tag);
  if (!match) return undefined;
  return match[2] ?? match[3] ?? "";
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function parseHtmlRow(tag: string): RawRow {
  const row: RawRow = {};
  const domain = extractAttr(tag, "data-domain");
  const code = extractAttr(tag, "data-code");
  const label = extractAttr(tag, "data-label");
  const expiresAt = extractAttr(tag, "data-expires-at");
  const sourceUrl = extractAttr(tag, "data-source-url");
  const confidence = extractAttr(tag, "data-confidence");
  if (domain !== undefined) row.domain = decodeHtmlEntities(domain);
  if (code !== undefined) row.code = decodeHtmlEntities(code);
  if (label !== undefined) row.label = decodeHtmlEntities(label);
  if (expiresAt !== undefined) row.expiresAt = decodeHtmlEntities(expiresAt);
  if (sourceUrl !== undefined) row.sourceUrl = decodeHtmlEntities(sourceUrl);
  if (confidence !== undefined) {
    const num = Number(confidence);
    row.confidence = Number.isNaN(num) ? confidence : num;
  }
  return row;
}

export function createHtmlFixtureAdapter(
  options: SourceAdapterOptions,
): SourceAdapter {
  validateAdapterOptions(options);
  const adapterId = options.id;
  const sourceId = options.sourceId;
  return {
    id: adapterId,
    sourceId,
    type: "html",
    parse(input: string, context?: SourceAdapterContext): SourceAdapterResult {
      const errors: SourceAdapterError[] = [];
      const candidates: SourceAdapterCandidate[] = [];
      const now = context?.now ?? defaultNow;

      if (typeof input !== "string" || input.length === 0) {
        return {
          ok: false,
          adapterId,
          sourceId,
          candidates,
          errors: [{ index: -1, reason: "malformed_input" }],
        };
      }

      const tags: string[] = [];
      HTML_ITEM_PATTERN.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = HTML_ITEM_PATTERN.exec(input)) !== null) {
        tags.push(match[0]);
      }

      if (tags.length === 0) {
        return {
          ok: false,
          adapterId,
          sourceId,
          candidates,
          errors: [{ index: -1, reason: "malformed_input" }],
        };
      }

      const seen = new Set<string>();
      tags.forEach((tag, index) => {
        const row = parseHtmlRow(tag);
        const candidate = buildCandidate(row, index, sourceId, now, seen, errors);
        if (candidate !== null) candidates.push(candidate);
      });

      return { ok: true, adapterId, sourceId, candidates, errors };
    },
  };
}

export const SOURCE_ADAPTER_CANDIDATE_KEYS = ALLOWED_CANDIDATE_KEYS;
