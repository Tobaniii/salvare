import { describe, it, expect } from "vitest";
import { extractMoneyText, parseMoneyToCents } from "./moneyParsing";

describe("extractMoneyText", () => {
  it("extracts a comma-formatted dollar amount", () => {
    expect(extractMoneyText("$1,025.00")).toBe("1,025.00");
  });

  it("extracts the amount from a USD-prefixed string", () => {
    expect(extractMoneyText("USD $1,025.00")).toBe("1,025.00");
  });

  it("extracts a euro amount", () => {
    expect(extractMoneyText("€155.00")).toBe("155.00");
  });

  it("returns the last money value when multiple are present", () => {
    expect(extractMoneyText("Subtotal $175.00 Total $155.00")).toBe("155.00");
  });

  it("returns null for empty input", () => {
    expect(extractMoneyText("")).toBeNull();
  });
});

describe("parseMoneyToCents", () => {
  it("converts a comma-formatted dollar amount to cents", () => {
    expect(parseMoneyToCents("1,025.00")).toBe(102500);
  });

  it("returns null for non-numeric input", () => {
    expect(parseMoneyToCents("abc")).toBeNull();
  });
});
