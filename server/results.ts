export interface ResultRecord {
  domain: string;
  code: string;
  success: boolean;
  savingsCents: number;
  finalTotalCents: number;
  testedAt: string;
}

export type ResultBodyValidation =
  | {
      ok: true;
      domain: string;
      code: string;
      success: boolean;
      savingsCents: number;
      finalTotalCents: number;
    }
  | { ok: false; error: string };

export function validateResultBody(body: unknown): ResultBodyValidation {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "body must be an object" };
  }
  const b = body as Record<string, unknown>;

  if (typeof b.domain !== "string" || b.domain.trim().length === 0) {
    return { ok: false, error: "domain must be a non-empty string" };
  }
  if (typeof b.code !== "string" || b.code.trim().length === 0) {
    return { ok: false, error: "code must be a non-empty string" };
  }
  if (typeof b.success !== "boolean") {
    return { ok: false, error: "success must be a boolean" };
  }
  if (
    typeof b.savingsCents !== "number" ||
    !Number.isInteger(b.savingsCents) ||
    b.savingsCents < 0
  ) {
    return {
      ok: false,
      error: "savingsCents must be a non-negative integer",
    };
  }
  if (
    typeof b.finalTotalCents !== "number" ||
    !Number.isInteger(b.finalTotalCents) ||
    b.finalTotalCents < 0
  ) {
    return {
      ok: false,
      error: "finalTotalCents must be a non-negative integer",
    };
  }

  return {
    ok: true,
    domain: b.domain.trim(),
    code: b.code.trim(),
    success: b.success,
    savingsCents: b.savingsCents,
    finalTotalCents: b.finalTotalCents,
  };
}
