import {
  fetchCandidateCodes,
  getStoreProfileForDomain,
  type StoreProfile,
} from "./storeProfiles";
type SalvareCheckoutScan = {
  domain: string;
  subtotalText: string | null;
  subtotalCents: number | null;
  totalText: string | null;
  totalCents: number | null;
  couponInputsFound: number;
  applyButtonsFound: number;
};

function parseMoneyToCents(value: string): number | null {
  const cleaned = value.replace(/,/g, "").trim();
  const amount = Number(cleaned);

  if (Number.isNaN(amount)) return null;

  return Math.round(amount * 100);
}
function findMoneyAfterLabel(labels: string[]): string | null {
  const lines = document.body.innerText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  for (let i = 0; i < lines.length; i++) {
    const current = lines[i].toLowerCase();

    if (labels.some((label) => current === label.toLowerCase())) {
      const nextLine = lines[i + 1];

      if (!nextLine) continue;

      const moneyMatch = nextLine.match(/\$?\s*(\d+(?:,\d{3})*(?:\.\d{2})?)/);

      if (moneyMatch?.[1]) {
        return moneyMatch[1];
      }
    }
  }

  return null;
}

const MONEY_REGEX = /(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+\.\d{2}|\d+)/g;

function extractMoneyText(text: string): string | null {
  if (!text) return null;
  const matches = text.match(MONEY_REGEX);
  if (!matches || matches.length === 0) return null;
  return matches[matches.length - 1];
}

function isElementVisible(element: Element): boolean {
  const htmlElement = element as HTMLElement;
  if (
    htmlElement.offsetWidth === 0 &&
    htmlElement.offsetHeight === 0 &&
    htmlElement.getClientRects().length === 0
  ) {
    return false;
  }
  const style = window.getComputedStyle(htmlElement);
  return style.visibility !== "hidden" && style.display !== "none";
}

function extractMoneyFromElement(selector: string): string | null {
  const element = document.querySelector(selector);
  if (!element) return null;
  const text = (element as HTMLElement).innerText ?? element.textContent ?? "";
  return extractMoneyText(text);
}

function getVisibleTextAroundLabel(label: string): string | null {
  const target = label.trim().toLowerCase();
  const all = Array.from(document.querySelectorAll<HTMLElement>("*"));

  for (const element of all) {
    const ownText = (element.textContent ?? "").trim().toLowerCase();
    if (ownText !== target) continue;
    if (!isElementVisible(element)) continue;

    let container: HTMLElement | null = element;
    for (let depth = 0; depth < 6 && container; depth++) {
      const containerText =
        container.innerText ?? container.textContent ?? "";
      const money = extractMoneyText(containerText);
      if (money) return money;
      container = container.parentElement;
    }
  }

  return null;
}

function findPossibleSubtotalText(profile?: StoreProfile | null): string | null {
  if (profile?.selectors?.subtotal) {
    const fromSelector = extractMoneyFromElement(profile.selectors.subtotal);
    if (fromSelector) return fromSelector;
  }

  const fromLabel =
    getVisibleTextAroundLabel("Subtotal") ??
    getVisibleTextAroundLabel("Cart subtotal") ??
    getVisibleTextAroundLabel("Order subtotal");
  if (fromLabel) return fromLabel;

  return findMoneyAfterLabel(["Subtotal", "Cart subtotal", "Order subtotal"]);
}

const TOTAL_BLACKLIST = ["subtotal", "discount", "total savings", "savings"];

function containsBlacklistedTotalPhrase(text: string): boolean {
  const lower = text.toLowerCase();
  return TOTAL_BLACKLIST.some((phrase) => lower.includes(phrase));
}

