import { tokenTest as test, expect } from "./fixtures";

test.describe("token-mode smoke", () => {
  test.describe("admin UI token flow", () => {
    test.beforeEach(async ({ salvareWithToken, page }) => {
      await page.goto(`${salvareWithToken.baseUrl}/admin`);
      await page.evaluate(() =>
        localStorage.removeItem("salvareAdminToken"),
      );
    });

    test("loads (200) and shows token-required banner before any token", async ({
      salvareWithToken,
      page,
    }) => {
      const response = await page.goto(`${salvareWithToken.baseUrl}/admin`);
      expect(response).not.toBeNull();
      expect(response!.status()).toBe(200);
      await expect(
        page.getByRole("heading", { name: "Salvare admin" }),
      ).toBeVisible();
      await expect(page.locator("#auth-banner")).toBeVisible();
      await expect(page.locator(".domain-section")).toHaveCount(0);
      await expect(page.locator("#health-service")).toHaveText(
        "salvare-backend",
      );
      await expect(page.locator("#health-token")).toHaveText("yes");
      await expect(page.locator("#health-schema")).toHaveText("yes");
    });

    test("entering correct token loads seeded domains; clearing returns to banner", async ({
      salvareWithToken,
      page,
    }) => {
      await page.goto(`${salvareWithToken.baseUrl}/admin`);
      await expect(page.locator("#auth-banner")).toBeVisible();

      await page.locator("#token-input").fill(salvareWithToken.token);
      await page.locator("#token-save").click();

      await expect(page.locator("#auth-banner")).toBeHidden();
      await expect(
        page.locator(".domain-name", { hasText: "smoke.test" }),
      ).toBeVisible();
      await expect(page.locator("#token-status")).toContainText(
        "Token saved",
      );
      await expect(page.locator("#token-input")).toHaveValue("");

      await page.locator("#token-clear").click();
      await expect(page.locator("#auth-banner")).toBeVisible();
      await expect(page.locator(".domain-section")).toHaveCount(0);
      await expect(page.locator("#token-status")).toContainText(
        "Token cleared",
      );
    });

    test("entering wrong token shows the unauthorized banner", async ({
      salvareWithToken,
      page,
    }) => {
      await page.goto(`${salvareWithToken.baseUrl}/admin`);
      await page.locator("#token-input").fill("not-the-right-token");
      await page.locator("#token-save").click();

      await expect(page.locator("#auth-banner")).toBeVisible();
      await expect(page.locator(".domain-section")).toHaveCount(0);
    });

    test("token persists in localStorage across page reloads", async ({
      salvareWithToken,
      page,
    }) => {
      await page.goto(`${salvareWithToken.baseUrl}/admin`);
      await page.locator("#token-input").fill(salvareWithToken.token);
      await page.locator("#token-save").click();
      await expect(
        page.locator(".domain-name", { hasText: "smoke.test" }),
      ).toBeVisible();

      await page.reload();

      await expect(page.locator("#auth-banner")).toBeHidden();
      await expect(
        page.locator(".domain-name", { hasText: "smoke.test" }),
      ).toBeVisible();
      await expect(page.locator("#token-input")).toHaveValue("");
      await expect(page.locator("#token-status")).toContainText(
        "Token saved",
      );
    });
  });

  test("GET /admin/coupons rejects without Authorization", async ({
    salvareWithToken,
    request,
  }) => {
    const res = await request.get(`${salvareWithToken.baseUrl}/admin/coupons`);
    expect(res.status()).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });

  test("GET /admin/coupons accepts correct Bearer token", async ({
    salvareWithToken,
    request,
  }) => {
    const res = await request.get(
      `${salvareWithToken.baseUrl}/admin/coupons`,
      { headers: { Authorization: `Bearer ${salvareWithToken.token}` } },
    );
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.coupons).toEqual({ "smoke.test": ["A1", "A2"] });
  });

  test("POST /admin/coupons accepts correct Bearer token", async ({
    salvareWithToken,
    request,
  }) => {
    const res = await request.post(
      `${salvareWithToken.baseUrl}/admin/coupons`,
      {
        headers: { Authorization: `Bearer ${salvareWithToken.token}` },
        data: { domain: "tok-add.com", candidateCodes: ["T1"] },
      },
    );
    expect(res.status()).toBe(200);
    expect(await res.json()).toEqual({
      domain: "tok-add.com",
      candidateCodes: ["T1"],
    });
  });

  test("GET /coupons stays open without Authorization", async ({
    salvareWithToken,
    request,
  }) => {
    const res = await request.get(
      `${salvareWithToken.baseUrl}/coupons?domain=smoke.test`,
    );
    expect(res.status()).toBe(200);
  });

  test("POST /results stays open without Authorization (extension path)", async ({
    salvareWithToken,
    request,
  }) => {
    const res = await request.post(`${salvareWithToken.baseUrl}/results`, {
      data: {
        domain: "smoke.test",
        code: "A1",
        success: true,
        savingsCents: 100,
        finalTotalCents: 900,
      },
    });
    expect(res.status()).toBe(200);
  });
});
