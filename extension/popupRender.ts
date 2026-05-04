// Pure render helpers used by the popup. Kept DOM-free so they can be
// unit-tested directly under vitest's default node environment.

import { messageForReason } from "./popupMessages";

export interface PopupSupportResponse {
  supported: boolean;
  message: string;
  reason?: string;
  profileId?: string;
}

export interface PopupBestResultResponse {
  bestCode: string;
  totalCents: number;
  savingsCents: number;
  codesTested?: number;
}

export interface PopupProgressUpdate {
  current: number;
  total: number;
  code?: string;
}

function formatDollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function renderProgressStatus(update: PopupProgressUpdate): string {
  const safeTotal = Number.isFinite(update.total) && update.total > 0
    ? Math.floor(update.total)
    : 0;
  const safeCurrent = Number.isFinite(update.current) && update.current > 0
    ? Math.min(Math.floor(update.current), Math.max(safeTotal, 1))
    : 1;

  if (safeTotal <= 0) {
    return "Testing coupons...";
  }

  const lines = [`Testing ${safeCurrent} of ${safeTotal}...`];
  if (typeof update.code === "string" && update.code.trim().length > 0) {
    lines.push(`Code: ${update.code.trim()}`);
  }
  return lines.join("\n");
}

export function renderSupportStatus(response: PopupSupportResponse): string {
  if (!response.supported) {
    return messageForReason(response.reason);
  }

  const lines: string[] = ["Store supported"];
  if (response.profileId) {
    lines.push(`Profile: ${response.profileId}`);
  }
  lines.push(messageForReason(response.reason ?? "ready"));
  return lines.join("\n");
}

export function renderResultStatus(
  response: PopupBestResultResponse,
): string {
  const lines = [
    `Best code: ${response.bestCode}`,
    `Final total: ${formatDollars(response.totalCents)}`,
    `You saved: ${formatDollars(response.savingsCents)}`,
  ];
  if (typeof response.codesTested === "number" && response.codesTested > 0) {
    lines.push(`Codes tested: ${response.codesTested}`);
  }
  return lines.join("\n");
}
