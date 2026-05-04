// @vitest-environment happy-dom

import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  findApplyButtons,
  findCouponInputs,
  findTotalText,
  scanCheckoutDom,
} from "./checkoutScan";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = resolve(TEST_DIR, "..", "public", "fixtures");

function loadFixture(name: string): Document {
  const html = readFileSync(resolve(FIXTURES_DIR, name), "utf8");
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  const bodyHtml = bodyMatch ? bodyMatch[1] : html;
  document.body.innerHTML = bodyHtml;
  return document;
}

function context(root: Document) {
  return { root, view: window };
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("checkoutScan against alt-coupon.html", () => {
  it("finds the alternate coupon input via name/placeholder fallback", () => {
    const doc = loadFixture("alt-coupon.html");
    const inputs = findCouponInputs(doc);
    expect(inputs).toHaveLength(1);
    expect(inputs[0].getAttribute("name")).toBe("discount_code");
  });

  it("finds the apply button", () => {
    const doc = loadFixture("alt-coupon.html");
    expect(findApplyButtons(doc)).toHaveLength(1);
  });

  it("detects the order total", () => {
    const doc = loadFixture("alt-coupon.html");
    expect(findTotalText(context(doc))).toBe("42.00");
  });
});

describe("checkoutScan against alt-apply.html", () => {
  it("finds the alternate apply button via 'Redeem' keyword", () => {
    const doc = loadFixture("alt-apply.html");
    const buttons = findApplyButtons(doc);
    expect(buttons).toHaveLength(1);
    expect(buttons[0].textContent?.trim()).toBe("Redeem");
  });

  it("finds the coupon input", () => {
    const doc = loadFixture("alt-apply.html");
    expect(findCouponInputs(doc)).toHaveLength(1);
  });

  it("detects the order total", () => {
    const doc = loadFixture("alt-apply.html");
    expect(findTotalText(context(doc))).toBe("33.00");
  });
});

describe("checkoutScan against missing-input.html", () => {
  it("returns no coupon inputs", () => {
    const doc = loadFixture("missing-input.html");
    expect(findCouponInputs(doc)).toHaveLength(0);
  });

  it("still finds the apply button and total", () => {
    const doc = loadFixture("missing-input.html");
    expect(findApplyButtons(doc).length).toBeGreaterThan(0);
    expect(findTotalText(context(doc))).toBe("28.00");
  });
});

describe("checkoutScan against missing-button.html", () => {
  it("returns no apply buttons", () => {
    const doc = loadFixture("missing-button.html");
    expect(findApplyButtons(doc)).toHaveLength(0);
  });

  it("still finds the coupon input and total", () => {
    const doc = loadFixture("missing-button.html");
    expect(findCouponInputs(doc).length).toBeGreaterThan(0);
    expect(findTotalText(context(doc))).toBe("55.00");
  });
});

describe("checkoutScan against missing-total.html", () => {
  it("returns null for the total", () => {
    const doc = loadFixture("missing-total.html");
    expect(findTotalText(context(doc))).toBeNull();
  });

  it("still finds the coupon input and apply button", () => {
    const doc = loadFixture("missing-total.html");
    expect(findCouponInputs(doc).length).toBeGreaterThan(0);
    expect(findApplyButtons(doc).length).toBeGreaterThan(0);
  });
});

describe("scanCheckoutDom composite result", () => {
  it("aggregates input/button counts and total text on alt-coupon", () => {
    const doc = loadFixture("alt-coupon.html");
    const result = scanCheckoutDom(context(doc));
    expect(result.couponInputCount).toBe(1);
    expect(result.applyButtonCount).toBe(1);
    expect(result.totalText).toBe("42.00");
  });

  it("reports zero coupon inputs and a found total on missing-input", () => {
    const doc = loadFixture("missing-input.html");
    const result = scanCheckoutDom(context(doc));
    expect(result.couponInputCount).toBe(0);
    expect(result.applyButtonCount).toBeGreaterThan(0);
    expect(result.totalText).toBe("28.00");
  });
});
