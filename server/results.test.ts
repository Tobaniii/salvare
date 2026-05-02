import { describe, it, expect, beforeEach } from "vitest";
import {
  appendResult,
  getResultsForDomain,
  resetResultsForTests,
  setResultsPersistForTests,
  validateResultBody,
} from "./results";

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

describe("results store", () => {
  beforeEach(() => {
    setResultsPersistForTests(() => {});
    resetResultsForTests();
  });

  it("appendResult stores the record and stamps testedAt", () => {
    const stored = appendResult({
      domain: "example.com",
      code: "WELCOME10",
      success: true,
      savingsCents: 1500,
      finalTotalCents: 8500,
    });
    expect(stored.domain).toBe("example.com");
    expect(stored.code).toBe("WELCOME10");
    expect(typeof stored.testedAt).toBe("string");
    expect(stored.testedAt.length).toBeGreaterThan(0);
  });

  it("getResultsForDomain filters by domain", () => {
    appendResult({
      domain: "a.com",
      code: "A1",
      success: true,
      savingsCents: 100,
      finalTotalCents: 900,
    });
    appendResult({
      domain: "b.com",
      code: "B1",
      success: false,
      savingsCents: 0,
      finalTotalCents: 1000,
    });
    appendResult({
      domain: "a.com",
      code: "A2",
      success: true,
      savingsCents: 200,
      finalTotalCents: 800,
    });

    const aRecords = getResultsForDomain("a.com");
    expect(aRecords).toHaveLength(2);
    expect(aRecords.map((r) => r.code)).toEqual(["A1", "A2"]);

    const bRecords = getResultsForDomain("b.com");
    expect(bRecords).toHaveLength(1);
    expect(bRecords[0].code).toBe("B1");
  });

  it("getResultsForDomain returns [] when no records match", () => {
    appendResult({
      domain: "a.com",
      code: "A1",
      success: true,
      savingsCents: 100,
      finalTotalCents: 900,
    });
    expect(getResultsForDomain("missing.com")).toEqual([]);
  });
});
