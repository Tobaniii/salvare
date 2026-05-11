// Provider feature-flag / env reader (v0.32.0).
//
// Pure synchronous function that turns a process-env-shaped record into a
// safe configuration descriptor for the Awin provider adapter spike. This
// module never logs, never echoes, never returns the raw env values to the
// caller — it surfaces only booleans and the credentials the adapter needs
// at call time (the adapter is responsible for keeping those out of any
// emitted result, log line, or error message).
//
// Per docs/SOURCE_POLICY.md sections 5 and 6:
//  - feature is disabled by default; missing or empty env → fail-closed;
//  - any unrecognized provider id → disabled;
//  - blank-string credentials are treated as missing.
//
// No `fetch`, no `node:http`, no filesystem reads, no DB access here.

export type SourceProviderId = "awin";

export const SUPPORTED_SOURCE_PROVIDER_IDS: readonly SourceProviderId[] = [
  "awin",
] as const;

export type SourceProviderDisabledReason =
  | "flag_off"
  | "provider_unset"
  | "provider_unsupported"
  | "missing_api_key";

export interface SourceProviderDisabled {
  enabled: false;
  reason: SourceProviderDisabledReason;
}

export interface AwinProviderConfig {
  enabled: true;
  providerId: "awin";
  apiKey: string;
  publisherId: string | null;
}

export type SourceProviderConfig =
  | SourceProviderDisabled
  | AwinProviderConfig;

function readTrimmed(env: NodeJS.ProcessEnv, key: string): string | null {
  const raw = env[key];
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length === 0 ? null : trimmed;
}

export function readAwinConfig(
  env: NodeJS.ProcessEnv = process.env,
): SourceProviderConfig {
  const flag = readTrimmed(env, "SALVARE_SOURCE_PROVIDER_ENABLED");
  if (flag !== "true") {
    return { enabled: false, reason: "flag_off" };
  }
  const providerId = readTrimmed(env, "SALVARE_SOURCE_PROVIDER");
  if (providerId === null) {
    return { enabled: false, reason: "provider_unset" };
  }
  if (
    !(SUPPORTED_SOURCE_PROVIDER_IDS as readonly string[]).includes(providerId)
  ) {
    return { enabled: false, reason: "provider_unsupported" };
  }
  if (providerId === "awin") {
    const apiKey = readTrimmed(env, "SALVARE_AWIN_API_KEY");
    if (apiKey === null) {
      return { enabled: false, reason: "missing_api_key" };
    }
    const publisherId = readTrimmed(env, "SALVARE_AWIN_PUBLISHER_ID");
    return {
      enabled: true,
      providerId: "awin",
      apiKey,
      publisherId,
    };
  }
  return { enabled: false, reason: "provider_unsupported" };
}
