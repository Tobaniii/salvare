import { type IncomingMessage, type ServerResponse } from "node:http";
import { type Db } from "./db";

export function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown,
): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

export async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text) return {};
  return JSON.parse(text);
}

export interface RouteContext {
  db: Db;
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  requireAuth: (req: IncomingMessage, res: ServerResponse) => boolean;
}
