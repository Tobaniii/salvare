// Scheduled source-refresh loop (v0.52.0).
//
// Opt-in, default-OFF background loop that periodically re-runs the EXISTING
// provider fetch+import path (`runSourceRefresh` → pipeline →
// `importProviderCandidates`) so the candidate pool stays warm with zero
// manual CLI runs. First consumer of `activation.schedulerSupported`.
//
// This is NOT a ranking input. Winner selection is unchanged (lowest verified
// finalTotalCents). The loop only repopulates candidates via the same
// idempotent, provenance-preserving importer the manual CLI uses, behind the
// SAME `canFetchSourceNow` cache/rate gate — never bypassed.
//
// Safety (docs/SOURCE_POLICY.md §6):
//  - default OFF, fail-closed: live network egress must be explicit;
//  - a single env toggle disables the whole loop without a rebuild;
//  - per-provider env enable (`readAwinConfig`) is still honored;
//  - the configured cadence is a *ceiling*; `canFetchSourceNow` is the real
//    rate guard and is consulted every tick;
//  - impact.com is permanently `schedulerSupported:false` (no publisher
//    account) and so is never selected here;
//  - no schema change, no response/extension/bundle change; the loop only
//    drives the import path and never prints provider output (may carry
//    candidate codes) — only the safe exitCode/reason token is inspected.

import type { Db } from "./db";
import { runSourceRefresh } from "./source-refresh";
import {
  createProviderRegistry,
  type ProviderRegistry,
} from "./source-provider-registry";
import {
  canFetchSourceNow,
  recordSourceFetchAttempt,
} from "./db-source-cache";
import { listProviderProvenanceDomains } from "./db-scheduled-domains";
import type {
  AwinAdapterClock,
  AwinFetcher,
  AwinFetcherResponse,
} from "./source-provider-awin";
import { createRealTimer, type SchedulerTimer } from "./scheduled-timer";

// 6h. Must track `source-provider-awin.ts:51` DEFAULT_CACHE_TTL_MS: the loop
// is floored to the Awin cache TTL so a tick can never out-pace the cache.
export const DEFAULT_SCHEDULED_INTERVAL_MS = 6 * 60 * 60 * 1000;
const SCHEDULED_INTERVAL_FLOOR_MS = DEFAULT_SCHEDULED_INTERVAL_MS;

const ENABLE_ENV = "SALVARE_SCHEDULED_REFRESH_ENABLED";
const INTERVAL_ENV = "SALVARE_SCHEDULED_REFRESH_INTERVAL_MS";

export type ScheduledRefreshConfig =
  | { enabled: false; reason: "flag_off" | "interval_invalid" }
  | { enabled: true; intervalMs: number };

// Same semantics as `source-provider-config.ts:86-91` readTrimmed (null when
// missing / non-string / blank). Re-declared locally to keep modules decoupled
// (that one is not exported).
function readTrimmed(env: NodeJS.ProcessEnv, key: string): string | null {
  const raw = env[key];
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length === 0 ? null : trimmed;
}

export function readScheduledRefreshConfig(
  env: NodeJS.ProcessEnv,
): ScheduledRefreshConfig {
  const flag = readTrimmed(env, ENABLE_ENV);
  if (flag !== "true") {
    return { enabled: false, reason: "flag_off" };
  }
  const rawInterval = readTrimmed(env, INTERVAL_ENV);
  let parsed = DEFAULT_SCHEDULED_INTERVAL_MS;
  if (rawInterval !== null) {
    // Strict positive integer: all-digits only (rejects "1e9", "12.5",
    // "0x10", "  5 ", trailing junk). Fail-closed on anything else.
    if (!/^\d+$/.test(rawInterval)) {
      return { enabled: false, reason: "interval_invalid" };
    }
    parsed = Number.parseInt(rawInterval, 10);
    if (!Number.isSafeInteger(parsed) || parsed <= 0) {
      return { enabled: false, reason: "interval_invalid" };
    }
  }
  const intervalMs = Math.max(parsed, SCHEDULED_INTERVAL_FLOOR_MS);
  return { enabled: true, intervalMs };
}

