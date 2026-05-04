// Pure DOM scan helpers used by the content script and by jsdom-based unit
// tests. Everything here is a pure function of the DOM passed in:
//   - no chrome.* APIs
//   - no fetch / network
//   - no storage / cookies / localStorage
//   - no environment variables
//   - no logging of DOM contents
// The helpers accept a `Document`-like root so tests can pass a JSDOM
// document instead of relying on `globalThis.document`.
//
// Two notes on browser/jsdom parity:
// 1. jsdom does not implement `innerText`. `getElementText` falls back to
//    `textContent`. The content script in a real browser still gets the
//    layout-aware `innerText` it always had.
// 2. Visibility checks (`isElementVisible`) are best-effort under jsdom,
//    which has no layout engine. We treat elements without explicit
//    `display: none` / `visibility: hidden` as visible — sufficient for
//    static HTML fixtures.
//
// Selector keyword matching lives in selectors.ts. This module composes
// those predicates with simple DOM walks.

import {
  buttonAttrsMatchApplyKeywords,
  inputAttrsMatchCouponKeywords,
  readApplyButtonAttrs,
  readCouponInputAttrs,
} from "./selectors";
import { extractMoneyText } from "./moneyParsing";
import type { StoreProfile } from "./storeProfiles";

export type ScanRoot = ParentNode & {
  querySelector: ParentNode["querySelector"];
  querySelectorAll: ParentNode["querySelectorAll"];
};

export interface ScanContext {
  root: ScanRoot;
  view?: { getComputedStyle: typeof window.getComputedStyle } | null;
}

export function getElementText(element: HTMLElement | Element): string {
  const htmlEl = element as HTMLElement;
  const inner = htmlEl.innerText;
  if (typeof inner === "string" && inner.length > 0) return inner;
  return element.textContent ?? "";
}

function isElementVisible(
  element: Element,
  view?: { getComputedStyle: typeof window.getComputedStyle } | null,
): boolean {
  const htmlElement = element as HTMLElement;

  if (
    typeof htmlElement.offsetWidth === "number" &&
    typeof htmlElement.offsetHeight === "number" &&
    htmlElement.offsetWidth === 0 &&
    htmlElement.offsetHeight === 0 &&
    typeof htmlElement.getClientRects === "function" &&
    htmlElement.getClientRects().length === 0
  ) {
    return false;
  }

  if (view && typeof view.getComputedStyle === "function") {
    const style = view.getComputedStyle(htmlElement);
    if (style.visibility === "hidden" || style.display === "none") {
      return false;
    }
  }

  return true;
}

export function findCouponInputs(root: ScanRoot): HTMLInputElement[] {
  const inputs = Array.from(root.querySelectorAll("input"));
  return (inputs as HTMLInputElement[]).filter((input) =>
    inputAttrsMatchCouponKeywords(readCouponInputAttrs(input)),
  );
}

export function findApplyButtons(root: ScanRoot): HTMLElement[] {
  const elements = Array.from(
    root.querySelectorAll(
      "button, input[type='submit'], input[type='button']",
    ),
  ) as HTMLElement[];

  return elements.filter((element) => {
    const attrs = readApplyButtonAttrs(element);
    if (buttonAttrsMatchApplyKeywords(attrs)) return true;

    // jsdom returns undefined for innerText; fall back to textContent so the
    // attribute-based predicate still recognises buttons whose label only
    // appears as text content (e.g. "Redeem", "Apply").
    if (!attrs.innerText) {
      const fallbackText = element.textContent ?? "";
      if (
        buttonAttrsMatchApplyKeywords({ ...attrs, innerText: fallbackText })
      ) {
        return true;
      }
    }
    return false;
  });
}

function extractMoneyFromSelector(
  root: ScanRoot,
  selector: string,
): string | null {
  const element = root.querySelector(selector);
  if (!element) return null;
  const text = getElementText(element);
  return extractMoneyText(text);
}

function findMoneyAfterLabel(
  root: ScanRoot,
  labels: string[],
): string | null {
  const body = (root as Document).body ?? (root as unknown as HTMLElement);
  if (!body) return null;
  const bodyText = getElementText(body);
  const lines = bodyText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  for (let i = 0; i < lines.length; i++) {
    const current = lines[i].toLowerCase();
    if (labels.some((label) => current === label.toLowerCase())) {
      const nextLine = lines[i + 1];
      if (!nextLine) continue;
      const moneyMatch = nextLine.match(/\$?\s*(\d+(?:,\d{3})*(?:\.\d{2})?)/);
      if (moneyMatch?.[1]) return moneyMatch[1];
    }
  }
  return null;
}

const TOTAL_BLACKLIST = ["subtotal", "discount", "total savings", "savings"];

function findTotalRowText(
  root: ScanRoot,
  view: ScanContext["view"],
  labels: string[],
): string | null {
  const all = Array.from(root.querySelectorAll("*")) as HTMLElement[];

  for (const label of labels) {
    const target = label.trim().toLowerCase();

    for (const element of all) {
      const ownText = (element.textContent ?? "").trim().toLowerCase();
      if (ownText !== target) continue;
      if (!isElementVisible(element, view)) continue;

      let container: HTMLElement | null = element;
      for (let depth = 0; depth < 6 && container; depth++) {
        const containerText = getElementText(container).toLowerCase();
        if (
          containerText.includes(target) &&
          !TOTAL_BLACKLIST.some((phrase) => containerText.includes(phrase))
        ) {
          const money = extractMoneyText(containerText);
          if (money) return money;
        }
        container = container.parentElement;
      }
    }
  }
  return null;
}

export function findTotalText(
  context: ScanContext,
  profile?: StoreProfile | null,
): string | null {
  const { root, view } = context;

  if (profile?.selectors?.total) {
    const fromSelector = extractMoneyFromSelector(
      root,
      profile.selectors.total,
    );
    if (fromSelector) return fromSelector;
  }

  const fromRow = findTotalRowText(
    root,
    view,
    ["Total", "Order total", "Grand total"],
  );
  if (fromRow) return fromRow;

  return findMoneyAfterLabel(root, ["Total", "Order total", "Grand total"]);
}

export interface CheckoutScanResult {
  couponInputCount: number;
  applyButtonCount: number;
  totalText: string | null;
}

export function scanCheckoutDom(
  context: ScanContext,
  profile?: StoreProfile | null,
): CheckoutScanResult {
  return {
    couponInputCount: findCouponInputs(context.root).length,
    applyButtonCount: findApplyButtons(context.root).length,
    totalText: findTotalText(context, profile),
  };
}
