// Admin source provider list boundary (v0.44.0).
//
// Read-only, admin-protected GET /admin/source-providers that exposes the
// safe-to-render metadata of every registry provider with `userExposed=true`.
// Acts as the registry-backed surface that powers the admin UI provider
// selector. The handler executes zero writes and reads no env values, no
// API keys, no DB rows, and no provider config beyond the registry's static
// `userExposed` flag — `featureEnabled` / `configured` booleans live on the
// existing /admin/source-status endpoint and are deliberately not duplicated
// here.
//
// Per docs/SOURCE_POLICY.md §6 and the redaction rules in
// docs/SOURCE_PROVIDER_RESEARCH.md §5, the response is built from an
// explicit allowlist below: `{ providerId, displayName, sourceId,
// sourceType, activation: { enabled, previewEnabled, importEnabled,
// cacheSupported, schedulerSupported } }`. The projected `activation` is a
// deliberate 5-field subset of the registry's 6-field `ProviderActivation`:
// `userExposed` is the gate, not a returned field. The route never echoes
// the admin token, the API key, the `Authorization` header, cookies,
// `localStorage`, env values, the DB path, raw provider payloads, raw HTML,
// affiliate / tracking / payout fields, source URLs, or stack traces.
//
// Internal-only providers (impact in v0.44) never appear in the response.

import { sendJson, type RouteContext } from "./http-helpers";
import type { ProviderDescriptorMetadata } from "./source-provider-registry";

export type ProviderListSource = () => readonly ProviderDescriptorMetadata[];

interface SafeProviderEntry {
  providerId: string;
  sourceId: string;
  displayName: string;
  sourceType: string;
  activation: {
    enabled: boolean;
    previewEnabled: boolean;
    importEnabled: boolean;
    cacheSupported: boolean;
    schedulerSupported: boolean;
  };
}

function buildSafeEntry(meta: ProviderDescriptorMetadata): SafeProviderEntry {
  return {
    providerId: meta.providerId,
    sourceId: meta.sourceId,
    displayName: meta.displayName,
    sourceType: meta.sourceType,
    // 5-field subset — `userExposed` is the filter gate, never echoed.
    activation: {
      enabled: meta.activation.enabled === true,
      previewEnabled: meta.activation.previewEnabled === true,
      importEnabled: meta.activation.importEnabled === true,
      cacheSupported: meta.activation.cacheSupported === true,
      schedulerSupported: meta.activation.schedulerSupported === true,
    },
  };
}

export function handleAdminSourceProvidersRoute(
  ctx: RouteContext,
  list: ProviderListSource,
): boolean {
  const { req, res, url, requireAuth } = ctx;

  if (req.method !== "GET" || url.pathname !== "/admin/source-providers") {
    return false;
  }
  if (!requireAuth(req, res)) return true;

  const providers = list()
    .filter((meta) => meta.activation.userExposed === true)
    .map(buildSafeEntry);

  sendJson(res, 200, { providers });
  return true;
}
