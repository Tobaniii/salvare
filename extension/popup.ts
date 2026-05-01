const button = document.getElementById("find-best") as HTMLButtonElement | null;
const statusElement = document.getElementById("status");

function setStatus(message: string) {
  if (statusElement) {
    statusElement.textContent = message;
  }
}

function disableButton() {
  if (button) button.disabled = true;
}

function enableButton() {
  if (button) button.disabled = false;
}

function formatDollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

interface CheckoutSupportResponse {
  success: boolean;
  domain: string;
  supported: boolean;
  couponInputFound: boolean;
  applyButtonFound: boolean;
  totalDetected: boolean;
  baselineTotalCents: number | null;
  message: string;
}

function renderSupportStatus(response: CheckoutSupportResponse): string {
  if (!response.supported) {
    return response.message ?? "This store is not supported yet.";
  }

  if (response.message !== "Ready to test coupons.") {
    return `Store supported\n${response.message}`;
  }

  const lines = [
    "Store supported",
    response.couponInputFound ? "Coupon input found" : "Coupon input missing",
    response.applyButtonFound ? "Apply button found" : "Apply button missing",
    response.totalDetected ? "Total detected" : "Total missing",
    response.message,
  ];
  return lines.join("\n");
}

const UNSUPPORTED_FALLBACK = "Open a supported checkout page to use Salvare.";

async function runSupportCheck() {
  try {
    setStatus("Checking page...");

    const tabs = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    const tab = tabs[0];

    if (!tab?.id) {
      setStatus(UNSUPPORTED_FALLBACK);
      return;
    }

    try {
      chrome.tabs.sendMessage(
        tab.id,
        { type: "SALVARE_CHECK_SUPPORT" },
        (response: CheckoutSupportResponse | undefined) => {
          if (chrome.runtime.lastError) {
            console.error(chrome.runtime.lastError.message);
            setStatus(UNSUPPORTED_FALLBACK);
            return;
          }

          if (!response) {
            setStatus(UNSUPPORTED_FALLBACK);
            return;
          }

          try {
            setStatus(renderSupportStatus(response));
          } catch (renderErr) {
            console.error("Salvare popup render failed:", renderErr);
            setStatus(UNSUPPORTED_FALLBACK);
          }
        },
      );
    } catch (sendErr) {
      console.error("Salvare popup sendMessage failed:", sendErr);
      setStatus(UNSUPPORTED_FALLBACK);
    }
  } catch (err) {
    console.error("Salvare popup support check failed:", err);
    setStatus(UNSUPPORTED_FALLBACK);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  runSupportCheck().catch((err) => {
    console.error("Salvare popup support check rejected:", err);
    setStatus(UNSUPPORTED_FALLBACK);
  });
});

button?.addEventListener("click", async () => {
  console.log("Salvare popup button clicked");

  setStatus("Scanning checkout...");
  disableButton();

  let tabId: number | undefined;
  try {
    const tabs = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    tabId = tabs[0]?.id;
  } catch (err) {
    console.error("Salvare popup tabs.query failed:", err);
    setStatus("Could not connect to page.");
    enableButton();
    return;
  }

  if (!tabId) {
    setStatus("No active tab found.");
    enableButton();
    return;
  }

  setStatus("Testing coupons...");

  try {
    chrome.tabs.sendMessage(
      tabId,
      { type: "SALVARE_FIND_BEST_COUPON" },
      (response) => {
        if (chrome.runtime.lastError) {
          console.error(chrome.runtime.lastError.message);
          setStatus("Could not connect to page.");
          enableButton();
          return;
        }

        if (!response?.success) {
          setStatus(response?.message ?? "No coupon found.");
          enableButton();
          return;
        }

        setStatus(
          `Best code: ${response.bestCode}\nFinal total: ${formatDollars(
            response.totalCents,
          )}\nYou saved: ${formatDollars(response.savingsCents)}`,
        );
        enableButton();
      },
    );
  } catch (err) {
    console.error("Salvare popup sendMessage failed:", err);
    setStatus("Could not connect to page.");
    enableButton();
  }
});
