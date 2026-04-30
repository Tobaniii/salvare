(() => {
  // extension/popup.ts
  var button = document.getElementById("find-best");
  var statusElement = document.getElementById("status");
  function setStatus(message) {
    if (statusElement) {
      statusElement.textContent = message;
    }
  }
  button?.addEventListener("click", async () => {
    console.log("Salvare popup button clicked");
    setStatus("Testing coupons...");
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true
    });
    if (!tab.id) {
      setStatus("No active tab found.");
      return;
    }
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
        setStatus(`Best code: ${response.bestCode}`);
      }
    );
  });
})();
