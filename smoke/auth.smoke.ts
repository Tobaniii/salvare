import { tokenTest as test, expect } from "./fixtures";

test.describe("token-mode smoke", () => {
  test("browser navigation to /admin returns 401 without Authorization", async ({
    salvareWithToken,
    page,
  }) => {
    const response = await page.goto(`${salvareWithToken.baseUrl}/admin`);
    expect(response).not.toBeNull();
    expect(response!.status()).toBe(401);
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