export interface ScheduledRefreshTickDeps {
  db: Db;
  env: NodeJS.ProcessEnv;
  fetcher: AwinFetcher;
  clock: AwinAdapterClock;
  intervalMs: number;
  /** Shared across ticks by the start handle; enforces single-flight. */
  inFlight: Set<string>;
  registry?: ProviderRegistry;
  /** Seam for tests; defaults to the real `runSourceRefresh`. */
  runRefresh?: typeof runSourceRefresh;
}

export interface ScheduledRefreshDomainOutcome {
  provider: string;
  domain: string;
  result: "ran" | "skipped" | "error";
  reason?: string;
}

export interface TickReport {
  attempted: number;
  skipped: number;
  errored: number;
  perDomain: ScheduledRefreshDomainOutcome[];
}

// Mirrors the adapter's `makeCacheKey` output (source-provider-pipeline.ts:
// 110-112) so the gate consulted here aligns byte-for-byte with the cache row
// the pipeline writes. `source-provider-pipeline.ts` is firewall (no export);
// scheduled-refresh.test.ts asserts byte-equality against the persisted row so
// a future format change cannot silently desync this gate.
function schedulerCacheKey(domain: string): string {
  return `merchant:${domain}`;
}

function failureReason(output: unknown): string {
  if (
    typeof output === "object" &&
    output !== null &&
    "reason" in output &&
    typeof (output as { reason: unknown }).reason === "string"
  ) {
    return (output as { reason: string }).reason;
  }
  return "unknown";
}

export async function runScheduledRefreshTick(
  deps: ScheduledRefreshTickDeps,
): Promise<TickReport> {
  const report: TickReport = {
    attempted: 0,
    skipped: 0,
    errored: 0,
    perDomain: [],
  };
  const registry = deps.registry ?? createProviderRegistry();
  const runRefresh = deps.runRefresh ?? runSourceRefresh;

  // Flag-driven eligibility — NOT hardcoded. impact.com ships
  // schedulerSupported:false permanently and is filtered out here.
  const eligible = registry
    .list()
    .filter(
      (d) =>
        d.activation.enabled === true &&
        d.activation.schedulerSupported === true,
    )
    .map((d) => d.providerId);

  for (const providerId of eligible) {
    // Only Awin is eligible post-flip; honor its per-provider env enable.
    // A disabled provider is skipped wholesale with no fetch-log noise
    // (mirrors runSourceRefresh's own fail-closed disabled path).
    if (providerId === "awin") {
      const cfg = registry.getAwin().readConfig(deps.env);
      if (!cfg.enabled) continue;
    } else {
      // Defensive: an unexpected eligible provider has no scheduler wiring.
      continue;
    }

    let domains: string[];
    try {
      domains = listProviderProvenanceDomains(deps.db, providerId);
    } catch {
      // A bad domain query must never crash the loop.
      continue;
    }

    for (const domain of domains) {
      const key = `${providerId}|${domain}`;
      if (deps.inFlight.has(key)) {
        report.skipped += 1;
        report.perDomain.push({
          provider: providerId,
          domain,
          result: "skipped",
          reason: "in_flight",
        });
        continue;
      }
      deps.inFlight.add(key);
      try {
        const cacheKey = schedulerCacheKey(domain);
        const decision = canFetchSourceNow(
          deps.db,
          {
            sourceId: providerId,
            cacheKey,
            minIntervalMs: deps.intervalMs,
          },
          deps.clock.nowIso(),
        );
        if (!decision.allowed) {
          // Silent skip — cache_fresh / recent_attempt / unknown_source are
          // not failures; the gate already models them. Emitting a synthetic
          // source_fetch_log row would pollute /admin/source-status.
          report.skipped += 1;
          report.perDomain.push({
            provider: providerId,
            domain,
            result: "skipped",
            reason: decision.reason,
          });
          continue;
        }

        try {
          const res = await runRefresh(
            { provider: providerId, domain, import: true, confirm: "IMPORT" },
            {
              db: deps.db,
              env: deps.env,
              fetcher: deps.fetcher,
              clock: deps.clock,
              registry,
            },
          );
          if (res.exitCode === 0) {
            // Pipeline already wrote its own source_fetch_log + source_cache
            // rows on success — do NOT double-log.
            report.attempted += 1;
            report.perDomain.push({
              provider: providerId,
              domain,
              result: "ran",
            });
          } else {
            // Handled failure: runSourceRefresh returns exitCode 1 WITHOUT
            // throwing for fetch/import errors and the pipeline already
            // logged the real outcome. Record the safe reason token only;
            // no extra log row, continue the tick.
            report.errored += 1;
            report.perDomain.push({
              provider: providerId,
              domain,
              result: "error",
              reason: failureReason(res.output),
            });
          }
        } catch {
          // Unexpected throw (e.g. a DB-level exception) — the pipeline did
          // not log this. Record one safe error row and continue; the loop
          // must never crash boot or abort the tick.
          const nowIso = deps.clock.nowIso();
          try {
            recordSourceFetchAttempt(
              deps.db,
              {
                sourceId: providerId,
                cacheKey,
                outcome: "error",
                errorCode: "scheduled_refresh_failed",
                attemptedAt: nowIso,
              },
              nowIso,
            );
          } catch {
            // Even logging must not crash the loop.
          }
          report.errored += 1;
          report.perDomain.push({
            provider: providerId,
            domain,
            result: "error",
            reason: "scheduled_refresh_failed",
          });
        }
      } finally {
        deps.inFlight.delete(key);
      }
    }
  }

  return report;
}

