import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./smoke",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "list",
  use: {
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      testMatch: "**/*.smoke.ts",
      testIgnore: "extension/**",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "extension",
      testMatch: "extension/**/*.smoke.ts",
      // Persistent context is created per-test in fixtures; viewport set there.
      use: {},
      // Extension smoke needs a real React checkout page and the Salvare API.
      // Both are spawned in dedicated subprocesses with isolated state:
      //  - Vite dev serves http://localhost:5173 (the local React demo)
      //  - The harness binds Salvare to http://127.0.0.1:4123 with an in-memory
      //    SQLite database, untouching server/salvare.db.
      // Port 4123 must be free; smoke/extension/global-setup.ts fails fast
      // with a clear message if a developer's dev server is already on it.
      timeout: 90_000,
      expect: { timeout: 30_000 },
    },
  ],
  globalSetup:
    process.env.PLAYWRIGHT_PROJECT === "extension" ||
    process.argv.includes("--project=extension")
      ? "./smoke/extension/global-setup.ts"
      : undefined,
  // Vite serves the React demo; the Salvare harness on port 4123 is spawned
  // by globalSetup so we can fail fast with a clear message on port collision.
  webServer:
    process.env.PLAYWRIGHT_PROJECT === "extension" ||
    process.argv.includes("--project=extension")
      ? [
          {
            command: "npm run dev",
            url: "http://localhost:5173",
            timeout: 60_000,
            reuseExistingServer: !process.env.CI,
            stdout: "ignore",
            stderr: "pipe",
          },
        ]
      : undefined,
});
