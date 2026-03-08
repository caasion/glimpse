"use strict";

const MODE_SELECT_ID = "gazeModeSelect";
const STATUS_ID = "itrackPopupStatus";

/**
 * Convenience: get active tab in current window.
 */
async function getActiveTab() {
  try {
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    return tabs[0] ?? null;
  } catch (err) {
    console.warn("[iTrack popup] tabs.query failed:", err);
    return null;
  }
}

function setStatus(text, isError) {
  const el = document.getElementById(STATUS_ID);
  if (!el) return;
  el.textContent = text || "";
  el.classList.toggle("itrack-popup-status--error", !!isError);
}

async function initPopup() {
  const select = document.getElementById(MODE_SELECT_ID);
  if (!select) return;

  const tab = await getActiveTab();
  if (!tab || !tab.id) {
    setStatus("Open iTrack on Instagram to control gaze mode.", true);
    select.disabled = true;
    return;
  }

  // Ask the content script for the current mode.
  try {
    const response = await browser.tabs.sendMessage(tab.id, { type: "ITRACK_GET_MODE" });
    if (response && (response.mode === "calibration" || response.mode === "dev" || response.mode === "normal")) {
      select.value = response.mode;
      setStatus("", false);
    } else {
      setStatus("Gaze mode unknown on this tab.", true);
    }
  } catch (err) {
    // Probably not an Instagram tab or iTrack not injected yet.
    console.warn("[iTrack popup] ITTRACK_GET_MODE failed:", err);
    setStatus("iTrack is not active on this tab.", true);
  }

  select.addEventListener("change", async () => {
    const mode = select.value;
    if (!tab || !tab.id) return;
    try {
      await browser.tabs.sendMessage(tab.id, { type: "ITRACK_SET_MODE", mode });
      setStatus("", false);
    } catch (err) {
      console.warn("[iTrack popup] ITTRACK_SET_MODE failed:", err);
      setStatus("Could not update mode on this tab.", true);
    }
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initPopup);
} else {
  initPopup();
}

