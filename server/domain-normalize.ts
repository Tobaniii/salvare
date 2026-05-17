// Conservative, lossless-by-policy domain normalization for the read-only
// lookup key only. Applied at the request seam (GET /coupons, GET/POST/DELETE
// /results) so the inbound domain matches canonical seed/store rows.
//
// Rule: trim, lowercase, then strip a SINGLE leading "www." prefix. No eTLD
// logic, no subdomain collapsing, no fuzzy match. Stored rows are already
// canonical (seed + bootstrap) so on existing data this is a no-op.
//
// This module MUST stay byte-identical in behavior to
// extension/domainNormalize.ts (a parity test enforces it).

export function normalizeLookupDomain(raw: string): string {
  const lowered = raw.trim().toLowerCase();
  if (lowered.startsWith("www.")) {
    return lowered.slice(4);
  }
  return lowered;
}
