// Curated merchant-domain alias resolver (v0.51.0).
//
// Pure, IO-free, no DB, no fs. Maps a small CURATED set of distinct domains
// that are the SAME merchant onto one canonical store key, so a domain's
// coupon candidates, provenance, and result history all resolve to the same
// backend store. Applied AFTER `normalizeLookupDomain` at the GET /coupons
// seam, so both the keys and values below are already canonical form
// (trimmed, lowercased, one leading `www.` stripped).
//
// Rules — non-negotiable, mirroring the SOURCE_POLICY allowlist discipline:
// - EXPLICIT EXACT-KEY MAP ONLY. No regex, prefix, eTLD, subdomain, or fuzzy
//   matching. A domain unifies only if it is literally a key here.
// - ZERO cross-merchant bleed: an unlisted domain returns itself unchanged.
// - Shipped EMPTY in v0.51.0 — `resolveMerchantAlias` is the identity
//   function, so /coupons behavior is byte-identical to v0.50. The mechanism
//   lands; no merchant is unified yet.
// - Every future entry is a separate, explicitly reviewed decision (same
//   discipline as the §9 Phase-6 "empty allowlist" precedent). The map must
//   stay an in-code, code-reviewed constant — never runtime/DB/env mutable.
// - NEVER a ranking or winner input. It only changes which canonical store
//   key is looked up; it cannot move a higher final total above a lower one.

const MERCHANT_ALIASES: Readonly<Record<string, string>> = {};

/**
 * Resolve a normalized lookup domain to its canonical merchant store key.
 * Returns the input unchanged unless it is an explicit alias key. Idempotent
 * for sane curated data (canonical targets are not themselves alias keys).
 */
export function resolveMerchantAlias(domain: string): string {
  return MERCHANT_ALIASES[domain] ?? domain;
}