export interface StartScheduledRefreshDeps {
  db: Db;
  env: NodeJS.ProcessEnv;
  fetcher?: AwinFetcher;
  clock?: AwinAdapterClock;
  timer?: SchedulerTimer;
  registry?: ProviderRegistry;
}

export interface ScheduledRefreshHandle {
  stop(): void;
}

// Production live fetcher — same shape as source-refresh-cli.ts:43-57
// (AbortController + per-request timeout). Replicated locally because the CLI
// is an entrypoint, not a library.
const liveFetcher: AwinFetcher = async (url, init) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), init.timeoutMs);
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: init.headers,
      signal: controller.signal,
    });
    const body = await res.text();
    return { status: res.status, body } satisfies AwinFetcherResponse;
  } finally {
    clearTimeout(timeout);
  }
};

function realClock(): AwinAdapterClock {
  return {
    nowIso: () => new Date().toISOString(),
    nowMs: () => Date.now(),
  };
}

export function startScheduledRefresh(
  deps: StartScheduledRefreshDeps,
): ScheduledRefreshHandle {
  const cfg = readScheduledRefreshConfig(deps.env);
  if (!cfg.enabled) {
    console.log(`Salvare scheduled-refresh: disabled (${cfg.reason})`);
    return { stop() {} };
  }

  const fetcher = deps.fetcher ?? liveFetcher;
  const clock = deps.clock ?? realClock();
  const timer = deps.timer ?? createRealTimer();
  const inFlight = new Set<string>();

  // Re-entrancy guard: a tick that runs longer than the interval must not
  // overlap the next one (belt-and-braces beyond the per-pair inFlight set).
  let running = false;
  const onTick = (): void => {
    if (running) return;
    running = true;
    runScheduledRefreshTick({
      db: deps.db,
      env: deps.env,
      fetcher,
      clock,
      intervalMs: cfg.intervalMs,
      inFlight,
      registry: deps.registry,
    })
      .catch(() => {
        // runScheduledRefreshTick never throws, but stay defensive.
      })
      .finally(() => {
        running = false;
      });
  };

  console.log(
    `Salvare scheduled-refresh: enabled (intervalMs=${cfg.intervalMs})`,
  );
  const handle = timer.schedule(cfg.intervalMs, onTick);
  // No synchronous first tick: must not block / race boot. The first tick
  // fires after one interval; the pool is already warm from the last manual
  // run / bootstrap.
  return {
    stop() {
      handle.stop();
    },
  };
}
