export type CouponApiSource = "mock-backend" | "none";

export interface CouponApiResponse {
  domain: string;
  candidateCodes: string[];
  source: CouponApiSource;
  updatedAt: string;
}

export function buildCouponResponse(
  domain: string,
  candidateCodes: string[],
  now: () => Date = () => new Date(),
): CouponApiResponse {
  const updatedAt = now().toISOString();
  if (candidateCodes.length > 0) {
    return {
      domain,
      candidateCodes,
      source: "mock-backend",
      updatedAt,
    };
  }
  return {
    domain,
    candidateCodes: [],
    source: "none",
    updatedAt,
  };
}

export interface AdminCouponsBody {
  domain: string;
  candidateCodes: string[];
}

export type AdminBodyValidation =
  | { ok: true; domain: string; candidateCodes: string[] }
  | { ok: false; error: string };

export function validateAdminBody(body: unknown): AdminBodyValidation {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "body must be an object" };
  }
  const b = body as Record<string, unknown>;
  if (typeof b.domain !== "string" || b.domain.trim().length === 0) {
    return { ok: false, error: "domain must be a non-empty string" };
  }
  if (!Array.isArray(b.candidateCodes)) {
    return { ok: false, error: "candidateCodes must be an array" };
  }
  for (const code of b.candidateCodes) {
    if (typeof code !== "string" || code.trim().length === 0) {
      return {
        ok: false,
        error: "candidateCodes must contain only non-empty strings",
      };
    }
  }
  return {
    ok: true,
    domain: b.domain.trim(),
    candidateCodes: b.candidateCodes as string[],
  };
}

export type DomainParamValidation =
  | { ok: true; domain: string }
  | { ok: false; error: string };

export function validateDomainParam(
  raw: string | null | undefined,
): DomainParamValidation {
  if (typeof raw !== "string") {
    return { ok: false, error: "missing domain" };
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { ok: false, error: "missing domain" };
  }
  return { ok: true, domain: trimmed };
}
