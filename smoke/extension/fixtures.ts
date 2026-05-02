import {
  test as base,
  chromium,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SMOKE_DIR = dirname(fileURLToPath(import.meta.url));
const EXTENSION_PATH = resolve(SMOKE_DIR, "..", "..", "extension");

export interface ExtensionHandle {
  context: BrowserContext;
  extensionId: string;
  userDataDir: string;
}

interface ExtensionFixtures {
  ext: ExtensionHandle;
}

async function discoverExtensionId(
  context: BrowserContext,
  timeoutMs = 15_000,
): Promise<string> {
  for (const sw of context.serviceWorkers()) {
    const match = sw.url().match(/^chrome-extension:\/\/([^/]+)\//);
    if (match) return match[1];
  }

  try {
    const sw = await context.waitForEvent("serviceworker", {
      timeout: timeoutMs,
    });
    const match = sw.url().match(/^chrome-extension:\/\/([^/]+)\//);
    if (match) return match[1];
  } catch {
    // fall through to error
  }

  throw new Error(
    "Salvare extension smoke: timed out waiting for the background service " +
      "worker to register. Did `npm run build:extension` produce a non-empty " +
      "extension/background.js? See docs/SERVER.md → Extension smoke tests.",
  );
}

export const test = base.extend<ExtensionFixtures>({
  ext: async ({}, use) => {
    const userDataDir = mkdtempSync(join(tmpdir(), "salvare-ext-"));

    // MV3 extensions don't load in classic headless. We use the new headless
    // mode (Chromium 112+), which Playwright opts into via `headless: true`
    // when channel/launch defaults allow it; on some systems the bundled
    // chrome-headless-shell still rejects extensions. The `--headless=new`
    // arg below is a belt-and-braces guarantee, and `headless: false` is
    // available as an opt-in via the SALVARE_SMOKE_HEADED env var if a CI
    // host needs a visible window.
    const headed = process.env.SALVARE_SMOKE_HEADED === "1";
    const context = await chromium.launchPersistentContext(userDataDir, {
      headless: headed ? false : true,
      channel: "chromium",
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
        "--no-sandbox",
        ...(headed ? [] : ["--headless=new"]),
      ],
    });

    let extensionId: string;
    try {
      extensionId = await discoverExtensionId(context);
    } catch (err) {
      await context.close().catch(() => {});
      rmSync(userDataDir, { recursive: true, force: true });
      throw err;
    }

    await use({ context, extensionId, userDataDir });

    await context.close().catch(() => {});
    rmSync(userDataDir, { recursive: true, force: true });
  },
});

/**
 * Open the Salvare popup in a regular tab and rewrite `chrome.tabs.query` so
 * the popup's "active tab" lookup returns the page at `checkoutUrlPrefix`
 * instead of the popup tab itself. The popup script is otherwise unchanged.
 */
export async function openPopup(
  ext: ExtensionHandle,
  checkoutUrlPrefix: string,
): Promise<Page> {
  const popup = await ext.context.newPage();
  await popup.addInitScript((urlPrefix: string) => {
    const original = chrome.tabs.query.bind(chrome.tabs);
    chrome.tabs.query = function (
      _opts: chrome.tabs.QueryInfo,
      cb?: (tabs: chrome.tabs.Tab[]) => void,
    ): Promise<chrome.tabs.Tab[]> {
      return new Promise((res) => {
        original({}, (tabs: chrome.tabs.Tab[]) => {
          const checkout = tabs.find(
            (t) => typeof t.url === "string" && t.url.startsWith(urlPrefix),
          );
          const result = checkout ? [checkout] : [];
          if (cb) cb(result);
          res(result);
        });
      });
    } as typeof chrome.tabs.query;
  }, checkoutUrlPrefix);

  await popup.goto(`chrome-extension://${ext.extensionId}/popup.html`);
  return popup;
}

export { expect } from "@playwright/test";
