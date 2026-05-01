export const MONEY_REGEX =
  /(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+\.\d{2}|\d+)/g;

export function parseMoneyToCents(value: string): number | null {
  const cleaned = value.replace(/,/g, "").trim();
  const amount = Number(cleaned);

  if (Number.isNaN(amount)) return null;

  return Math.round(amount * 100);
}

export function extractMoneyText(text: string): string | null {
  if (!text) return null;
  const matches = text.match(MONEY_REGEX);
  if (!matches || matches.length === 0) return null;
  return matches[matches.length - 1];
}
