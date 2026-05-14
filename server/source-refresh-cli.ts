// Manual source-refresh CLI entrypoint (v0.39.0).
//
// Local-only CLI shim around `runSourceRefresh`. Default is dry-run preview;
// `--import` plus exact `--confirm IMPORT` triggers the additive importer.
//
//   npm run source:refresh -- --provider awin --domain example.com
//   npm run source:refresh -- --provider awin --domain example.com --import --confirm IMPORT
//
// Per docs/SOURCE_POLICY.md §6 and docs/SOURCE_PROVIDER_RESEARCH.md §5: no
// API keys, env values, Authorization headers, cookies, DB paths, raw
// provider payloads, raw HTML, affiliate/tracking fields, or full
// secret-bearing URLs are written to stdout/stderr. Stack traces are
// suppressed by default.

import { basename, resolve } from "node:path";
import { parseServerConfig } from "./config";
import { defaultDatabasePath, openDatabase } from "./db";
import {
  parseSourceRefreshArgs,
  runSourceRefresh,
  type SourceRefreshOutput,
} from "./source-refresh";
import type {
  AwinFetcher,
  AwinFetcherResponse,
} from "./source-provider-awin";

const USAGE =
  "Usage: npm run source:refresh -- --provider awin --domain <domain>\n" +
  "       npm run source:refresh -- --provider awin --domain <domain> --import --confirm IMPORT";

function emitFailure(reason: string): never {
  const output: SourceRefreshOutput = {
    ok: false,
    mode: "preview",
    reason,
  };
  process.stdout.write(`${JSON.stringify(output)}\n`);
  process.stderr.write(`${USAGE}\n`);
  process.exit(1);
}

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

async function main(): Promise<void> {
  const parsed = parseSourceRefreshArgs(process.argv.slice(2));
  if (!parsed.ok) {
    emitFailure(parsed.error);
  }

  const configParsed = parseServerConfig(process.env, {
    port: 0,
    dbPath: defaultDatabasePath(),
  });
  if (!configParsed.ok) {
    emitFailure("invalid_configuration");
  }

  const dbPath = resolve(configParsed.config.dbPath);
  const normalized = dbPath.replace(/\\/g, "/");
  if (normalized.includes("/smoke/") && basename(normalized) === "salvare.db") {
    emitFailure("refusing_smoke_db");
  }

  const db = openDatabase(dbPath);
  try {
    const result = await runSourceRefresh(parsed.args, {
      db,
      env: process.env,
      fetcher: liveFetcher,
    });
    process.stdout.write(`${JSON.stringify(result.output)}\n`);
    process.exit(result.exitCode);
  } finally {
    db.close();
  }
}

main().catch(() => {
  emitFailure("unexpected_error");
});
