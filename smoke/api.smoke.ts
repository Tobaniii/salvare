import { test, expect } from "./fixtures";

test.describe("API smoke", () => {
  test("GET /coupons returns seeded codes for the domain", async ({
    salvare,
    request,
  }) => {
    const res = await request.get(
      `${salvare.baseUrl}/coupons?domain=smoke.test`,
    );
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.domain).toBe("smoke.test");
    expect(body.source).toBe("mock-backend");
    expect(body.candidateCodes.sort()).toEqual(["A1", "A2"]);
  });

  test("ranking and stats reflect reported results", async ({
    salvare,
    request,
  }) => {
    const a2Success = await request.post(`${salvare.baseUrl}/results`, {
      data: {
        domain: "smoke.test",
        code: "A2",
        success: true,
        savingsCents: 500,
        finalTotalCents: 9500,
      },
    });
    expect(a2Success.status()).toBe(200);

    const a1Failure = await request.post(`${salvare.baseUrl}/results`, {
      data: {
        domain: "smoke.test",
        code: "A1",
        success: false,
        savingsCents: 0,
        finalTotalCents: 10000,
      },
    });
    expect(a1Failure.status()).toBe(200);

    const ranked = await request.get(
      `${salvare.baseUrl}/coupons?domain=smoke.test`,
    );
    expect(ranked.status()).toBe(200);
    const rankedBody = await ranked.json();
    expect(rankedBody.candidateCodes).toEqual(["A2", "A1"]);

    const stats = await request.get(
      `${salvare.baseUrl}/admin/coupon-stats?domain=smoke.test`,
    );
    expect(stats.status()).toBe(200);
    const statsBody = await stats.json();
    expect(statsBody.domain).toBe("smoke.test");
    expect(statsBody.codes).toHaveLength(2);
    const a2 = statsBody.codes.find(
      (c: { code: string }) => c.code === "A2",
    );
    const a1 = statsBody.codes.find(
      (c: { code: string }) => c.code === "A1",
    );
    expect(a2.rank).toBe(1);
    expect(a2.successCount).toBe(1);
    expect(a2.failureCount).toBe(0);
    expect(a2.averageSavingsCents).toBe(500);
    expect(typeof a2.lastSuccessAt).toBe("string");
    expect(a1.rank).toBe(2);
    expect(a1.successCount).toBe(0);
    expect(a1.failureCount).toBe(1);
  });
});
