import { getCandidateCodesForDomain } from "./couponCandidates";
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

function findPossibleSubtotalText(): string | null {
  return findMoneyAfterLabel(["Subtotal", "Cart subtotal", "Order subtotal"]);
}

function findPossibleTotalText(): string | null {
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

function scanCheckoutPage(): SalvareCheckoutScan {
  const subtotalText = findPossibleSubtotalText();
  const totalText = findPossibleTotalText();

  return {
    domain: window.location.hostname,
    subtotalText,
    subtotalCents: subtotalText ? parseMoneyToCents(subtotalText) : null,
    totalText,
    totalCents: totalText ? parseMoneyToCents(totalText) : null,
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

function applyCouponCode(code: string): boolean {
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
async function testCouponCodes(codes: string[]): Promise<void> {
  for (const code of codes) {
    applyCouponCode(code);

    await new Promise((resolve) => setTimeout(resolve, 1000));

    const scanAfterApply = scanCheckoutPage();

    console.log(`Salvare tested ${code}:`, {
      detectedTotalCents: scanAfterApply.totalCents,
      scan: scanAfterApply,
    });
  }
}
async function findBestWorkingCoupon(codes: string[]): Promise<void> {
  const results: { code: string; totalCents: number }[] = [];

  for (const code of codes) {
    applyCouponCode(code);

    await new Promise((resolve) => setTimeout(resolve, 1000));

    const scanAfterApply = scanCheckoutPage();

    if (scanAfterApply.totalCents !== null) {
      results.push({
        code,
        totalCents: scanAfterApply.totalCents,
      });
    }
  }

  if (results.length === 0) {
    console.log("Salvare could not determine best coupon");
    return;
  }

  const best = results.reduce((lowest, current) =>
    current.totalCents < lowest.totalCents ? current : lowest
  );

  console.log("Salvare coupon test results:", results);
  console.log("Salvare best tested coupon:", best);
  
  applyCouponCode(best.code);
  console.log(`Salvare re-applied best coupon: ${best.code}`);
}

const scan = scanCheckoutPage();

console.log("Salvare checkout scan:", scan);
logPossibleCheckoutText();

const candidateCodes = getCandidateCodesForDomain(window.location.hostname);

if (candidateCodes.length > 0) {
  findBestWorkingCoupon(candidateCodes);
} else {
  console.log("Salvare found no candidate coupons for this store.");
}

