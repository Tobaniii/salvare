(() => {
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
  function findPossibleSubtotalText() {
    return findMoneyAfterLabel(["Subtotal", "Cart subtotal", "Order subtotal"]);
  }
  function findPossibleTotalText() {
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
  function scanCheckoutPage() {
    const subtotalText = findPossibleSubtotalText();
    const totalText = findPossibleTotalText();
    return {
      domain: window.location.hostname,
      subtotalText,
      subtotalCents: subtotalText ? parseMoneyToCents(subtotalText) : null,
      totalText,
      totalCents: totalText ? parseMoneyToCents(totalText) : null,
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
  function applyCouponCode(code) {
    const input = findCouponInputs()[0];
    const button = findApplyButtons()[0];
    if (!input || !button) {
      console.log("Salvare could not find coupon input or apply button");
      return false;
    }
    input.focus();
    input.value = code;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    button.click();
    console.log(`Salvare applied coupon code: ${code}`);
    return true;
  }
  async function findBestWorkingCoupon(codes) {
    const results = [];
    for (const code of codes) {
      applyCouponCode(code);
      await new Promise((resolve) => setTimeout(resolve, 1e3));
      const scanAfterApply = scanCheckoutPage();
      if (scanAfterApply.totalCents !== null) {
        results.push({
          code,
          totalCents: scanAfterApply.totalCents
        });
      }
    }
    if (results.length === 0) {
      console.log("Salvare could not determine best coupon");
      return;
    }
    const best = results.reduce(
      (lowest, current) => current.totalCents < lowest.totalCents ? current : lowest
    );
    console.log("Salvare coupon test results:", results);
    console.log("Salvare best tested coupon:", best);
    applyCouponCode(best.code);
    console.log(`Salvare re-applied best coupon: ${best.code}`);
  }
  var scan = scanCheckoutPage();
  console.log("Salvare checkout scan:", scan);
  logPossibleCheckoutText();
  findBestWorkingCoupon(["SAVE10", "TAKE15", "FREESHIP"]);
})();
