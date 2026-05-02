const RESULTS_URL = "http://localhost:4123/results";
const TIMEOUT_MS = 750;

export interface CouponResultReport {
  domain: string;
  code: string;
  success: boolean;
  savingsCents: number;
  finalTotalCents: number;
}

// TODO: future milestones could enrich result history with discountResult
// ("applied" | "rejected" | "timeout") and a rejection reason for richer
// analytics. The backend result schema is intentionally minimal in v0.4.0.
export async function reportCouponResult(
  result: CouponResultReport,
): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    await fetch(RESULTS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(result),
      signal: controller.signal,
    });
  } catch {
    // best-effort: swallow all errors
  } finally {
    clearTimeout(timeout);
  }
}
