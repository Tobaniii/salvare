import {
  POPUP_CONNECT_ERROR,
  POPUP_FALLBACK_UNSUPPORTED,
} from "./popupMessages";
import {
  renderProgressStatus,
  renderResultStatus,
  renderSupportStatus,
  type PopupResultProvenance,
} from "./popupRender";

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
  provenance?: PopupResultProvenance;
  reportWarning?: boolean;
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

interface CouponProgressMessage {
  type: "SALVARE_COUPON_PROGRESS";
  runId?: string;
  current: number;
  total: number;
  code?: string;
}

let activeRunId: string | null = null;

function generateRunId(): string {
  const cryptoObj = (globalThis as { crypto?: Crypto }).crypto;
  if (cryptoObj && typeof cryptoObj.randomUUID === "function") {
    return cryptoObj.randomUUID();
  }
  return `run-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

chrome.runtime.onMessage.addListener((message: CouponProgressMessage) => {
  if (message?.type !== "SALVARE_COUPON_PROGRESS") return;
  if (!activeRunId || message.runId !== activeRunId) return;

  try {
    setStatus(
      renderProgressStatus({
        current: message.current,
        total: message.total,
        code: message.code,
      }),
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
      (response: FindBestResponse | undefined) => {
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
      },
    );
  } catch (err) {
    console.error("Salvare popup sendMessage failed:", err);
    setStatus(POPUP_CONNECT_ERROR);
    enableButton();
    activeRunId = null;
  }
});
