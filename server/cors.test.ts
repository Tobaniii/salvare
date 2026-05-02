import { describe, it, expect } from "vitest";
import { buildCorsHeaders } from "./cors";

describe("buildCorsHeaders", () => {
  it("echoes http://localhost", () => {
    const headers = buildCorsHeaders("http://localhost");
    expect(headers).not.toBeNull();
    expect(headers!["Access-Control-Allow-Origin"]).toBe("http://localhost");
  });

  it("echoes http://localhost:5173", () => {
    const headers = buildCorsHeaders("http://localhost:5173");
    expect(headers).not.toBeNull();
    expect(headers!["Access-Control-Allow-Origin"]).toBe(
      "http://localhost:5173",
    );
  });

  it("echoes http://salvare-woo-test.local", () => {
    const headers = buildCorsHeaders("http://salvare-woo-test.local");
    expect(headers).not.toBeNull();
    expect(headers!["Access-Control-Allow-Origin"]).toBe(
      "http://salvare-woo-test.local",
    );
  });

  it("echoes https://salvare-test-store.myshopify.com", () => {
    const headers = buildCorsHeaders(
      "https://salvare-test-store.myshopify.com",
    );
    expect(headers).not.toBeNull();
    expect(headers!["Access-Control-Allow-Origin"]).toBe(
      "https://salvare-test-store.myshopify.com",
    );
  });

  it("returns null for an unknown origin", () => {
    expect(buildCorsHeaders("https://evil.example.com")).toBeNull();
  });

  it("returns null for missing or empty origin", () => {
    expect(buildCorsHeaders(undefined)).toBeNull();
    expect(buildCorsHeaders(null)).toBeNull();
    expect(buildCorsHeaders("")).toBeNull();
  });

  it("includes the expected methods and headers fields", () => {
    const headers = buildCorsHeaders("http://localhost");
    expect(headers!["Access-Control-Allow-Methods"]).toBe(
      "GET, POST, DELETE, OPTIONS",
    );
    expect(headers!["Access-Control-Allow-Headers"]).toBe("Content-Type");
  });
});
