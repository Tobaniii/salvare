import {
  POPUP_CONNECT_ERROR,
  POPUP_FALLBACK_UNSUPPORTED,
} from "./popupMessages";
import { renderResultStatus, renderSupportStatus } from "./popupRender";

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

interface CheckoutSupportResponse {
  success: boolean;
  domain: string;
  supported: boolean;
  couponInputFound: boolean;
  applyButtonFound: boolean;
  totalDetected: boolean;
  baselineTotalCents: number | null;
  message: string;
  reason?: string;
  profileId?: string;
}

interface FindBestSuccessResponse {
  success: true;
  bestCode: string;
  totalCents: number;
  savingsCents: number;
  codesTested?: number;
}

interface FindBestFailureResponse {
  success: false;
  message?: string;
}

type FindBestResponse = FindBestSuccessResponse | FindBestFailureResponse;

async function runSupportCheck() {
  try {
    setStatus("Checking page...");

    const tabs = await chrome.tabs.query({
      active: true,
      currentWindow: true,
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
        (response: CheckoutSupportResponse | undefined) => {
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
        },
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
    setStatus(POPUP_CONNECT_ERROR);
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
      (response: FindBestResponse | undefined) => {
        if (chrome.runtime.lastError) {
          console.error(chrome.runtime.lastError.message);
          setStatus(POPUP_CONNECT_ERROR);
          enableButton();
          return;
        }

        if (!response?.success) {
          setStatus(response?.message ?? "No coupon found.");
          enableButton();
          return;
        }

        setStatus(renderResultStatus(response));
        enableButton();
      },
    );
  } catch (err) {
    console.error("Salvare popup sendMessage failed:", err);
    setStatus(POPUP_CONNECT_ERROR);
    enableButton();
  }
});
