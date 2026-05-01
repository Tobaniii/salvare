(() => {
  // extension/popup.ts
  var button = document.getElementById("find-best");
  var statusElement = document.getElementById("status");
  function setStatus(message) {
    if (statusElement) {
      statusElement.textContent = message;
    }
  }
  function formatDollars(cents) {
    return `$${(cents / 100).toFixed(2)}`;
  }
  function renderSupportStatus(response) {
    if (!response.supported) {
      return response.message ?? "This store is not supported yet.";
    }
    if (response.message !== "Ready to test coupons.") {
      return `Store supported
${response.message}`;
    }
    const lines = [
      "Store supported",
      response.couponInputFound ? "Coupon input found" : "Coupon input missing",
      response.applyButtonFound ? "Apply button found" : "Apply button missing",
      response.totalDetected ? "Total detected" : "Total missing",
      response.message
    ];
    return lines.join("\n");
  }
  var UNSUPPORTED_FALLBACK = "Open a supported checkout page to use Salvare.";
  async function runSupportCheck() {
    try {
      setStatus("Checking page...");
      const tabs = await chrome.tabs.query({
        active: true,
        currentWindow: true
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
          (response) => {
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
          }
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
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true
    });
    if (!tab.id) {
      setStatus("No active tab found.");
      return;
    }
    setStatus("Testing coupons...");
    chrome.tabs.sendMessage(
      tab.id,
      { type: "SALVARE_FIND_BEST_COUPON" },
      (response) => {
        if (chrome.runtime.lastError) {
          console.error(chrome.runtime.lastError.message);
          setStatus("Could not connect to page.");
          return;
        }
        if (!response?.success) {
          setStatus(response?.message ?? "No coupon found.");
          return;
        }
        setStatus(
          `Best code: ${response.bestCode}
Final total: ${formatDollars(
            response.totalCents
          )}
You saved: ${formatDollars(response.savingsCents)}`
        );
      }
    );
  });
})();
