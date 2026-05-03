// Global setup/teardown for the Salvare extension smoke project.
//
// Spawns the isolated Salvare harness ourselves (rather than via Playwright's
// `webServer` block) so we can produce a single, clear error if port 4123 is
// already taken — instead of Playwright's generic "is already used" message.
//
// Vite (the React demo) is left to Playwright's `webServer` block; collisions
// there are fine because `reuseExistingServer` is on.

import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { FullConfig } from "@playwright/test";

const SALVARE_PORT = 4123;
const SETUP_DIR = dirname(fileURLToPath(import.meta.url));
const HARNESS_PATH = resolve(SETUP_DIR, "..", "extension-server-harness.js");

// Held at module scope so we can kill it on teardown.
let harness: ChildProcess | null = null;

async function ensurePortFree(port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const probe = createServer();
    probe.unref();
    probe.once("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        reject(
          new Error(
            `\nSalvare extension smoke: port ${port} is already in use.\n` +
              `Stop any running Salvare server (e.g. \`npm run start:server\`) ` +
              `before running \`npm run test:smoke:extension\`.\n`,
          ),
        );
        return;
      }
      reject(err);
    });
    probe.once("listening", () => {
      probe.close((closeErr) => (closeErr ? reject(closeErr) : resolve()));
    });
    // Bind without a host so we attempt the same dual-stack bind the real
    // Salvare server does. A dev server on `::4123` (any-host) and a probe on
    // `127.0.0.1:4123` would not conflict on macOS dual-stack; omitting the
    // host makes us see all 4123 listeners regardless of address family.
    probe.listen(port);
  });
}

async function waitForHarnessReady(timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(
        `http://localhost:${SALVARE_PORT}/coupons?domain=localhost`,
      );
      if (res.ok) return;
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(
    "Salvare extension smoke: harness did not become ready within " +
      `${timeoutMs}ms on port ${SALVARE_PORT}.`,
  );
}

export default async function globalSetup(
  _config: FullConfig,
): Promise<() => Promise<void>> {
  await ensurePortFree(SALVARE_PORT);

  // Scrub Salvare-specific env vars so a developer's `SALVARE_DB_PATH` or
  // `SALVARE_ADMIN_TOKEN` (or `PORT`) cannot leak into the harness subprocess.
  // The harness builds its server in-process with explicit args; this is
  // belt-and-braces in case its bootstrap ever starts reading env directly.
  const childEnv = { ...process.env };
  delete childEnv.SALVARE_DB_PATH;
  delete childEnv.SALVARE_ADMIN_TOKEN;
  delete childEnv.PORT;

  harness = spawn("node", [HARNESS_PATH], {
    stdio: ["ignore", "pipe", "pipe"],
    detached: false,
    env: childEnv,
  });
  harness.stdout?.on("data", (chunk) =>
    process.stdout.write(`[salvare-harness] ${chunk}`),
  );
  harness.stderr?.on("data", (chunk) =>
    process.stderr.write(`[salvare-harness] ${chunk}`),
  );
  // Belt-and-braces: even if globalTeardown is skipped (e.g. crash), the
  // harness should not outlive the Playwright runner.
  const killHarness = () => {
    if (harness && harness.exitCode === null) {
      try {
        harness.kill("SIGTERM");
      } catch {
        // already gone
      }
    }
  };
  process.on("exit", killHarness);
  process.on("SIGINT", () => {
    killHarness();
    process.exit(130);
  });
  process.on("SIGTERM", () => {
    killHarness();
    process.exit(143);
  });

  await waitForHarnessReady();

  return async () => {
    if (harness && harness.exitCode === null) {
      const exited = new Promise<void>((resolve) => {
        harness!.once("exit", () => resolve());
      });
      try {
        harness.kill("SIGTERM");
      } catch {
        return;
      }
      await Promise.race([
        exited,
        new Promise<void>((resolve) => setTimeout(resolve, 2_000)),
      ]);
    }
  };
}