function findWooCommerceTotalText(): string | null {
  const candidates = Array.from(
    document.querySelectorAll<HTMLElement>('[class*="order-total"]'),
  );

  for (const element of candidates) {
    if (!isElementVisible(element)) continue;
    const text = element.innerText ?? element.textContent ?? "";
    if (!text.trim()) continue;
    if (containsBlacklistedTotalPhrase(text)) continue;

    const money = extractMoneyText(text);
    if (money) {
      const totalCents = parseMoneyToCents(money);
      console.log("Salvare Woo total detected:", {
        totalText: money,
        totalCents,
      });
      return money;
    }
  }

  return null;
}

function findTotalRowText(
  labels: string[],
  blacklist: string[],
): string | null {
  const all = Array.from(document.querySelectorAll<HTMLElement>("*"));

  for (const label of labels) {
    const target = label.trim().toLowerCase();

    for (const element of all) {
      const ownText = (element.textContent ?? "").trim().toLowerCase();
      if (ownText !== target) continue;
      if (!isElementVisible(element)) continue;

      let container: HTMLElement | null = element;
      for (let depth = 0; depth < 6 && container; depth++) {
        const containerText = (
          container.innerText ?? container.textContent ?? ""
        ).toLowerCase();

        if (
          containerText.includes(target) &&
          !blacklist.some((phrase) => containerText.includes(phrase))
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

function findPossibleTotalText(profile?: StoreProfile | null): string | null {
  if (profile?.selectors?.total) {
    const fromSelector = extractMoneyFromElement(profile.selectors.total);
    if (fromSelector) return fromSelector;
  }

  const fromWoo = findWooCommerceTotalText();
  if (fromWoo) return fromWoo;

  const fromRow = findTotalRowText(
    ["Total", "Order total", "Grand total"],
    TOTAL_BLACKLIST,
  );
  if (fromRow) return fromRow;

  return findMoneyAfterLabel(["Total", "Order total", "Grand total"]);
}

function findCouponInputs(): HTMLInputElement[] {
  const inputs = Array.from(document.querySelectorAll("input"));

  return inputs.filter((input) => {
    const text = [
      input.name,
      input.id,
      input.placeholder,
      input.getAttribute("aria-label"),
      input.getAttribute("autocomplete"),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    return (
      text.includes("coupon") ||
      text.includes("promo") ||
      text.includes("discount") ||
      text.includes("voucher")
    );
  });
}

function findApplyButtons(): HTMLElement[] {
  const elements = Array.from(
    document.querySelectorAll("button, input[type='submit'], input[type='button']")
  ) as HTMLElement[];

  return elements.filter((element) => {
    const text = [
      element.innerText,
      element.getAttribute("value"),
      element.getAttribute("aria-label"),
      element.getAttribute("title"),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    return (
      text.includes("apply") ||
      text.includes("redeem") ||
      text.includes("use code")
    );
  });
}

function findCouponInputForProfile(
  profile?: StoreProfile | null,
): HTMLInputElement | null {
  if (profile?.selectors?.couponInput) {
    const candidate = document.querySelector(
      profile.selectors.couponInput,
    ) as HTMLInputElement | null;
    if (candidate) return candidate;
  }
  return findCouponInputs()[0] ?? null;
}

function isButtonClickable(button: HTMLElement): boolean {
  if (!isElementVisible(button)) return false;
  const buttonElement = button as HTMLButtonElement;
  if (buttonElement.disabled) return false;
  if (button.getAttribute("aria-disabled") === "true") return false;
  return true;
}

function looksLikeSearchTarget(element: Element | null): boolean {
  if (!element) return false;

  const elementAttrs = [
    element.getAttribute("name"),
    element.getAttribute("id"),
    element.getAttribute("class"),
    element.getAttribute("role"),
    element.getAttribute("aria-label"),
    element.getAttribute("value"),
    (element as HTMLElement).innerText,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (
    elementAttrs.includes("search-submit") ||
    elementAttrs.includes("wp-block-search") ||
    elementAttrs.includes("search")
  ) {
    return true;
  }

  const form = (element as HTMLElement).closest("form");
  if (form) {
    const action = (form.getAttribute("action") ?? "").toLowerCase();
    if (action.includes("?s=") || action.includes("/search")) return true;

    const formAttrs = [
      form.getAttribute("name"),
      form.getAttribute("id"),
      form.getAttribute("class"),
      form.getAttribute("role"),
      form.getAttribute("aria-label"),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    if (formAttrs.includes("search")) return true;
  }

  return false;
}

function pickApplyButtonInScope(
  scope: HTMLElement,
): HTMLButtonElement | null {
  const applyKeywords = ["apply discount", "apply coupon", "apply"];

  const buttons = Array.from(
    scope.querySelectorAll<HTMLButtonElement>(
      "button, input[type='submit'], input[type='button']",
    ),
  );

  for (const keyword of applyKeywords) {
    const match = buttons.find((button) => {
      if (!isButtonClickable(button)) return false;
      if (looksLikeSearchTarget(button)) return false;

      const text = [
        (button as HTMLElement).innerText,
        button.getAttribute("value"),
        button.getAttribute("aria-label"),
        button.getAttribute("title"),
      ]
        .filter(Boolean)
        .join(" ")
        .trim()
        .toLowerCase();
      return text.includes(keyword);
    });
    if (match) return match;
  }

  return null;
}

function findApplyButtonNearInput(
  input: HTMLInputElement,
): HTMLButtonElement | null {
  const primaryScope =
    input.closest<HTMLElement>("form") ??
    input.closest<HTMLElement>("section, fieldset, [role='region']");

  if (primaryScope) {
    const inScope = pickApplyButtonInScope(primaryScope);
    if (inScope) return inScope;
  }

  let container: HTMLElement | null = input.parentElement;
  for (let depth = 0; depth < 8 && container; depth++) {
    const match = pickApplyButtonInScope(container);
    if (match) return match;
    container = container.parentElement;
  }

  return null;
}

function findApplyButtonForProfile(
  profile?: StoreProfile | null,
): HTMLElement | null {
  const input = findCouponInputForProfile(profile);
  if (input) {
    const nearby = findApplyButtonNearInput(input);
    if (nearby) return nearby;
  }

  if (profile?.selectors?.applyButton) {
    const candidate = document.querySelector(
      profile.selectors.applyButton,
    ) as HTMLElement | null;
    if (candidate) return candidate;
  }

  return findApplyButtons()[0] ?? null;
}

function scanCheckoutPage(profile?: StoreProfile | null): SalvareCheckoutScan {
  const subtotalText = findPossibleSubtotalText(profile);
  const totalText = findPossibleTotalText(profile);
  const totalCents = totalText ? parseMoneyToCents(totalText) : null;

  return {
    domain: window.location.hostname,
    subtotalText,
    subtotalCents: subtotalText ? parseMoneyToCents(subtotalText) : null,
    totalText,
    totalCents,
    couponInputsFound: findCouponInputs().length,
    applyButtonsFound: findApplyButtons().length,
  };
}

function logPossibleCheckoutText(): void {
  const lines = document.body.innerText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const interestingLines = lines.filter((line) => {
    const lower = line.toLowerCase();

    return (
      lower.includes("subtotal") ||
      lower.includes("total") ||
      lower.includes("discount") ||
      lower.includes("promo") ||
      lower.includes("coupon") ||
      lower.includes("voucher") ||
      lower.includes("gift card") ||
      lower.includes("code") ||
      lower.includes("shipping") ||
      lower.includes("order")
    );
  });

  console.log("Salvare possible checkout text:", interestingLines.slice(0, 50));
}

function setNativeInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  )?.set;
  if (setter) {
    setter.call(input, value);
  } else {
    input.value = value;
  }
}

function applyCouponCode(
  code: string,
  profile?: StoreProfile | null,
): boolean {
  const input = findCouponInputForProfile(profile);
  if (!input) {
    console.log("Salvare could not find coupon input");
    return false;
  }

  const button =
    findApplyButtonNearInput(input) ?? findApplyButtonForProfile(profile);

  console.log("Salvare apply button text:", button?.textContent);

  if (!button) {
    console.log("Salvare could not find apply button near coupon input");
    return false;
  }

  if (looksLikeSearchTarget(button)) {
    console.warn("Salvare refused to click suspected search button");
    return false;
  }

  input.focus();
  setNativeInputValue(input, code);

  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
  input.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
  );
  input.dispatchEvent(
    new KeyboardEvent("keypress", { key: "Enter", bubbles: true }),
  );
  input.dispatchEvent(
    new KeyboardEvent("keyup", { key: "Enter", bubbles: true }),
  );

  const buttonDisabled =
    (button as HTMLButtonElement).disabled ||
    button.getAttribute("aria-disabled") === "true";

  console.log("Salvare applying coupon:", {
    code,
    inputValueBeforeClick: input.value,
    buttonDisabled,
  });

  button.click();

  const form = input.form;
  if (form) {
    if (looksLikeSearchTarget(form)) {
      console.warn("Salvare skipped submit on suspected search form");
    } else {
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
    }
  }

  return true;
}

function clearCouponInput(profile?: StoreProfile | null): void {
  const input = findCouponInputForProfile(profile);
  if (!input) return;

  input.focus();
  input.value = "";
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}
const DISCOUNT_ERROR_PHRASES = [
  "invalid",
  "expired",
  "not valid",
  "couldn't be used",
  "couldn’t be used",
  "not available",
  "enter a valid discount code",
  "is not a valid",
  "discount code isn't valid",
  "discount code isn’t valid",
];

const DISCOUNT_KEYWORDS = ["discount", "promo", "code", "coupon"];

function getVisibleBodyText(): string {
  return (document.body.innerText ?? "").toLowerCase();
}

function getCouponInputValue(profile?: StoreProfile | null): string {
  const input = findCouponInputForProfile(profile);
  return input?.value ?? "";
}

function codeAppearsAsAppliedDiscount(
  code: string,
  profile?: StoreProfile | null,
): boolean {
  const lowerCode = code.toLowerCase();

  const all = Array.from(document.querySelectorAll<HTMLElement>("*"));
  const inputValue = getCouponInputValue(profile).toLowerCase();

  for (const element of all) {
    if (
      element.tagName === "INPUT" ||
      element.tagName === "SCRIPT" ||
      element.tagName === "STYLE"
    ) {
      continue;
    }
    if (element.children.length > 0) continue;
    if (!isElementVisible(element)) continue;

    const text = (element.textContent ?? "").trim().toLowerCase();
    if (!text || !text.includes(lowerCode)) continue;
    if (text === inputValue) continue;

    let context = "";
    let walker: HTMLElement | null = element;
    for (let depth = 0; depth < 4 && walker; depth++) {
      context = (walker.textContent ?? "").toLowerCase();
      if (DISCOUNT_KEYWORDS.some((keyword) => context.includes(keyword))) {
        return true;
      }
      walker = walker.parentElement;
    }
  }

  return false;
}

function discountErrorVisible(): boolean {
  const bodyText = getVisibleBodyText();
  return DISCOUNT_ERROR_PHRASES.some((phrase) => bodyText.includes(phrase));
}

async function waitForDiscountResult(
  code: string,
  timeoutMs = 6000,
  profile?: StoreProfile | null,
): Promise<"applied" | "rejected" | "timeout"> {
  const POLL_MS = 300;
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    if (discountErrorVisible()) return "rejected";
    if (codeAppearsAsAppliedDiscount(code, profile)) return "applied";
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }

  return "timeout";
}

async function waitForTotalChange(
  profile: StoreProfile | null | undefined,
  previousTotalCents: number | null,
  timeoutMs = 5000,
): Promise<number | null> {
  const POLL_MS = 300;
  const start = Date.now();
  let latestTotalCents: number | null = null;

  while (Date.now() - start < timeoutMs) {
    const scan = scanCheckoutPage(profile);
    if (scan.totalCents !== null) {
      latestTotalCents = scan.totalCents;
      if (scan.totalCents !== previousTotalCents) {
        return scan.totalCents;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }

  return latestTotalCents;
}

function isCheckoutBusy(profile?: StoreProfile | null): boolean {
  const button = findApplyButtonForProfile(profile);
  if (button) {
    const buttonElement = button as HTMLButtonElement;
    if (buttonElement.disabled) return true;
    if (button.getAttribute("aria-disabled") === "true") return true;
    if (button.getAttribute("aria-busy") === "true") return true;
  }

  const busyNearby = document.querySelectorAll(
    '[aria-busy="true"], [role="progressbar"], .loading, .spinner, [data-loading="true"]',
  );
  if (busyNearby.length > 0) return true;

  return false;
}

async function waitForCheckoutIdle(
  profile?: StoreProfile | null,
  timeoutMs = 5000,
): Promise<void> {
  const POLL_MS = 300;
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    if (!isCheckoutBusy(profile)) return;
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

async function removeAppliedDiscounts(
  profile?: StoreProfile | null,
): Promise<void> {
  const candidates = new Set<HTMLElement>();

  const shopifySelectors = [
    "button[aria-label*='Remove']",
    "button[aria-label*='remove']",
    "[data-testid*='remove']",
    "[data-testid*='discount']",
  ];
  for (const selector of shopifySelectors) {
    const found = document.querySelectorAll<HTMLElement>(selector);
    found.forEach((element) => candidates.add(element));
  }

  const interactive = Array.from(
    document.querySelectorAll<HTMLElement>(
      "button, a, [role='button']",
    ),
  );
  const removeKeywords = ["remove discount", "remove", "delete", "clear", "close"];

  for (const element of interactive) {
    const label = [
      element.innerText,
      element.getAttribute("aria-label"),
      element.getAttribute("title"),
    ]
      .filter(Boolean)
      .join(" ")
      .trim()
      .toLowerCase();

    if (!label) continue;
    if (removeKeywords.some((keyword) => label.includes(keyword))) {
      candidates.add(element);
    }
  }

  let clicked = 0;
  for (const element of candidates) {
    if (!isElementVisible(element)) continue;
    try {
      element.click();
      clicked++;
    } catch (err) {
      console.log("Salvare remove click failed:", err);
    }
  }

  if (clicked > 0) {
    console.log(`Salvare clicked ${clicked} possible remove button(s)`);
    await waitForCheckoutIdle(profile, 5000);
  }
}

async function expandCouponSection(
  profile?: StoreProfile | null,
  timeoutMs = 2000,
): Promise<void> {
  const existing = findCouponInputForProfile(profile);
  if (existing && isElementVisible(existing)) return;

  const expandKeywords = [
    "add coupons",
    "add coupon",
    "have a coupon?",
    "have a coupon",
    "coupon code",
    "apply coupon",
  ];

  const candidates = Array.from(
    document.querySelectorAll<HTMLElement>(
      "button, summary, a, [role='button'], [aria-expanded='false']",
    ),
  );

  const nearbyApplyButton = existing
    ? findApplyButtonNearInput(existing)
    : null;

  for (const keyword of expandKeywords) {
    const match = candidates.find((element) => {
      if (!isElementVisible(element)) return false;
      if (nearbyApplyButton && element === nearbyApplyButton) return false;

      const label = [
        element.innerText,
        element.getAttribute("aria-label"),
        element.getAttribute("title"),
      ]
        .filter(Boolean)
        .join(" ")
        .trim()
        .toLowerCase();

      return label.includes(keyword);
    });

    if (match) {
      console.log("Salvare expanding coupon section via:", keyword);
      try {
        match.click();
      } catch (err) {
        console.log("Salvare coupon section click failed:", err);
        return;
      }
      await waitForCheckoutIdle(profile, timeoutMs);
      return;
    }
  }
}

async function findBestWorkingCoupon(
  codes: string[],
  profile?: StoreProfile | null,
): Promise<{
  code: string;
  totalCents: number;
  baselineTotalCents: number;
} | null> {
  const WAIT_MS = 5000;

  const baselineScan = scanCheckoutPage(profile);
  const baselineTotalCents = baselineScan.totalCents;

  console.log("Salvare baseline total:", baselineTotalCents);

  if (baselineTotalCents === null) {
    console.log(
      "Salvare could not read baseline total; cannot judge improvements.",
    );
    return null;
  }

  await expandCouponSection(profile);

  const results: { code: string; totalCents: number }[] = [];

  for (const code of codes) {
    console.log("Salvare testing code:", code);

    const inputCheck = findCouponInputForProfile(profile);
    if (!inputCheck || !isElementVisible(inputCheck)) {
      await expandCouponSection(profile);
    }

    await removeAppliedDiscounts(profile);

    const beforeClearScan = scanCheckoutPage(profile);
    if (
      beforeClearScan.totalCents !== null &&
      beforeClearScan.totalCents !== baselineTotalCents
    ) {
      console.log(
        "Salvare waiting for total to return to baseline before:",
        code,
      );
      await waitForTotalChange(profile, beforeClearScan.totalCents, WAIT_MS);
    }

    clearCouponInput(profile);
    await waitForCheckoutIdle(profile, WAIT_MS);

    applyCouponCode(code, profile);

    const discountResult = await waitForDiscountResult(code, 6000, profile);
    console.log("Salvare discount result:", { code, discountResult });

    await waitForCheckoutIdle(profile, WAIT_MS);
    if (discountResult === "applied") {
      await waitForTotalChange(profile, baselineTotalCents, WAIT_MS);
    }

    const scanAfterApply = scanCheckoutPage(profile);

    const totalCents = scanAfterApply.totalCents;
    const improved =
      discountResult === "applied" &&
      totalCents !== null &&
      totalCents < baselineTotalCents;

    console.log("Salvare tested code result:", {
      code,
      totalCents,
      improved,
      discountResult,
    });

    if (improved && totalCents !== null) {
      results.push({ code, totalCents });
    }
  }

  if (results.length === 0) {
    console.log("Salvare found no coupon that improved the total.");
    return null;
  }

  const best = results.reduce((lowest, current) =>
    current.totalCents < lowest.totalCents ? current : lowest,
  );

  console.log("Salvare coupon test results:", results);
  console.log("Salvare best tested coupon:", best);

  await removeAppliedDiscounts(profile);
  await expandCouponSection(profile);
  clearCouponInput(profile);
  await waitForCheckoutIdle(profile, WAIT_MS);
  applyCouponCode(best.code, profile);
  await waitForCheckoutIdle(profile, WAIT_MS);
  console.log(`Salvare re-applied best coupon: ${best.code}`);

  return { ...best, baselineTotalCents };
}

const initialProfile = getStoreProfileForDomain(window.location.hostname);
const scan = scanCheckoutPage(initialProfile);

console.log("Salvare checkout scan:", scan);
logPossibleCheckoutText();

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type !== "SALVARE_FIND_BEST_COUPON") {
    return;
  }

  const hostname = window.location.hostname;
  const profile = getStoreProfileForDomain(hostname);

  (async () => {
    const codes = await fetchCandidateCodes(hostname);

    if (!profile || codes.length === 0) {
      sendResponse({
        success: false,
        message: "This store is not supported yet.",
      });
      return;
    }

    const best = await findBestWorkingCoupon(codes, profile);

    if (!best) {
      sendResponse({
        success: false,
        message: "No coupon improved the total.",
      });
      return;
    }

    sendResponse({
      success: true,
      bestCode: best.code,
      totalCents: best.totalCents,
      savingsCents: best.baselineTotalCents - best.totalCents,
    });
  })();

  return true;
});

