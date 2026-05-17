const RESULTS_URL = "http://localhost:4123/results";
const TIMEOUT_MS = 750;
// Bounded retry (v0.50.0): exactly ONE extra attempt, failure-only. No
// elaborate backoff/queue — this is best-effort result reporting.
const MAX_ATTEMPTS = 2;

export interface CouponResultReport {
  domain: string;
  code: string;
  success: boolean;
  savingsCents: number;
  finalTotalCents: number;
}

async function attemptReport(result: CouponResultReport): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(RESULTS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(result),
      signal: controller.signal,
    });
    return response.ok === true;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Best-effort POST of a single coupon result. Always resolves `undefined`
 * and never throws (callers fire-and-forget). On a failed attempt (network
 * error, sync throw, or non-OK response) it retries ONCE. The optional
 * `onOutcome` callback reports the final success/failure so the popup can
 * surface "result not saved" feedback without changing the resolved value.
 */
export async function reportCouponResult(
  result: CouponResultReport,
  onOutcome?: (ok: boolean) => void,
): Promise<void> {
  let ok = false;
  for (let attempt = 0; attempt < MAX_ATTEMPTS && !ok; attempt++) {
    ok = await attemptReport(result);
  }
  if (onOutcome) {
    try {
      onOutcome(ok);
    } catch {
      // Never let feedback wiring break best-effort reporting.
    }
  }
}
