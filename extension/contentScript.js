(() => {
  // extension/storeProfiles.ts
  var STORE_PROFILES = [
    {
      id: "localhost-react-cart",
      domain: "localhost",
      candidateCodes: ["SAVE10", "TAKE15", "FREESHIP"]
    },
    {
      id: "wonderbly-com",
      domain: "www.wonderbly.com",
      candidateCodes: ["WELCOME10", "SAVE15", "FREESHIP"]
    },
    {
      id: "shopify-test-store",
      domain: "salvare-test-store.myshopify.com",
      candidateCodes: ["WELCOME10", "SAVE15", "FREESHIP"],
      selectors: {
        couponInput: "input[name='discount'], input[placeholder*='Discount'], input[aria-label*='Discount']",
        applyButton: "button[type='submit'], button",
        subtotal: ".total-line--subtotal .total-line__price",
        total: "[data-checkout-payment-due-target], .payment-due__price, .total-line__price"
      }
    },
    {
      id: "woo-test-local",
      domain: "salvare-woo-test.local",
      candidateCodes: ["WELCOME10", "TAKE20", "FREESHIP"],
      selectors: {
        couponInput: "input[name='coupon_code'], #coupon_code, input[placeholder*='coupon' i], input[aria-label*='coupon' i]",
        applyButton: "button[name='apply_coupon'], input[name='apply_coupon'], button[value='Apply coupon'], input[value='Apply coupon'], button[type='submit'][name='apply_coupon']",
        subtotal: ".cart-subtotal .woocommerce-Price-amount",
        total: ".order-total .woocommerce-Price-amount"
      }
    }
  ];
  function getStoreProfileForDomain(domain) {
    return STORE_PROFILES.find((profile) => profile.domain === domain) ?? null;
  }

  // extension/couponProvider.ts
  var COUPON_PROVIDER_MODE = "backend-with-fallback";
  var BACKEND_URL = "http://localhost:4123/coupons";
  var BACKEND_TIMEOUT_MS = 750;
  function isValidBackendResponse(body) {
    if (!body || typeof body !== "object") return false;
    const candidate = body;
    if (typeof candidate.domain !== "string") return false;
    if (!Array.isArray(candidate.candidateCodes)) return false;
    if (!candidate.candidateCodes.every((c) => typeof c === "string")) {
      return false;
    }
    if (candidate.source !== "mock-backend" && candidate.source !== "none") {
      return false;
    }
    if (typeof candidate.updatedAt !== "string") return false;
    return true;
  }
  async function fetchFromBackend(domain) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), BACKEND_TIMEOUT_MS);
    try {
      const url = `${BACKEND_URL}?domain=${encodeURIComponent(domain)}`;
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) return null;
      let body;
      try {
        body = await response.json();
      } catch {
        return null;
      }
      if (!isValidBackendResponse(body)) return null;
      return body.candidateCodes;
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }
  function getMockCandidateCodes(domain) {
    const profile = getStoreProfileForDomain(domain);
    return profile?.candidateCodes ?? [];
  }
  async function fetchCandidateCodesWithMode(domain, mode) {
    if (mode === "mock") {
      return getMockCandidateCodes(domain);
    }
    const fromBackend = await fetchFromBackend(domain);
    if (fromBackend !== null) return fromBackend;
    return getMockCandidateCodes(domain);
  }
  async function fetchCandidateCodes(domain) {
    return fetchCandidateCodesWithMode(domain, COUPON_PROVIDER_MODE);
  }

  // extension/resultReporter.ts
  var RESULTS_URL = "http://localhost:4123/results";
  var TIMEOUT_MS = 750;
  async function reportCouponResult(result) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      await fetch(RESULTS_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(result),
        signal: controller.signal
      });
    } catch {
    } finally {
      clearTimeout(timeout);
    }
  }

  // extension/moneyParsing.ts
  var MONEY_REGEX = /(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+\.\d{2}|\d+)/g;
  function parseMoneyToCents(value) {
    const cleaned = value.replace(/,/g, "").trim();
    const amount = Number(cleaned);
    if (Number.isNaN(amount)) return null;
    return Math.round(amount * 100);
  }
  function extractMoneyText(text) {
    if (!text) return null;
    const matches = text.match(MONEY_REGEX);
    if (!matches || matches.length === 0) return null;
    return matches[matches.length - 1];
  }

  // extension/selectors.ts
  var COUPON_INPUT_KEYWORDS = [
    "coupon",
    "promo",
    "discount",
    "voucher"
  ];
  var APPLY_BUTTON_KEYWORDS = [
    "apply",
    "redeem",
    "use code"
  ];
  function joinAttrs(parts) {
    return parts.filter((p) => Boolean(p)).join(" ").toLowerCase();
  }
  function inputAttrsMatchCouponKeywords(attrs) {
    const text = joinAttrs([
      attrs.name,
      attrs.id,
      attrs.placeholder,
      attrs.ariaLabel,
      attrs.autocomplete
    ]);
    return COUPON_INPUT_KEYWORDS.some((keyword) => text.includes(keyword));
  }
  function buttonAttrsMatchApplyKeywords(attrs) {
    const text = joinAttrs([
      attrs.innerText,
      attrs.value,
      attrs.ariaLabel,
      attrs.title
    ]);
    return APPLY_BUTTON_KEYWORDS.some((keyword) => text.includes(keyword));
  }
  function readCouponInputAttrs(input) {
    return {
      name: input.name,
      id: input.id,
      placeholder: input.placeholder,
      ariaLabel: input.getAttribute("aria-label"),
      autocomplete: input.getAttribute("autocomplete")
    };
  }
  function readApplyButtonAttrs(element) {
    return {
      innerText: element.innerText,
      value: element.getAttribute("value"),
      ariaLabel: element.getAttribute("aria-label"),
      title: element.getAttribute("title")
    };
  }

  // extension/checkoutScan.ts
  function findCouponInputs(root) {
    const inputs = Array.from(root.querySelectorAll("input"));
    return inputs.filter(
      (input) => inputAttrsMatchCouponKeywords(readCouponInputAttrs(input))
    );
  }
  function findApplyButtons(root) {
    const elements = Array.from(
      root.querySelectorAll(
        "button, input[type='submit'], input[type='button']"
      )
    );
    return elements.filter((element) => {
      const attrs = readApplyButtonAttrs(element);
      if (buttonAttrsMatchApplyKeywords(attrs)) return true;
      if (!attrs.innerText) {
        const fallbackText = element.textContent ?? "";
        if (buttonAttrsMatchApplyKeywords({ ...attrs, innerText: fallbackText })) {
          return true;
        }
      }
      return false;
    });
  }

  // extension/profileDiagnostics.ts
  var SUPPORT_REASON = {
    Ready: "ready",
    HostnameUnrecognized: "hostname_unrecognized",
    NoCandidateCodes: "no_candidate_codes",
    CouponInputMissing: "coupon_input_missing",
    ApplyButtonMissing: "apply_button_missing",
    TotalMissing: "total_missing"
  };
  function deriveSupportReason(input) {
    if (!input.profileMatched) return SUPPORT_REASON.HostnameUnrecognized;
    if (input.candidateCodeCount <= 0) return SUPPORT_REASON.NoCandidateCodes;
    if (!input.couponInputFound) return SUPPORT_REASON.CouponInputMissing;
    if (!input.applyButtonFound) return SUPPORT_REASON.ApplyButtonMissing;
    if (!input.totalDetected) return SUPPORT_REASON.TotalMissing;
    return SUPPORT_REASON.Ready;
  }

  // extension/contentScript.ts
  function findMoneyAfterLabel(labels) {
    const lines = document.body.innerText.split("\n").map((line) => line.trim()).filter(Boolean);
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
  function isElementVisible(element) {
    const htmlElement = element;
    if (htmlElement.offsetWidth === 0 && htmlElement.offsetHeight === 0 && htmlElement.getClientRects().length === 0) {
      return false;
    }
    const style = window.getComputedStyle(htmlElement);
    return style.visibility !== "hidden" && style.display !== "none";
  }
  function extractMoneyFromElement(selector) {
    const element = document.querySelector(selector);
    if (!element) return null;
    const text = element.innerText ?? element.textContent ?? "";
    return extractMoneyText(text);
  }
  function getVisibleTextAroundLabel(label) {
    const target = label.trim().toLowerCase();
    const all = Array.from(document.querySelectorAll("*"));
    for (const element of all) {
      const ownText = (element.textContent ?? "").trim().toLowerCase();
      if (ownText !== target) continue;
      if (!isElementVisible(element)) continue;
      let container = element;
      for (let depth = 0; depth < 6 && container; depth++) {
        const containerText = container.innerText ?? container.textContent ?? "";
        const money = extractMoneyText(containerText);
        if (money) return money;
        container = container.parentElement;
      }
    }
    return null;
  }
  function findPossibleSubtotalText(profile) {
    if (profile?.selectors?.subtotal) {
      const fromSelector = extractMoneyFromElement(profile.selectors.subtotal);
      if (fromSelector) return fromSelector;
    }
    const fromLabel = getVisibleTextAroundLabel("Subtotal") ?? getVisibleTextAroundLabel("Cart subtotal") ?? getVisibleTextAroundLabel("Order subtotal");
    if (fromLabel) return fromLabel;
    return findMoneyAfterLabel(["Subtotal", "Cart subtotal", "Order subtotal"]);
  }
  var TOTAL_BLACKLIST = ["subtotal", "discount", "total savings", "savings"];
  function containsBlacklistedTotalPhrase(text) {
    const lower = text.toLowerCase();
    return TOTAL_BLACKLIST.some((phrase) => lower.includes(phrase));
  }
  function findWooCommerceTotalText() {
    const candidates = Array.from(
      document.querySelectorAll('[class*="order-total"]')
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
          totalCents
        });
        return money;
      }
    }
    return null;
  }
  function findTotalRowText(labels, blacklist) {
    const all = Array.from(document.querySelectorAll("*"));
    for (const label of labels) {
      const target = label.trim().toLowerCase();
      for (const element of all) {
        const ownText = (element.textContent ?? "").trim().toLowerCase();
        if (ownText !== target) continue;
        if (!isElementVisible(element)) continue;
        let container = element;
        for (let depth = 0; depth < 6 && container; depth++) {
          const containerText = (container.innerText ?? container.textContent ?? "").toLowerCase();
          if (containerText.includes(target) && !blacklist.some((phrase) => containerText.includes(phrase))) {
            const money = extractMoneyText(containerText);
            if (money) return money;
          }
          container = container.parentElement;
        }
      }
    }
    return null;
  }
  function findPossibleTotalText(profile) {
    if (profile?.selectors?.total) {
      const fromSelector = extractMoneyFromElement(profile.selectors.total);
      if (fromSelector) return fromSelector;
    }
    const fromWoo = findWooCommerceTotalText();
    if (fromWoo) return fromWoo;
    const fromRow = findTotalRowText(
      ["Total", "Order total", "Grand total"],
      TOTAL_BLACKLIST
    );
    if (fromRow) return fromRow;
    return findMoneyAfterLabel(["Total", "Order total", "Grand total"]);
  }
  function findCouponInputs2() {
    return findCouponInputs(document);
  }
  function findApplyButtons2() {
    return findApplyButtons(document);
  }
  function findCouponInputForProfile(profile) {
    if (profile?.selectors?.couponInput) {
      const candidate = document.querySelector(
        profile.selectors.couponInput
      );
      if (candidate) return candidate;
    }
    return findCouponInputs2()[0] ?? null;
  }
  function isButtonClickable(button) {
    if (!isElementVisible(button)) return false;
    const buttonElement = button;
    if (buttonElement.disabled) return false;
    if (button.getAttribute("aria-disabled") === "true") return false;
    return true;
  }
  function looksLikeSearchTarget(element) {
    if (!element) return false;
    const elementAttrs = [
      element.getAttribute("name"),
      element.getAttribute("id"),
      element.getAttribute("class"),
      element.getAttribute("role"),
      element.getAttribute("aria-label"),
      element.getAttribute("value"),
      element.innerText
    ].filter(Boolean).join(" ").toLowerCase();
    if (elementAttrs.includes("search-submit") || elementAttrs.includes("wp-block-search") || elementAttrs.includes("search")) {
      return true;
    }
    const form = element.closest("form");
    if (form) {
      const action = (form.getAttribute("action") ?? "").toLowerCase();
      if (action.includes("?s=") || action.includes("/search")) return true;
      const formAttrs = [
        form.getAttribute("name"),
        form.getAttribute("id"),
        form.getAttribute("class"),
        form.getAttribute("role"),
        form.getAttribute("aria-label")
      ].filter(Boolean).join(" ").toLowerCase();
      if (formAttrs.includes("search")) return true;
    }
    return false;
  }
  function pickApplyButtonInScope(scope) {
    const applyKeywords = ["apply discount", "apply coupon", "apply"];
    const buttons = Array.from(
      scope.querySelectorAll(
        "button, input[type='submit'], input[type='button']"
      )
    );
    for (const keyword of applyKeywords) {
      const match = buttons.find((button) => {
        if (!isButtonClickable(button)) return false;
        if (looksLikeSearchTarget(button)) return false;
        const text = [
          button.innerText,
          button.getAttribute("value"),
          button.getAttribute("aria-label"),
          button.getAttribute("title")
        ].filter(Boolean).join(" ").trim().toLowerCase();
        return text.includes(keyword);
      });
      if (match) return match;
    }
    return null;
  }
  function findApplyButtonNearInput(input) {
    const primaryScope = input.closest("form") ?? input.closest("section, fieldset, [role='region']");
    if (primaryScope) {
      const inScope = pickApplyButtonInScope(primaryScope);
      if (inScope) return inScope;
    }
    let container = input.parentElement;
    for (let depth = 0; depth < 8 && container; depth++) {
      const match = pickApplyButtonInScope(container);
      if (match) return match;
      container = container.parentElement;
    }
    return null;
  }
  function findApplyButtonForProfile(profile) {
    const input = findCouponInputForProfile(profile);
    if (input) {
      const nearby = findApplyButtonNearInput(input);
      if (nearby) return nearby;
    }
    if (profile?.selectors?.applyButton) {
      const candidate = document.querySelector(
        profile.selectors.applyButton
      );
      if (candidate) return candidate;
    }
    return findApplyButtons2()[0] ?? null;
  }
  function scanCheckoutPage(profile) {
    const subtotalText = findPossibleSubtotalText(profile);
    const totalText = findPossibleTotalText(profile);
    const totalCents = totalText ? parseMoneyToCents(totalText) : null;
    return {
      domain: window.location.hostname,
      subtotalText,
      subtotalCents: subtotalText ? parseMoneyToCents(subtotalText) : null,
      totalText,
      totalCents,
      couponInputsFound: findCouponInputs2().length,
      applyButtonsFound: findApplyButtons2().length
    };
  }
  function logPossibleCheckoutText() {
    const lines = document.body.innerText.split("\n").map((line) => line.trim()).filter(Boolean);
    const interestingLines = lines.filter((line) => {
      const lower = line.toLowerCase();
      return lower.includes("subtotal") || lower.includes("total") || lower.includes("discount") || lower.includes("promo") || lower.includes("coupon") || lower.includes("voucher") || lower.includes("gift card") || lower.includes("code") || lower.includes("shipping") || lower.includes("order");
    });
    console.log("Salvare possible checkout text:", interestingLines.slice(0, 50));
  }
  function setNativeInputValue(input, value) {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value"
    )?.set;
    if (setter) {
      setter.call(input, value);
    } else {
      input.value = value;
    }
  }
  function applyCouponCode(code, profile) {
    const input = findCouponInputForProfile(profile);
    if (!input) {
      console.log("Salvare could not find coupon input");
      return false;
    }
    const button = findApplyButtonNearInput(input) ?? findApplyButtonForProfile(profile);
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
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true })
    );
    input.dispatchEvent(
      new KeyboardEvent("keypress", { key: "Enter", bubbles: true })
    );
    input.dispatchEvent(
      new KeyboardEvent("keyup", { key: "Enter", bubbles: true })
    );
    const buttonDisabled = button.disabled || button.getAttribute("aria-disabled") === "true";
    console.log("Salvare applying coupon:", {
      code,
      inputValueBeforeClick: input.value,
      buttonDisabled
    });
    button.click();
    const form = input.form;
    if (form) {
      if (looksLikeSearchTarget(form)) {
        console.warn("Salvare skipped submit on suspected search form");
      } else {
        form.dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true })
        );
      }
    }
    return true;
  }
  function clearCouponInput(profile) {
    const input = findCouponInputForProfile(profile);
    if (!input) return;
    input.focus();
    input.value = "";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }
  var DISCOUNT_ERROR_PHRASES = [
    "invalid",
    "expired",
    "not valid",
    "couldn't be used",
    "couldn\u2019t be used",
    "not available",
    "enter a valid discount code",
    "is not a valid",
    "discount code isn't valid",
    "discount code isn\u2019t valid"
  ];
  var DISCOUNT_KEYWORDS = ["discount", "promo", "code", "coupon"];
  function getVisibleBodyText() {
    return (document.body.innerText ?? "").toLowerCase();
  }
  function getCouponInputValue(profile) {
    const input = findCouponInputForProfile(profile);
    return input?.value ?? "";
  }
  function codeAppearsAsAppliedDiscount(code, profile) {
    const lowerCode = code.toLowerCase();
    const all = Array.from(document.querySelectorAll("*"));
    const inputValue = getCouponInputValue(profile).toLowerCase();
    for (const element of all) {
      if (element.tagName === "INPUT" || element.tagName === "SCRIPT" || element.tagName === "STYLE") {
        continue;
      }
      if (element.children.length > 0) continue;
      if (!isElementVisible(element)) continue;
      const text = (element.textContent ?? "").trim().toLowerCase();
      if (!text || !text.includes(lowerCode)) continue;
      if (text === inputValue) continue;
      let context = "";
      let walker = element;
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
  function discountErrorVisible() {
    const bodyText = getVisibleBodyText();
    return DISCOUNT_ERROR_PHRASES.some((phrase) => bodyText.includes(phrase));
  }
  async function waitForDiscountResult(code, timeoutMs = 6e3, profile) {
    const POLL_MS = 300;
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (discountErrorVisible()) return "rejected";
      if (codeAppearsAsAppliedDiscount(code, profile)) return "applied";
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
    return "timeout";
  }
  async function waitForTotalChange(profile, previousTotalCents, timeoutMs = 5e3) {
    const POLL_MS = 300;
    const start = Date.now();
    let latestTotalCents = null;
    while (Date.now() - start < timeoutMs) {
      const scan2 = scanCheckoutPage(profile);
      if (scan2.totalCents !== null) {
        latestTotalCents = scan2.totalCents;
        if (scan2.totalCents !== previousTotalCents) {
          return scan2.totalCents;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
    return latestTotalCents;
  }
  function isCheckoutBusy(profile) {
    const button = findApplyButtonForProfile(profile);
    if (button) {
      const buttonElement = button;
      if (buttonElement.disabled) return true;
      if (button.getAttribute("aria-disabled") === "true") return true;
      if (button.getAttribute("aria-busy") === "true") return true;
    }
    const busyNearby = document.querySelectorAll(
      '[aria-busy="true"], [role="progressbar"], .loading, .spinner, [data-loading="true"]'
    );
    if (busyNearby.length > 0) return true;
    return false;
  }
  async function waitForCheckoutIdle(profile, timeoutMs = 5e3) {
    const POLL_MS = 300;
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (!isCheckoutBusy(profile)) return;
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
  }
  async function removeAppliedDiscounts(profile) {
    const candidates = /* @__PURE__ */ new Set();
    const shopifySelectors = [
      "button[aria-label*='Remove']",
      "button[aria-label*='remove']",
      "[data-testid*='remove']",
      "[data-testid*='discount']"
    ];
    for (const selector of shopifySelectors) {
      const found = document.querySelectorAll(selector);
      found.forEach((element) => candidates.add(element));
    }
    const interactive = Array.from(
      document.querySelectorAll(
        "button, a, [role='button']"
      )
    );
    const removeKeywords = ["remove discount", "remove", "delete", "clear", "close"];
    for (const element of interactive) {
      const label = [
        element.innerText,
        element.getAttribute("aria-label"),
        element.getAttribute("title")
      ].filter(Boolean).join(" ").trim().toLowerCase();
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
      await waitForCheckoutIdle(profile, 5e3);
    }
  }
  async function expandCouponSection(profile, timeoutMs = 2e3) {
    const existing = findCouponInputForProfile(profile);
    if (existing && isElementVisible(existing)) return;
    const expandKeywords = [
      "add coupons",
      "add coupon",
      "have a coupon?",
      "have a coupon",
      "coupon code",
      "apply coupon"
    ];
    const candidates = Array.from(
      document.querySelectorAll(
        "button, summary, a, [role='button'], [aria-expanded='false']"
      )
    );
    const nearbyApplyButton = existing ? findApplyButtonNearInput(existing) : null;
    for (const keyword of expandKeywords) {
      const match = candidates.find((element) => {
        if (!isElementVisible(element)) return false;
        if (nearbyApplyButton && element === nearbyApplyButton) return false;
        const label = [
          element.innerText,
          element.getAttribute("aria-label"),
          element.getAttribute("title")
        ].filter(Boolean).join(" ").trim().toLowerCase();
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
  async function findBestWorkingCoupon(codes, profile, onProgress) {
    const WAIT_MS = 5e3;
    const baselineScan = scanCheckoutPage(profile);
    const baselineTotalCents = baselineScan.totalCents;
    console.log("Salvare baseline total:", baselineTotalCents);
    if (baselineTotalCents === null) {
      console.log(
        "Salvare could not read baseline total; cannot judge improvements."
      );
      return null;
    }
    await expandCouponSection(profile);
    const results = [];
    for (let i = 0; i < codes.length; i++) {
      const code = codes[i];
      if (onProgress) {
        try {
          onProgress({ current: i + 1, total: codes.length, code });
        } catch (progressErr) {
          console.log("Salvare progress callback failed:", progressErr);
        }
      }
      console.log("Salvare testing code:", code);
      const inputCheck = findCouponInputForProfile(profile);
      if (!inputCheck || !isElementVisible(inputCheck)) {
        await expandCouponSection(profile);
      }
      await removeAppliedDiscounts(profile);
      const beforeClearScan = scanCheckoutPage(profile);
      if (beforeClearScan.totalCents !== null && beforeClearScan.totalCents !== baselineTotalCents) {
        console.log(
          "Salvare waiting for total to return to baseline before:",
          code
        );
        await waitForTotalChange(profile, beforeClearScan.totalCents, WAIT_MS);
      }
      clearCouponInput(profile);
      await waitForCheckoutIdle(profile, WAIT_MS);
      applyCouponCode(code, profile);
      const discountResult = await waitForDiscountResult(code, 6e3, profile);
      console.log("Salvare discount result:", { code, discountResult });
      await waitForCheckoutIdle(profile, WAIT_MS);
      if (discountResult === "applied") {
        await waitForTotalChange(profile, baselineTotalCents, WAIT_MS);
      }
      const scanAfterApply = scanCheckoutPage(profile);
      const totalCents = scanAfterApply.totalCents;
      const improved = discountResult === "applied" && totalCents !== null && totalCents < baselineTotalCents;
      console.log("Salvare tested code result:", {
        code,
        totalCents,
        improved,
        discountResult
      });
      const reportSavings = improved && totalCents !== null ? baselineTotalCents - totalCents : 0;
      const reportFinalTotal = improved && totalCents !== null ? totalCents : baselineTotalCents;
      void reportCouponResult({
        domain: window.location.hostname,
        code,
        success: improved,
        savingsCents: reportSavings,
        finalTotalCents: reportFinalTotal
      });
      if (improved && totalCents !== null) {
        results.push({ code, totalCents });
      }
    }
    if (results.length === 0) {
      console.log("Salvare found no coupon that improved the total.");
      return null;
    }
    const best = results.reduce(
      (lowest, current) => current.totalCents < lowest.totalCents ? current : lowest
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
  async function getCheckoutSupportStatus(domain) {
    const profile = getStoreProfileForDomain(domain);
    if (!profile) {
      return {
        success: true,
        domain,
        supported: false,
        couponInputFound: false,
        applyButtonFound: false,
        totalDetected: false,
        baselineTotalCents: null,
        message: "This store is not supported yet.",
        reason: SUPPORT_REASON.HostnameUnrecognized
      };
    }
    const codes = await fetchCandidateCodes(domain);
    if (codes.length === 0) {
      return {
        success: true,
        domain,
        supported: false,
        couponInputFound: false,
        applyButtonFound: false,
        totalDetected: false,
        baselineTotalCents: null,
        message: "No candidate coupons found for this store.",
        reason: SUPPORT_REASON.NoCandidateCodes,
        profileId: profile.id
      };
    }
    await expandCouponSection(profile);
    const input = findCouponInputForProfile(profile);
    const couponInputFound = !!input;
    const button = input ? findApplyButtonNearInput(input) ?? findApplyButtonForProfile(profile) : null;
    const applyButtonFound = !!button;
    const baselineScan = scanCheckoutPage(profile);
    const baselineTotalCents = baselineScan.totalCents;
    const totalDetected = baselineTotalCents !== null;
    const reason = deriveSupportReason({
      profileMatched: true,
      candidateCodeCount: codes.length,
      couponInputFound,
      applyButtonFound,
      totalDetected
    });
    let message = "Ready to test coupons.";
    if (!couponInputFound) {
      message = "Coupon input not found on this page.";
    } else if (!applyButtonFound) {
      message = "Apply button not found on this page.";
    } else if (!totalDetected) {
      message = "Checkout total not detected.";
    }
    return {
      success: true,
      domain,
      supported: true,
      couponInputFound,
      applyButtonFound,
      totalDetected,
      baselineTotalCents,
      message,
      reason,
      profileId: profile.id
    };
  }
  var initialProfile = getStoreProfileForDomain(window.location.hostname);
  var scan = scanCheckoutPage(initialProfile);
  console.log("Salvare checkout scan:", scan);
  logPossibleCheckoutText();
  function emitCouponProgress(runId, update) {
    try {
      chrome.runtime.sendMessage(
        {
          type: "SALVARE_COUPON_PROGRESS",
          runId,
          current: update.current,
          total: update.total,
          code: update.code
        },
        () => {
          void chrome.runtime.lastError;
        }
      );
    } catch (err) {
      console.log("Salvare progress broadcast failed:", err);
    }
  }
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === "SALVARE_FIND_BEST_COUPON") {
      const hostname = window.location.hostname;
      const profile = getStoreProfileForDomain(hostname);
      const runId = typeof message.runId === "string" ? message.runId : void 0;
      (async () => {
        const codes = await fetchCandidateCodes(hostname);
        if (!profile || codes.length === 0) {
          sendResponse({
            success: false,
            message: "This store is not supported yet."
          });
          return;
        }
        const best = await findBestWorkingCoupon(codes, profile, (update) => {
          emitCouponProgress(runId, update);
        });
        if (!best) {
          sendResponse({
            success: false,
            message: "No coupon improved the total."
          });
          return;
        }
        sendResponse({
          success: true,
          bestCode: best.code,
          totalCents: best.totalCents,
          savingsCents: best.baselineTotalCents - best.totalCents,
          codesTested: codes.length
        });
      })();
      return true;
    }
    if (message.type === "SALVARE_CHECK_SUPPORT") {
      (async () => {
        const status = await getCheckoutSupportStatus(window.location.hostname);
        sendResponse(status);
      })();
      return true;
    }
  });
})();
