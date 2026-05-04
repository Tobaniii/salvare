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
      await expect(page.locator("#export-coupons-btn")).toBeVisible();
      await expect(page.locator("#export-results-btn")).toBeVisible();
      await expect(page.locator("#import-coupons-file")).toBeVisible();
      await expect(page.locator("#import-coupons-preview")).toBeVisible();
      await expect(page.locator("#import-coupons-confirm")).toBeVisible();
      await expect(page.locator("#import-coupons-apply")).toBeVisible();
      await expect(page.locator("#import-coupons-apply")).toBeDisabled();
      await expect(page.locator("#import-results-file")).toBeVisible();
      await expect(page.locator("#import-results-preview")).toBeVisible();
      await expect(page.locator("#import-results-confirm")).toBeVisible();
      await expect(page.locator("#import-results-apply")).toBeVisible();
      await expect(page.locator("#import-results-apply")).toBeDisabled();
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

  test("GET /admin/export/coupons rejects without Authorization, accepts with token", async ({
    salvareWithToken,
    request,
  }) => {
    const unauth = await request.get(
      `${salvareWithToken.baseUrl}/admin/export/coupons`,
    );
    expect(unauth.status()).toBe(401);

    const ok = await request.get(
      `${salvareWithToken.baseUrl}/admin/export/coupons`,
      { headers: { Authorization: `Bearer ${salvareWithToken.token}` } },
    );
    expect(ok.status()).toBe(200);
    const body = await ok.json();
    expect(body["smoke.test"]).toEqual(["A1", "A2"]);
  });

  test("GET /admin/export/results rejects without Authorization, accepts with token", async ({
    salvareWithToken,
    request,
  }) => {
    const unauth = await request.get(
      `${salvareWithToken.baseUrl}/admin/export/results`,
    );
    expect(unauth.status()).toBe(401);

    const ok = await request.get(
      `${salvareWithToken.baseUrl}/admin/export/results`,
      { headers: { Authorization: `Bearer ${salvareWithToken.token}` } },
    );
    expect(ok.status()).toBe(200);
    const body = await ok.json();
    expect(Array.isArray(body.results)).toBe(true);
  });

  test("POST /admin/import/preview/coupons rejects without Authorization, accepts with token", async ({
    salvareWithToken,
    request,
  }) => {
    const unauth = await request.post(
      `${salvareWithToken.baseUrl}/admin/import/preview/coupons`,
      { data: { "x.com": ["X1"] } },
    );
    expect(unauth.status()).toBe(401);

    const ok = await request.post(
      `${salvareWithToken.baseUrl}/admin/import/preview/coupons`,
      {
        headers: { Authorization: `Bearer ${salvareWithToken.token}` },
        data: { "x.com": ["X1", "X2"] },
      },
    );
    expect(ok.status()).toBe(200);
    const body = await ok.json();
    expect(body).toMatchObject({
      ok: true,
      type: "coupons",
      domains: 1,
      codes: 2,
      domainNamesTruncated: false,
    });
  });

  test("POST /admin/import/preview/results rejects without Authorization, accepts with token", async ({
    salvareWithToken,
    request,
  }) => {
    const unauth = await request.post(
      `${salvareWithToken.baseUrl}/admin/import/preview/results`,
      { data: { results: [] } },
    );
    expect(unauth.status()).toBe(401);

    const ok = await request.post(
      `${salvareWithToken.baseUrl}/admin/import/preview/results`,
      {
        headers: { Authorization: `Bearer ${salvareWithToken.token}` },
        data: {
          results: [
            {
              domain: "x.com",
              code: "X1",
              success: true,
              savingsCents: 100,
              finalTotalCents: 900,
              testedAt: "2026-05-03T00:00:00.000Z",
            },
          ],
        },
      },
    );
    expect(ok.status()).toBe(200);
    const body = await ok.json();
    expect(body).toMatchObject({
      ok: true,
      type: "results",
      records: 1,
      domains: 1,
      domainNamesTruncated: false,
    });
  });

  test("POST /admin/import/apply/coupons rejects without Authorization, accepts with token", async ({
    salvareWithToken,
    request,
  }) => {
    const unauth = await request.post(
      `${salvareWithToken.baseUrl}/admin/import/apply/coupons`,
      { data: { "applied.com": ["A1"] } },
    );
    expect(unauth.status()).toBe(401);

    const ok = await request.post(
      `${salvareWithToken.baseUrl}/admin/import/apply/coupons`,
      {
        headers: { Authorization: `Bearer ${salvareWithToken.token}` },
        data: { "applied.com": ["A1", "A2"] },
      },
    );
    expect(ok.status()).toBe(200);
    expect(await ok.json()).toEqual({
      ok: true,
      type: "coupons",
      domainsImported: 1,
      codesImported: 2,
    });
  });

  test("POST /admin/import/apply/results rejects without Authorization, accepts with token", async ({
    salvareWithToken,
    request,
  }) => {
    const unauth = await request.post(
      `${salvareWithToken.baseUrl}/admin/import/apply/results`,
      { data: { results: [] } },
    );
    expect(unauth.status()).toBe(401);

    const ok = await request.post(
      `${salvareWithToken.baseUrl}/admin/import/apply/results`,
      {
        headers: { Authorization: `Bearer ${salvareWithToken.token}` },
        data: {
          results: [
            {
              domain: "applied-r.com",
              code: "R1",
              success: true,
              savingsCents: 10,
              finalTotalCents: 90,
              testedAt: "2026-05-04T00:00:00.000Z",
            },
          ],
        },
      },
    );
    expect(ok.status()).toBe(200);
    expect(await ok.json()).toEqual({
      ok: true,
      type: "results",
      recordsImported: 1,
      domainsReplaced: 1,
    });
  });

  test("import apply returns 400 with safe error for invalid payload", async ({
    salvareWithToken,
    request,
  }) => {
    const res = await request.post(
      `${salvareWithToken.baseUrl}/admin/import/apply/coupons`,
      {
        headers: { Authorization: `Bearer ${salvareWithToken.token}` },
        data: { "bad.com": "not-an-array" },
      },
    );
    expect(res.status()).toBe(400);
    expect(await res.json()).toEqual({
      ok: false,
      error: "invalid import payload",
    });
  });

  test("import preview returns 400 with safe error for invalid payload", async ({
    salvareWithToken,
    request,
  }) => {
    const res = await request.post(
      `${salvareWithToken.baseUrl}/admin/import/preview/coupons`,
      {
        headers: { Authorization: `Bearer ${salvareWithToken.token}` },
        data: { "bad.com": "not-an-array" },
      },
    );
    expect(res.status()).toBe(400);
    expect(await res.json()).toEqual({
      ok: false,
      error: "invalid import payload",
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
