// Health check helper for GET /health.
//
// Exposes only coarse booleans + the service name and version. Never reads or
// references the admin token value, the DB path, coupon codes, or result rows.
// `buildHealthResponse` is success-only; the route handler in `index.ts`
// wraps it in a try/catch and emits the documented failure envelope on error.

import type { Db } from "./db";
import { getDatabaseStatus } from "./diagnostics";

// Single source of truth for the backend version. Bump on each milestone.
export const SALVARE_VERSION = "0.9.0";

export const SALVARE_SERVICE_NAME = "salvare-backend";

export interface HealthSuccessResponse {
  ok: true;
  service: typeof SALVARE_SERVICE_NAME;
  version: string;
  database: {
    schemaInitialized: boolean;
    hasCoupons: boolean;
    hasResults: boolean;
  };
  auth: {
    adminTokenConfigured: boolean;
  };
}

export interface HealthFailureResponse {
  ok: false;
  service: typeof SALVARE_SERVICE_NAME;
  error: "health check failed";
}

export interface HealthInputs {
  db: Db;
  adminTokenConfigured: boolean;
  version?: string;
}

export function buildHealthResponse(
  inputs: HealthInputs,
): HealthSuccessResponse {
  const status = getDatabaseStatus(inputs.db);
  return {
    ok: true,
    service: SALVARE_SERVICE_NAME,
    version: inputs.version ?? SALVARE_VERSION,
    database: {
      schemaInitialized: status.schemaInitialized,
      hasCoupons: status.hasCoupons,
      hasResults: status.hasResults,
    },
    auth: {
      adminTokenConfigured: inputs.adminTokenConfigured,
    },
  };
}

export function buildHealthFailureResponse(): HealthFailureResponse {
  return {
    ok: false,
    service: SALVARE_SERVICE_NAME,
    error: "health check failed",
  };
}
