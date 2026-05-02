// Salvare extension background service worker.
//
// PURPOSE: Exists solely so Playwright extension smoke tests can discover the
// extension's runtime ID via `context.serviceWorkers()`. It has no product
// behavior, registers no message listeners, and accesses no storage or network.
// See docs/SERVER.md → "Extension smoke tests" for context.
//
// If you are adding real background behavior here, this file's role changes —
// update the comment above and the docs.

// One log line so the bundled file is non-empty (Chromium treats a 0-byte
// service worker as invalid in headless mode and refuses to register it).
// No subscriptions; the worker idles immediately after.
console.log("Salvare background SW loaded.");

export {};
