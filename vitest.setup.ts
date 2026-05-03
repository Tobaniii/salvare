// Vitest global setup.
//
// Scrubs Salvare-specific environment variables from `process.env` so the unit
// suite is deterministic regardless of the developer's shell. Tests that need
// these vars set should pass them explicitly as a synthetic env object to the
// pure helpers (e.g. `parseServerConfig({...}, defaults)`), not via process env.

delete process.env.SALVARE_DB_PATH;
delete process.env.SALVARE_ADMIN_TOKEN;
