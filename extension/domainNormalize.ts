// Conservative domain normalization for the extension lookup key. Applied to
// window.location.hostname before profile lookup, backend fetch, and result
// reporting, and to profile.domain on compare — so extension and server
// resolve the same key symmetrically.
//
// Rule: trim, lowercase, then strip a SINGLE leading "www." prefix. No eTLD
// logic, no subdomain collapsing, no fuzzy match.
//
// MUST stay byte-identical in behavior to server/domain-normalize.ts
// (a parity test enforces it).

export function normalizeLookupDomain(raw: string): string {
  const lowered = raw.trim().toLowerCase();
  if (lowered.startsWith("www.")) {
    return lowered.slice(4);
  }
  return lowered;
}
