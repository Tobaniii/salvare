import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ADMIN_HTML_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "admin.html",
);

let cachedHtml: string | null = null;

export function getAdminHtml(): string {
  if (cachedHtml !== null) return cachedHtml;
  try {
    cachedHtml = readFileSync(ADMIN_HTML_PATH, "utf8");
  } catch {
    cachedHtml = "";
  }
  return cachedHtml;
}

export function parseCommaSeparatedCodes(input: string): string[] {
  return input
    .split(",")
    .map((c) => c.trim())
    .filter((c) => c.length > 0);
}
