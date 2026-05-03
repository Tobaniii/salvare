// Salvare backend configuration.
//
// Pure parser. Reads from a `NodeJS.ProcessEnv`-shaped object and produces
// either a validated `ServerConfig` or a clear error string, with all defaults
// injected so the function has no filesystem dependency. Tests pass synthetic
// envs and synthetic defaults; `main.ts` passes `process.env` and the real
// `defaultDatabasePath()`.
//
// PORT       — must parse as a positive integer in [1, 65535]; defaults supplied.
// SALVARE_DB_PATH — non-empty/whitespace path; defaults supplied.
// SALVARE_ADMIN_TOKEN — handled by `readAdminTokenFromEnv` (trimmed, empty disabled).
// NODE_ENV   — informational only; default "development".

import { readAdminTokenFromEnv } from "./auth";

export interface ServerConfig {
  port: number;
  dbPath: string;
  adminToken: string | null;
  nodeEnv: string;
}

export interface ServerConfigDefaults {
  port: number;
  dbPath: string;
}

export type ParseServerConfigResult =
  | { ok: true; config: ServerConfig }
  | { ok: false; error: string };

const POSITIVE_INTEGER = /^\d+$/;
const PORT_MIN = 1;
const PORT_MAX = 65535;

function trimOrEmpty(value: string | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

function parsePort(
  raw: string | undefined,
  defaultPort: number,
): { ok: true; port: number } | { ok: false; error: string } {
  const trimmed = trimOrEmpty(raw);
  if (trimmed.length === 0) return { ok: true, port: defaultPort };
  if (!POSITIVE_INTEGER.test(trimmed)) {
    return {
      ok: false,
      error: `PORT must be a positive integer between ${PORT_MIN} and ${PORT_MAX} (got '${raw}')`,
    };
  }
  const n = Number(trimmed);
  if (n < PORT_MIN || n > PORT_MAX) {
    return {
      ok: false,
      error: `PORT must be a positive integer between ${PORT_MIN} and ${PORT_MAX} (got '${raw}')`,
    };
  }
  return { ok: true, port: n };
}

function parseDbPath(raw: string | undefined, defaultPath: string): string {
  const trimmed = trimOrEmpty(raw);
  return trimmed.length > 0 ? trimmed : defaultPath;
}

function parseNodeEnv(raw: string | undefined): string {
  const trimmed = trimOrEmpty(raw);
  return trimmed.length > 0 ? trimmed : "development";
}

export function parseServerConfig(
  env: NodeJS.ProcessEnv = process.env,
  defaults: ServerConfigDefaults,
): ParseServerConfigResult {
  const portResult = parsePort(env.PORT, defaults.port);
  if (!portResult.ok) return { ok: false, error: portResult.error };

  return {
    ok: true,
    config: {
      port: portResult.port,
      dbPath: parseDbPath(env.SALVARE_DB_PATH, defaults.dbPath),
      adminToken: readAdminTokenFromEnv(env),
      nodeEnv: parseNodeEnv(env.NODE_ENV),
    },
  };
}
