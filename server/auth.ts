import { timingSafeEqual } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";

export function readAdminTokenFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const raw = env.SALVARE_ADMIN_TOKEN;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function constantTimeEquals(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, "utf8");
  const bBuf = Buffer.from(b, "utf8");
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

export function isAuthorized(
  headers: IncomingHttpHeaders,
  configuredToken: string | null,
): boolean {
  if (configuredToken === null) return true;

  const header = headers.authorization;
  if (typeof header !== "string") return false;

  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match) return false;

  return constantTimeEquals(match[1].trim(), configuredToken);
}
