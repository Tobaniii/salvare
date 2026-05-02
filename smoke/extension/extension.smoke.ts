import { test, expect, openPopup } from "./fixtures";

const CHECKOUT_URL = "http://localhost:5173";
// data: URLs don't match the extension's content_script `<all_urls>` filter,
// so no content script is injected — the popup's sendMessage fails and the
// UNSUPPORTED_FALLBACK message is shown. That's exactly the unsupported UX.
const UNSUPPORTED_CHECKOUT_URL =
  "data:text/html,%3Chtml%3E%3Cbody%3E%3Ch1%3ENot%20a%20Salvare%20checkout%3C%2Fh1%3E%3C%2Fbody%3E%3C%2Fhtml%3E";
const HARNESS_URL = "http://localhost:4123";

test.describe("Salvare extension on the local React checkout", () => {
  test("popup runs Find Best Coupon end-to-end on a supported checkout", async ({
    ext,
    request,
  }) => {
    test.setTimeout(90_000);

    // Pre-clear any history so the result-reporting assertion is unambiguous.
    await request.delete(`${HARNESS_URL}/results?domain=localhost`);

    const checkout = await ext.context.newPage();
    await checkout.goto(CHECKOUT_URL);
    await expect(
      checkout.getByRole("heading", { name: "Salvare" }),
    ).toBeVisible();
    await expect(
      checkout.getByRole("heading", { name: "Cart" }),
    ).toBeVisible();

    const popup = await openPopup(ext, CHECKOUT_URL);

    await expect(popup.locator("#status")).toContainText("Store supported", {
      timeout: 15_000,
    });
    await expect(popup.locator("#status")).toContainText(
      "Ready to test coupons.",
    );

    await popup.locator("#find-best").click();

    await expect(popup.locator("#status")).toContainText(/Best code: /, {
      timeout: 60_000,
    });

    const statusText = (await popup.locator("#status").textContent()) ?? "";
    const match = statusText.match(
      /Best code: (\S+)\nFinal total: \$(\d+\.\d{2})\nYou saved: \$(\d+\.\d{2})/,
    );
    expect(match, `popup status did not match expected pattern: ${statusText}`)
      .not.toBeNull();
    const [, bestCode, finalTotalStr] = match!;
    expect(["SAVE10", "TAKE15", "FREESHIP"]).toContain(bestCode);

    // Cross-check the React app's grand-total locator.
    const grandTotal = checkout.locator(".totals .grand span").last();
    await expect(grandTotal).toHaveText(`$${finalTotalStr}`, {
      timeout: 10_000,
    });

    // Backend should have received at least one report from the extension.
    const results = await request.get(
      `${HARNESS_URL}/results?domain=localhost`,
    );
    expect(results.status()).toBe(200);
    const body = await results.json();
    expect(Array.isArray(body.results)).toBe(true);
    expect(body.results.length).toBeGreaterThan(0);
    expect(
      body.results.some((r: { success: boolean }) => r.success === true),
    ).toBe(true);
  });

  test("popup shows the unsupported message on a non-profiled page", async ({
    ext,
  }) => {
    const checkout = await ext.context.newPage();
    await checkout.goto(UNSUPPORTED_CHECKOUT_URL);
    await expect(
      checkout.getByRole("heading", { name: "Not a Salvare checkout" }),
    ).toBeVisible();

    // openPopup matches the active tab by URL prefix. The data: URL above
    // begins with "data:text/html," so we use that as the prefix.
    const popup = await openPopup(ext, "data:text/html,");

    await expect(popup.locator("#status")).toContainText(
      /This store is not supported yet\.|Open a supported checkout page to use Salvare\./,
      { timeout: 15_000 },
    );
  });
});
