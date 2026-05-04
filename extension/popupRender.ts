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

function formatDollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
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
