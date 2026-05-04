(() => {
  // extension/profileDiagnostics.ts
  var SUPPORT_REASON = {
    Ready: "ready",
    HostnameUnrecognized: "hostname_unrecognized",
    NoCandidateCodes: "no_candidate_codes",
    CouponInputMissing: "coupon_input_missing",
    ApplyButtonMissing: "apply_button_missing",
    TotalMissing: "total_missing"
  };

  // extension/popupMessages.ts
  var POPUP_FALLBACK_UNSUPPORTED = "Open a supported checkout page to use Salvare.";
  var POPUP_CONNECT_ERROR = "Could not connect to page.";
  var REASON_MESSAGES = {
    [SUPPORT_REASON.Ready]: "Ready to test coupons.",
    [SUPPORT_REASON.HostnameUnrecognized]: "This store is not supported yet.",
    [SUPPORT_REASON.NoCandidateCodes]: "No coupon codes are saved for this store.",
    [SUPPORT_REASON.CouponInputMissing]: "Coupon box not found on this page.",
    [SUPPORT_REASON.ApplyButtonMissing]: "Apply button not found on this page.",
    [SUPPORT_REASON.TotalMissing]: "Order total not found on this page."
  };
  function messageForReason(reason) {
    if (!reason) return POPUP_FALLBACK_UNSUPPORTED;
    if (reason in REASON_MESSAGES) {
      return REASON_MESSAGES[reason];
    }
    return POPUP_FALLBACK_UNSUPPORTED;
  }

  // extension/popupRender.ts
  function formatDollars(cents) {
    return `$${(cents / 100).toFixed(2)}`;
  }
  function renderProgressStatus(update) {
    const safeTotal = Number.isFinite(update.total) && update.total > 0 ? Math.floor(update.total) : 0;
    const safeCurrent = Number.isFinite(update.current) && update.current > 0 ? Math.min(Math.floor(update.current), Math.max(safeTotal, 1)) : 1;
    if (safeTotal <= 0) {
      return "Testing coupons...";
    }
    const lines = [`Testing ${safeCurrent} of ${safeTotal}...`];
    if (typeof update.code === "string" && update.code.trim().length > 0) {
      lines.push(`Code: ${update.code.trim()}`);
    }
    return lines.join("\n");
  }
  function renderSupportStatus(response) {
    if (!response.supported) {
      return messageForReason(response.reason);
    }
    const lines = ["Store supported"];
    if (response.profileId) {
      lines.push(`Profile: ${response.profileId}`);
    }
    lines.push(messageForReason(response.reason ?? "ready"));
    return lines.join("\n");
  }
  function renderResultStatus(response) {
    const lines = [
      `Best code: ${response.bestCode}`,
      `Final total: ${formatDollars(response.totalCents)}`,
      `You saved: ${formatDollars(response.savingsCents)}`
    ];
    if (typeof response.codesTested === "number" && response.codesTested > 0) {
      lines.push(`Codes tested: ${response.codesTested}`);
    }
    return lines.join("\n");
  }

  // extension/popup.ts
  var button = document.getElementById("find-best");
  var statusElement = document.getElementById("status");
  function setStatus(message) {
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
  async function runSupportCheck() {
    try {
      setStatus("Checking page...");
      const tabs = await chrome.tabs.query({
        active: true,
        currentWindow: true
      });
      const tab = tabs[0];
      if (!tab?.id) {
        setStatus(POPUP_FALLBACK_UNSUPPORTED);
        return;
      }
      try {
        chrome.tabs.sendMessage(
          tab.id,
          { type: "SALVARE_CHECK_SUPPORT" },
          (response) => {
            if (chrome.runtime.lastError) {
              console.error(chrome.runtime.lastError.message);
              setStatus(POPUP_FALLBACK_UNSUPPORTED);
              return;
            }
            if (!response) {
              setStatus(POPUP_FALLBACK_UNSUPPORTED);
              return;
            }
            try {
              setStatus(renderSupportStatus(response));
            } catch (renderErr) {
              console.error("Salvare popup render failed:", renderErr);
              setStatus(POPUP_FALLBACK_UNSUPPORTED);
            }
          }
        );
      } catch (sendErr) {
        console.error("Salvare popup sendMessage failed:", sendErr);
        setStatus(POPUP_FALLBACK_UNSUPPORTED);
      }
    } catch (err) {
      console.error("Salvare popup support check failed:", err);
      setStatus(POPUP_FALLBACK_UNSUPPORTED);
    }
  }
  document.addEventListener("DOMContentLoaded", () => {
    runSupportCheck().catch((err) => {
      console.error("Salvare popup support check rejected:", err);
      setStatus(POPUP_FALLBACK_UNSUPPORTED);
    });
  });
  var activeRunId = null;
  function generateRunId() {
    const cryptoObj = globalThis.crypto;
    if (cryptoObj && typeof cryptoObj.randomUUID === "function") {
      return cryptoObj.randomUUID();
    }
    return `run-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type !== "SALVARE_COUPON_PROGRESS") return;
    if (!activeRunId || message.runId !== activeRunId) return;
    try {
      setStatus(
        renderProgressStatus({
          current: message.current,
          total: message.total,
          code: message.code
        })
      );
    } catch (err) {
      console.error("Salvare popup progress render failed:", err);
    }
  });
  button?.addEventListener("click", async () => {
    console.log("Salvare popup button clicked");
    setStatus("Scanning checkout...");
    disableButton();
    const runId = generateRunId();
    activeRunId = runId;
    let tabId;
    try {
      const tabs = await chrome.tabs.query({
        active: true,
        currentWindow: true
      });
      tabId = tabs[0]?.id;
    } catch (err) {
      console.error("Salvare popup tabs.query failed:", err);
      setStatus(POPUP_CONNECT_ERROR);
      enableButton();
      activeRunId = null;
      return;
    }
    if (!tabId) {
      setStatus("No active tab found.");
      enableButton();
      activeRunId = null;
      return;
    }
    setStatus("Testing coupons...");
    try {
      chrome.tabs.sendMessage(
        tabId,
        { type: "SALVARE_FIND_BEST_COUPON", runId },
        (response) => {
          if (runId !== activeRunId) return;
          if (chrome.runtime.lastError) {
            console.error(chrome.runtime.lastError.message);
            setStatus(POPUP_CONNECT_ERROR);
            enableButton();
            activeRunId = null;
            return;
          }
          if (!response?.success) {
            setStatus(response?.message ?? "No coupon found.");
            enableButton();
            activeRunId = null;
            return;
          }
          setStatus(renderResultStatus(response));
          enableButton();
          activeRunId = null;
        }
      );
    } catch (err) {
      console.error("Salvare popup sendMessage failed:", err);
      setStatus(POPUP_CONNECT_ERROR);
      enableButton();
      activeRunId = null;
    }
  });
})();
