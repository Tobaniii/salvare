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

    await expect(page.locator("#health-service")).toHaveText("salvare-backend");
    await expect(page.locator("#health-version")).not.toHaveText("Loading…");
    await expect(page.locator("#health-schema")).toHaveText("yes");
    await expect(page.locator("#health-token")).toHaveText("no");

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

    const couponsExport = await request.get(
      `${salvare.baseUrl}/admin/export/coupons`,
    );
    expect(couponsExport.status()).toBe(200);
    const couponsExportBody = await couponsExport.json();
    expect(couponsExportBody["smoke.test"]).toEqual(["A1", "A2"]);

    const resultsExport = await request.get(
      `${salvare.baseUrl}/admin/export/results`,
    );
    expect(resultsExport.status()).toBe(200);
    const resultsExportBody = await resultsExport.json();
    expect(Array.isArray(resultsExportBody.results)).toBe(true);

    const couponsFixture = JSON.stringify({
      "smoke-import.test": ["IMP1", "IMP2"],
    });
    await page.locator("#import-coupons-file").setInputFiles({
      name: "salvare-coupons-import.json",
      mimeType: "application/json",
      buffer: Buffer.from(couponsFixture, "utf8"),
    });
    await page.locator("#import-coupons-preview").click();
    await expect(page.locator("#import-coupons-summary")).toContainText(
      "Domains: 1",
    );
    await expect(page.locator("#import-coupons-status")).toContainText(
      "Preview ok",
    );
    await expect(page.locator("#import-coupons-apply")).toBeDisabled();
    await page.locator("#import-coupons-confirm").fill("IMPORT");
    await expect(page.locator("#import-coupons-apply")).toBeEnabled();
    await page.locator("#import-coupons-apply").click();
    await expect(page.locator("#import-coupons-status")).toContainText(
      "Imported coupons: 1 domain(s)",
    );
    await expect(page.locator("#import-coupons-confirm")).toHaveValue("");

    const importedCheck = await request.get(
      `${salvare.baseUrl}/coupons?domain=smoke-import.test`,
    );
    expect(importedCheck.status()).toBe(200);
    const importedBody = await importedCheck.json();
    expect(importedBody.candidateCodes.sort()).toEqual(["IMP1", "IMP2"]);
  });
});
