import { describe, it, expect } from "vitest";
import { isAuthorized, readAdminTokenFromEnv } from "./auth";

describe("readAdminTokenFromEnv", () => {
  it("returns null when SALVARE_ADMIN_TOKEN is unset", () => {
    expect(readAdminTokenFromEnv({})).toBeNull();
  });

  it("returns null for an empty string", () => {
    expect(readAdminTokenFromEnv({ SALVARE_ADMIN_TOKEN: "" })).toBeNull();
  });

  it("returns null for a whitespace-only string", () => {
    expect(
      readAdminTokenFromEnv({ SALVARE_ADMIN_TOKEN: "   \t  " }),
    ).toBeNull();
  });

  it("returns the trimmed token when set", () => {
    expect(
      readAdminTokenFromEnv({ SALVARE_ADMIN_TOKEN: "  secret-123  " }),
    ).toBe("secret-123");
  });

  it("preserves the value verbatim once trimmed", () => {
    expect(
      readAdminTokenFromEnv({ SALVARE_ADMIN_TOKEN: "AbCdE-fGh_123" }),
    ).toBe("AbCdE-fGh_123");
  });
});

describe("isAuthorized", () => {
  it("returns true when token is null (auth disabled), regardless of headers", () => {
    expect(isAuthorized({}, null)).toBe(true);
    expect(isAuthorized({ authorization: "Bearer anything" }, null)).toBe(
      true,
    );
    expect(isAuthorized({ authorization: "garbage" }, null)).toBe(true);
  });

  it("returns false when token is set but no Authorization header", () => {
    expect(isAuthorized({}, "secret")).toBe(false);
  });

  it("returns false for non-string authorization header", () => {
    expect(
      isAuthorized(
        { authorization: undefined as unknown as string },
        "secret",
      ),
    ).toBe(false);
  });

  it("returns false for non-Bearer scheme", () => {
    expect(isAuthorized({ authorization: "Basic secret" }, "secret")).toBe(
      false,
    );
    expect(isAuthorized({ authorization: "Token secret" }, "secret")).toBe(
      false,
    );
    expect(isAuthorized({ authorization: "secret" }, "secret")).toBe(false);
  });

  it("returns false for wrong token", () => {
    expect(isAuthorized({ authorization: "Bearer wrong" }, "secret")).toBe(
      false,
    );
  });

  it("returns true for correct Bearer token", () => {
    expect(isAuthorized({ authorization: "Bearer secret" }, "secret")).toBe(
      true,
    );
  });

  it("tolerates extra whitespace around and within the header", () => {
    expect(
      isAuthorized({ authorization: "  Bearer   secret  " }, "secret"),
    ).toBe(true);
  });

  it("accepts case-insensitive scheme", () => {
    expect(isAuthorized({ authorization: "bearer secret" }, "secret")).toBe(
      true,
    );
    expect(isAuthorized({ authorization: "BEARER secret" }, "secret")).toBe(
      true,
    );
  });

  it("compares the token value case-sensitively", () => {
    expect(isAuthorized({ authorization: "Bearer SECRET" }, "secret")).toBe(
      false,
    );
  });

  it("rejects partial/prefix matches", () => {
    expect(
      isAuthorized({ authorization: "Bearer secret-extra" }, "secret"),
    ).toBe(false);
    expect(isAuthorized({ authorization: "Bearer sec" }, "secret")).toBe(
      false,
    );
  });
});
