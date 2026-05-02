import { test, expect } from "./fixtures";

test.describe("admin page UI", () => {
  test("loads, lists seeded domain, supports add/update/delete", async ({
    salvare,
    page,
    request,
  }) => {
    page.on("dialog", (d) => d.accept());

    await page.goto(`${salvare.baseUrl}/admin`);
    await expect(page.getByRole("heading", { name: "Salvare admin" })).toBeVisible();

    const seededDomain = page.locator(".domain-name", { hasText: "smoke.test" });
    await expect(seededDomain).toBeVisible();

    await page.locator("#domain-input").fill("ui-add.com");
    await page.locator("#codes-input").fill("ADD1, ADD2");
    await page.locator("#admin-form button[type=submit]").click();

    await expect(page.locator("#status")).toHaveText("Saved ui-add.com.");
    const addedDomain = page.locator(".domain-name", { hasText: "ui-add.com" });
    await expect(addedDomain).toBeVisible();
    const addedSection = page
      .locator(".domain-section")
      .filter({ has: addedDomain });
    await expect(addedSection.locator("tbody tr")).toHaveCount(2);
    await expect(addedSection.locator("tbody tr").nth(0)).toContainText("ADD1");
    await expect(addedSection.locator("tbody tr").nth(1)).toContainText("ADD2");

    await page.locator("#domain-input").fill("ui-add.com");
    await page.locator("#codes-input").fill("ADD3");
    await page.locator("#admin-form button[type=submit]").click();
    await expect(page.locator("#status")).toHaveText("Saved ui-add.com.");
    await expect(addedSection.locator("tbody tr")).toHaveCount(1);
    await expect(addedSection.locator("tbody tr").nth(0)).toContainText("ADD3");

    const couponsAfterUpdate = await request.get(
      `${salvare.baseUrl}/coupons?domain=ui-add.com`,
    );
    expect(couponsAfterUpdate.status()).toBe(200);
    const couponsBody = await couponsAfterUpdate.json();
    expect(couponsBody.candidateCodes).toEqual(["ADD3"]);

    await addedSection.locator("button.delete-btn").click();
    await expect(page.locator("#status")).toHaveText("Deleted ui-add.com.");
    await expect(addedDomain).toHaveCount(0);
  });
});
