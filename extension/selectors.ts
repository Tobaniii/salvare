// Centralized selector keyword lists and pure predicates used by the content
// script when looking for coupon inputs and apply buttons. Keeping the keyword
// sets in one module makes them testable and lets future profiles reuse them.

export const COUPON_INPUT_KEYWORDS = [
  "coupon",
  "promo",
  "discount",
  "voucher",
] as const;

export const APPLY_BUTTON_KEYWORDS = [
  "apply",
  "redeem",
  "use code",
] as const;

export interface CouponInputAttrs {
  name?: string | null;
  id?: string | null;
  placeholder?: string | null;
  ariaLabel?: string | null;
  autocomplete?: string | null;
}

export interface ApplyButtonAttrs {
  innerText?: string | null;
  value?: string | null;
  ariaLabel?: string | null;
  title?: string | null;
}

function joinAttrs(parts: Array<string | null | undefined>): string {
  return parts.filter((p): p is string => Boolean(p)).join(" ").toLowerCase();
}

export function inputAttrsMatchCouponKeywords(
  attrs: CouponInputAttrs,
): boolean {
  const text = joinAttrs([
    attrs.name,
    attrs.id,
    attrs.placeholder,
    attrs.ariaLabel,
    attrs.autocomplete,
  ]);
  return COUPON_INPUT_KEYWORDS.some((keyword) => text.includes(keyword));
}

export function buttonAttrsMatchApplyKeywords(
  attrs: ApplyButtonAttrs,
): boolean {
  const text = joinAttrs([
    attrs.innerText,
    attrs.value,
    attrs.ariaLabel,
    attrs.title,
  ]);
  return APPLY_BUTTON_KEYWORDS.some((keyword) => text.includes(keyword));
}

export function readCouponInputAttrs(input: HTMLInputElement): CouponInputAttrs {
  return {
    name: input.name,
    id: input.id,
    placeholder: input.placeholder,
    ariaLabel: input.getAttribute("aria-label"),
    autocomplete: input.getAttribute("autocomplete"),
  };
}

export function readApplyButtonAttrs(element: HTMLElement): ApplyButtonAttrs {
  return {
    innerText: element.innerText,
    value: element.getAttribute("value"),
    ariaLabel: element.getAttribute("aria-label"),
    title: element.getAttribute("title"),
  };
}
