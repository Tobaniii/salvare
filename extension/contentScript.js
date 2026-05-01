(() => {
  // extension/storeProfiles.ts
  var STORE_PROFILES = [
    {
      domain: "localhost",
      candidateCodes: ["SAVE10", "TAKE15", "FREESHIP"]
    },
    {
      domain: "www.wonderbly.com",
      candidateCodes: ["WELCOME10", "SAVE15", "FREESHIP"]
    },
    {
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

  // extension/contentScript.ts
  function parseMoneyToCents(value) {
    const cleaned = value.replace(/,/g, "").trim();
    const amount = Number(cleaned);
    if (Number.isNaN(amount)) return null;
    return Math.round(amount * 100);
  }
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
  var MONEY_REGEX = /(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+\.\d{2}|\d+)/g;
  function extractMoneyText(text) {
    if (!text) return null;
    const matches = text.match(MONEY_REGEX);
    if (!matches || matches.length === 0) return null;
    return matches[matches.length - 1];
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
  function findCouponInputs() {
    const inputs = Array.from(document.querySelectorAll("input"));
    return inputs.filter((input) => {
      const text = [
        input.name,
        input.id,
        input.placeholder,
        input.getAttribute("aria-label"),
        input.getAttribute("autocomplete")
      ].filter(Boolean).join(" ").toLowerCase();
      return text.includes("coupon") || text.includes("promo") || text.includes("discount") || text.includes("voucher");
    });
  }
  function findApplyButtons() {
    const elements = Array.from(
      document.querySelectorAll("button, input[type='submit'], input[type='button']")
    );
    return elements.filter((element) => {
      const text = [
        element.innerText,
        element.getAttribute("value"),
        element.getAttribute("aria-label"),
        element.getAttribute("title")
      ].filter(Boolean).join(" ").toLowerCase();
      return text.includes("apply") || text.includes("redeem") || text.includes("use code");
    });
  }
  function findCouponInputForProfile(profile) {
    if (profile?.selectors?.couponInput) {
      const candidate = document.querySelector(
        profile.selectors.couponInput
      );
      if (candidate) return candidate;
    }
    return findCouponInputs()[0] ?? null;
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
    return findApplyButtons()[0] ?? null;
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
      couponInputsFound: findCouponInputs().length,
      applyButtonsFound: findApplyButtons().length
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
  async function findBestWorkingCoupon(codes, profile) {
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
    for (const code of codes) {
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
  var initialProfile = getStoreProfileForDomain(window.location.hostname);
  var scan = scanCheckoutPage(initialProfile);
  console.log("Salvare checkout scan:", scan);
  logPossibleCheckoutText();
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type !== "SALVARE_FIND_BEST_COUPON") {
      return;
    }
    const profile = getStoreProfileForDomain(window.location.hostname);
    if (!profile) {
      sendResponse({
        success: false,
        message: "This store is not supported yet."
      });
      return;
    }
    findBestWorkingCoupon(profile.candidateCodes, profile).then((best) => {
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
        savingsCents: best.baselineTotalCents - best.totalCents
      });
    });
    return true;
  });
})();
