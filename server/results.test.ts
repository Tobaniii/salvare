import { describe, it, expect } from "vitest";
import { validateResultBody } from "./results";

const validBody = {
  domain: "example.com",
  code: "WELCOME10",
  success: true,
  savingsCents: 1500,
  finalTotalCents: 8500,
};

describe("validateResultBody", () => {
  it("rejects null / array / non-object bodies", () => {
    expect(validateResultBody(null)).toMatchObject({ ok: false });
    expect(validateResultBody("string")).toMatchObject({ ok: false });
    expect(validateResultBody([])).toMatchObject({ ok: false });
  });

  it("rejects missing or empty domain", () => {
    expect(
      validateResultBody({ ...validBody, domain: "" }),
    ).toMatchObject({ ok: false });
    expect(
      validateResultBody({ ...validBody, domain: "   " }),
    ).toMatchObject({ ok: false });
    expect(
      validateResultBody({ ...validBody, domain: 42 }),
    ).toMatchObject({ ok: false });
  });

  it("rejects missing or empty code", () => {
    expect(validateResultBody({ ...validBody, code: "" })).toMatchObject({
      ok: false,
    });
    expect(validateResultBody({ ...validBody, code: "   " })).toMatchObject({
      ok: false,
    });
    expect(validateResultBody({ ...validBody, code: null })).toMatchObject({
      ok: false,
    });
  });

  it("rejects non-boolean success", () => {
    expect(
      validateResultBody({ ...validBody, success: "true" }),
    ).toMatchObject({ ok: false });
    expect(
      validateResultBody({ ...validBody, success: 1 }),
    ).toMatchObject({ ok: false });
  });

  it("rejects negative or non-integer savingsCents", () => {
    expect(
      validateResultBody({ ...validBody, savingsCents: -1 }),
    ).toMatchObject({ ok: false });
    expect(
      validateResultBody({ ...validBody, savingsCents: 1.5 }),
    ).toMatchObject({ ok: false });
    expect(
      validateResultBody({ ...validBody, savingsCents: "100" }),
    ).toMatchObject({ ok: false });
  });

  it("rejects negative or non-integer finalTotalCents", () => {
    expect(
      validateResultBody({ ...validBody, finalTotalCents: -1 }),
    ).toMatchObject({ ok: false });
    expect(
      validateResultBody({ ...validBody, finalTotalCents: 1.5 }),
    ).toMatchObject({ ok: false });
    expect(
      validateResultBody({ ...validBody, finalTotalCents: "8500" }),
    ).toMatchObject({ ok: false });
  });

  it("accepts a valid body and trims domain/code", () => {
    const result = validateResultBody({
      ...validBody,
      domain: " example.com ",
      code: " WELCOME10 ",
    });
    expect(result).toEqual({
      ok: true,
      domain: "example.com",
      code: "WELCOME10",
      success: true,
      savingsCents: 1500,
      finalTotalCents: 8500,
    });
  });
});
