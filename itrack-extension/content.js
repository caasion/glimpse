"use strict";
/**
 * iTrack Firefox extension â€“ content script.
 * Injects a right-side panel on Instagram with Recommended products (top) and All products (bottom).
 * Clicking a product tile redirects to its link immediately in a new tab.
 * Removes Instagram Reels nav buttons, Messages toolbar, and floating buttons dynamically.
 *
 * Eye-gaze integration via EyeGesturesLite:
 * A hidden moz-extension iframe (gaze-page.html) runs EyeGesturesLite and relays
 * gaze coordinates here via postMessage. When the gaze dwells on a product tile
 * for DWELL_THRESHOLD_MS milliseconds, a POST is sent to GAZE_API_ENDPOINT.
 */
var _a, _b, _c, _d, _e;
const INITIAL_RECOMMENDED = [];
const INITIAL_ALL = [];
const PANEL_ID = "itrack-panel";
const REOPEN_ID = "itrack-reopen-pill";
const PANEL_IFRAME_ID = "itrack-panel-iframe";
const GAZE_IFRAME_ID = "itrack-gaze-iframe";
const GAZE_DOT_ID = "itrack-gaze-dot";
const ANCHOR_BOX_ID = "itrack-anchor-box";
const ANCHOR_PROGRESS_ID = "itrack-anchor-progress";
const AUTO_CAPTURE_TOGGLE_ID = "itrack-auto-capture-toggle";
const AUTO_CAPTURE_STATUS_ID = "itrack-auto-capture-status";
const DEV_ACTIONS_ROW_ID = "itrack-dev-actions-row";
const PANEL_IFRAME_MIN_HEIGHT_PX = 80;
const PANEL_IFRAME_MAX_HEIGHT_PX = 620;
/** Replace with your real API endpoint. */
const GAZE_API_ENDPOINT = "http://localhost:3000/api/gaze";
/** Milliseconds a gaze must stay on a tile before the POST fires. */
const DWELL_THRESHOLD_MS = 1500;
const AUTO_CAPTURE_WINDOW_MS = 2000;
const AUTO_CAPTURE_BOX_SIZE_PX = 400;
let gazeMode = "normal";
// ---------------------------------------------------------------------------
// Dev-mode gaze dot (a native element on the host page, always transparent)
// ---------------------------------------------------------------------------
/**
 * Creates a small circular dot fixed over the whole viewport.
 * It is the visual stand-in for EyeGesturesLite's own cursor in dev mode,
 * rendered on the host page so it is completely unaffected by the iframe's
 * white document background.
 */
function injectGazeDot() {
    if (document.getElementById(GAZE_DOT_ID))
        return;
    const dot = document.createElement("div");
    dot.id = GAZE_DOT_ID;
    dot.style.cssText = [
        "position:fixed",
        "top:0", "left:0",
        "width:18px", "height:18px",
        "border-radius:50%",
        "background:rgba(255,50,50,0.75)",
        "border:2px solid rgba(255,255,255,0.9)",
        "box-shadow:0 0 6px rgba(0,0,0,0.45)",
        "pointer-events:none",
        `z-index:${2147483646}`,
        "display:none",
        "will-change:transform",
    ].join(";");
    document.body.appendChild(dot);
}
function showGazeDot(visible) {
    const dot = document.getElementById(GAZE_DOT_ID);
    if (dot)
        dot.style.display = visible ? "block" : "none";
}
/** Translate the dot so its centre sits at (x, y) in viewport coordinates. */
function moveGazeDot(x, y) {
    const dot = document.getElementById(GAZE_DOT_ID);
    if (!dot || dot.style.display === "none")
        return;
    // Dot is 18px wide; shift by -9px so the centre lands on the gaze point.
    dot.style.transform = `translate(${x - 9}px, ${y - 9}px)`;
}
function updateProductSectionVisibility() {
    const hideSections = gazeMode === "calibration";
    document.querySelectorAll(`#${PANEL_ID} .itrack-section`).forEach((section) => {
        section.style.display = hideSections ? "none" : "";
    });
    const panelIframe = getPanelIframe();
    if (panelIframe) {
        panelIframe.style.display = hideSections ? "none" : "block";
    }
}
function updateDevActionsVisibility() {
    const actionsRow = document.getElementById(DEV_ACTIONS_ROW_ID);
    if (!(actionsRow instanceof HTMLElement))
        return;
    actionsRow.style.display = gazeMode === "dev" ? "flex" : "none";
}
/**
 * calibration â€“ white overlay, pointer-events active so calibration UI is
 *               interactive; eye tracking cursor + calibration dots visible.
 * dev          â€“ iframe stays invisible (opacity 0) so its white background
 *               never shows; a native gaze dot on the host page shows position.
 * normal       â€“ iframe invisible; tracking runs silently in the background,
 *               dwell POSTs still fire.
 */
function setGazeMode(mode) {
    var _a;
    gazeMode = mode;
    // Show the native gaze dot only in dev mode.
    showGazeDot(mode === "dev");
    syncAnchorBoxVisibility();
    updateProductSectionVisibility();
    updateDevActionsVisibility();
    const iframe = document.getElementById(GAZE_IFRAME_ID);
    if (!iframe)
        return;
    switch (mode) {
        case "calibration":
            // Full-screen overlay needed so calibration dots and the webcam feed
            // are interactive and visible.
            iframe.style.opacity = "1";
            iframe.style.pointerEvents = "auto";
            break;
        case "dev":
            // Hide the iframe â€” its document always has a white background that
            // can't be made transparent. The native gaze dot above replaces the
            // built-in EyeGesturesLite cursor.
            iframe.style.opacity = "0";
            iframe.style.pointerEvents = "none";
            break;
        case "normal":
            iframe.style.opacity = "0";
            iframe.style.pointerEvents = "none";
            break;
    }
    // Tell the iframe so it can show/hide the cursor and set background colour
    (_a = iframe.contentWindow) === null || _a === void 0 ? void 0 : _a.postMessage({ type: "ITRACK_SET_MODE", mode }, "*");
}
// ---------------------------------------------------------------------------
// Extension messaging â€“ allow popup to get/set gaze mode
// ---------------------------------------------------------------------------
const itrackRuntime = (_d = (_b = (_a = globalThis.browser) === null || _a === void 0 ? void 0 : _a.runtime) !== null && _b !== void 0 ? _b : (_c = globalThis.chrome) === null || _c === void 0 ? void 0 : _c.runtime) !== null && _d !== void 0 ? _d : null;
function runtimeGetUrl(path) {
    if (typeof (itrackRuntime === null || itrackRuntime === void 0 ? void 0 : itrackRuntime.getURL) === "function") {
        return String(itrackRuntime.getURL(path));
    }
    throw new Error("Extension runtime.getURL is unavailable");
}
if ((_e = itrackRuntime === null || itrackRuntime === void 0 ? void 0 : itrackRuntime.onMessage) === null || _e === void 0 ? void 0 : _e.addListener) {
    itrackRuntime.onMessage.addListener((message) => {
        if (!message || typeof message.type !== "string") {
            return undefined;
        }
        if (message.type === "ITRACK_GET_MODE") {
            return Promise.resolve({ mode: gazeMode });
        }
        if (message.type === "ITRACK_SET_MODE") {
            const mode = message.mode;
            if (mode === "calibration" || mode === "dev" || mode === "normal") {
                setGazeMode(mode);
                return Promise.resolve({ ok: true });
            }
            return Promise.resolve({ ok: false, error: "INVALID_MODE" });
        }
        return undefined;
    });
}
const dwell = { tileId: null, timerId: null, startTime: 0 };
const autoCapture = {
    enabled: true,
    anchorTimerId: null,
    progressAnimationFrameId: null,
    hasAnchor: false,
    anchorX: 0,
    anchorY: 0,
    anchorStartedAt: 0,
    stayedInsideBox: false,
    hasLastGaze: false,
    lastGazeX: 0,
    lastGazeY: 0,
    lastCalibrated: false,
    captureInFlight: false,
};
let panelData = {
    recommended: [...INITIAL_RECOMMENDED],
    all: [...INITIAL_ALL],
};
let panelIframeLoaded = false;
let panelIframeLoadTimeoutId = null;
let recommendedTilesContainer = null;
let allTilesContainer = null;
function clearPanelIframeLoadTimeout() {
    if (panelIframeLoadTimeoutId !== null) {
        clearTimeout(panelIframeLoadTimeoutId);
        panelIframeLoadTimeoutId = null;
    }
}
function renderProductsInContainer(container, products) {
    if (!container)
        return;
    container.innerHTML = "";
    products.forEach((product) => renderTile(container, product));
}
function updateLegacyPanelData(data) {
    renderProductsInContainer(recommendedTilesContainer, data.recommended);
    renderProductsInContainer(allTilesContainer, data.all);
}
function mountLegacyPanelSections(parent) {
    if (!recommendedTilesContainer) {
        recommendedTilesContainer = createSection(parent, "Recommended products", panelData.recommended, "itrack-recommended-tiles");
    }
    if (!allTilesContainer) {
        allTilesContainer = createSection(parent, "All products", panelData.all, "itrack-all-tiles");
    }
    updateLegacyPanelData(panelData);
    updateProductSectionVisibility();
}
function getPanelIframe() {
    return document.getElementById(PANEL_IFRAME_ID);
}
function sendPanelDataToIframe(data) {
    const iframe = getPanelIframe();
    if (!(iframe === null || iframe === void 0 ? void 0 : iframe.contentWindow) || !panelIframeLoaded) {
        updateLegacyPanelData(data);
        return;
    }
    iframe.contentWindow.postMessage({
        type: "ITRACK_PANEL_DATA",
        payload: data,
    }, "*");
}
function relayGazeToPanelIframe(x, y, calibrated) {
    const iframe = getPanelIframe();
    if (!(iframe === null || iframe === void 0 ? void 0 : iframe.contentWindow) || !panelIframeLoaded)
        return;
    iframe.contentWindow.postMessage({
        type: "ITRACK_GAZE",
        x,
        y,
        calibrated,
    }, "*");
}
function applyPanelIframeHeight(heightPx) {
    const iframe = getPanelIframe();
    if (!iframe)
        return;
    const clamped = Math.max(PANEL_IFRAME_MIN_HEIGHT_PX, Math.min(PANEL_IFRAME_MAX_HEIGHT_PX, Math.round(heightPx)));
    iframe.style.height = `${clamped}px`;
}
function injectAnchorBox() {
    if (document.getElementById(ANCHOR_BOX_ID))
        return;
    const box = document.createElement("div");
    box.id = ANCHOR_BOX_ID;
    box.innerHTML = `
    <div style="
      position:absolute;
      left:8px;
      right:8px;
      bottom:8px;
      height:8px;
      border-radius:999px;
      overflow:hidden;
      background:rgba(15,23,42,0.45);
      border:1px solid rgba(148,163,184,0.45);
    ">
      <div id="${ANCHOR_PROGRESS_ID}" style="
        width:0%;
        height:100%;
        background:rgba(45,212,191,0.95);
        transition:width 80ms linear;
      "></div>
    </div>
  `;
    box.style.cssText = [
        "position:fixed",
        "top:0",
        "left:0",
        `width:${AUTO_CAPTURE_BOX_SIZE_PX}px`,
        `height:${AUTO_CAPTURE_BOX_SIZE_PX}px`,
        "border:2px dashed rgba(45, 212, 191, 0.95)",
        "box-shadow:0 0 0 1px rgba(15, 23, 42, 0.75), 0 0 24px rgba(45, 212, 191, 0.28)",
        "border-radius:10px",
        "pointer-events:none",
        "display:none",
        `z-index:${2147483644}`,
        "will-change:transform",
    ].join(";");
    document.body.appendChild(box);
}
function showAnchorBox(visible) {
    const box = document.getElementById(ANCHOR_BOX_ID);
    if (box)
        box.style.display = visible && gazeMode === "dev" ? "block" : "none";
}
function setAnchorBoxState(active) {
    const box = document.getElementById(ANCHOR_BOX_ID);
    if (!box)
        return;
    box.style.borderColor = active
        ? "rgba(45, 212, 191, 0.95)"
        : "rgba(248, 113, 113, 0.95)";
}
function moveAnchorBox(x, y) {
    const box = document.getElementById(ANCHOR_BOX_ID);
    if (!box)
        return;
    box.style.transform = `translate(${x - AUTO_CAPTURE_BOX_SIZE_PX / 2}px, ${y - AUTO_CAPTURE_BOX_SIZE_PX / 2}px)`;
}
function setAnchorProgress(progress, active) {
    const bar = document.getElementById(ANCHOR_PROGRESS_ID);
    if (!(bar instanceof HTMLElement))
        return;
    const clamped = Math.max(0, Math.min(progress, 1));
    bar.style.width = `${Math.round(clamped * 100)}%`;
    bar.style.background = active
        ? "rgba(45,212,191,0.95)"
        : "rgba(248,113,113,0.95)";
}
function stopAnchorProgressAnimation(resetToZero) {
    if (autoCapture.progressAnimationFrameId !== null) {
        cancelAnimationFrame(autoCapture.progressAnimationFrameId);
        autoCapture.progressAnimationFrameId = null;
    }
    if (resetToZero) {
        setAnchorProgress(0, true);
    }
}
function startAnchorProgressAnimation() {
    stopAnchorProgressAnimation(false);
    const tick = () => {
        if (!autoCapture.hasAnchor) {
            autoCapture.progressAnimationFrameId = null;
            return;
        }
        const elapsed = Date.now() - autoCapture.anchorStartedAt;
        const progress = elapsed / AUTO_CAPTURE_WINDOW_MS;
        setAnchorProgress(progress, autoCapture.stayedInsideBox);
        autoCapture.progressAnimationFrameId = requestAnimationFrame(tick);
    };
    setAnchorProgress(0, true);
    autoCapture.progressAnimationFrameId = requestAnimationFrame(tick);
}
function syncAnchorBoxVisibility() {
    showAnchorBox(autoCapture.enabled && autoCapture.hasAnchor && gazeMode === "dev");
}
function setAutoCaptureStatus(text) {
    const statusEl = document.getElementById(AUTO_CAPTURE_STATUS_ID);
    if (statusEl)
        statusEl.textContent = text;
}
function updateAutoCaptureToggleUi() {
    const button = document.getElementById(AUTO_CAPTURE_TOGGLE_ID);
    if (!button)
        return;
    button.textContent = autoCapture.enabled ? "Auto capture: ON" : "Auto capture: OFF";
    button.style.background = autoCapture.enabled
        ? "rgba(16,185,129,0.25)"
        : "rgba(255,255,255,0.1)";
    button.style.borderColor = autoCapture.enabled
        ? "rgba(16,185,129,0.7)"
        : "rgba(255,255,255,0.25)";
}
function isInsideAnchoredBox(x, y) {
    if (!autoCapture.hasAnchor)
        return false;
    const half = AUTO_CAPTURE_BOX_SIZE_PX / 2;
    return (x >= autoCapture.anchorX - half &&
        x <= autoCapture.anchorX + half &&
        y >= autoCapture.anchorY - half &&
        y <= autoCapture.anchorY + half);
}
async function captureVisibleViewportDataUrl() {
    var _a;
    if (typeof (itrackRuntime === null || itrackRuntime === void 0 ? void 0 : itrackRuntime.sendMessage) !== "function") {
        throw new Error("browser.runtime.sendMessage is not available for tab capture");
    }
    const response = (await itrackRuntime.sendMessage({
        type: "ITRACK_CAPTURE_VISIBLE_TAB",
    }));
    if (!(response === null || response === void 0 ? void 0 : response.ok) || typeof response.dataUrl !== "string" || !response.dataUrl) {
        throw new Error(`Tab capture failed: ${(_a = response === null || response === void 0 ? void 0 : response.error) !== null && _a !== void 0 ? _a : "unknown error"}`);
    }
    return response.dataUrl;
}
function dataUrlToImage(dataUrl) {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error("Failed to decode captured tab image"));
        image.src = dataUrl;
    });
}
async function captureAnchoredRegionToFile(anchorX, anchorY) {
    const dataUrl = await captureVisibleViewportDataUrl();
    const image = await dataUrlToImage(dataUrl);
    const viewportWidth = Math.max(window.innerWidth, 1);
    const viewportHeight = Math.max(window.innerHeight, 1);
    const sampleWidthCss = Math.min(AUTO_CAPTURE_BOX_SIZE_PX, viewportWidth);
    const sampleHeightCss = Math.min(AUTO_CAPTURE_BOX_SIZE_PX, viewportHeight);
    const leftCss = anchorX - AUTO_CAPTURE_BOX_SIZE_PX / 2;
    const topCss = anchorY - AUTO_CAPTURE_BOX_SIZE_PX / 2;
    const clampedLeftCss = Math.max(0, Math.min(leftCss, viewportWidth - sampleWidthCss));
    const clampedTopCss = Math.max(0, Math.min(topCss, viewportHeight - sampleHeightCss));
    const sourceScaleX = image.naturalWidth / viewportWidth;
    const sourceScaleY = image.naturalHeight / viewportHeight;
    const sourceX = Math.round(clampedLeftCss * sourceScaleX);
    const sourceY = Math.round(clampedTopCss * sourceScaleY);
    const sourceW = Math.max(1, Math.round(sampleWidthCss * sourceScaleX));
    const sourceH = Math.max(1, Math.round(sampleHeightCss * sourceScaleY));
    const canvas = document.createElement("canvas");
    canvas.width = AUTO_CAPTURE_BOX_SIZE_PX;
    canvas.height = AUTO_CAPTURE_BOX_SIZE_PX;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
        throw new Error("Canvas context unavailable for anchor crop");
    }
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, AUTO_CAPTURE_BOX_SIZE_PX, AUTO_CAPTURE_BOX_SIZE_PX);
    ctx.drawImage(image, sourceX, sourceY, sourceW, sourceH, 0, 0, AUTO_CAPTURE_BOX_SIZE_PX, AUTO_CAPTURE_BOX_SIZE_PX);
    const blob = await new Promise((resolve) => {
        canvas.toBlob((value) => resolve(value), "image/png");
    });
    if (!blob) {
        throw new Error("Failed to encode anchor crop to PNG");
    }
    return new File([blob], `itrack-anchor-${Date.now()}.png`, { type: "image/png" });
}
async function finishAutoCaptureWindow() {
    const shouldCapture = autoCapture.hasAnchor && autoCapture.stayedInsideBox;
    const anchorX = autoCapture.anchorX;
    const anchorY = autoCapture.anchorY;
    autoCapture.hasAnchor = false;
    stopAnchorProgressAnimation(true);
    syncAnchorBoxVisibility();
    if (shouldCapture) {
        if (autoCapture.captureInFlight) {
            setAutoCaptureStatus("Skipped: upload busy");
        }
        else {
            autoCapture.captureInFlight = true;
            setAutoCaptureStatus("Capturing 400x400...");
            try {
                const file = await captureAnchoredRegionToFile(anchorX, anchorY);
                console.log("[iTrack] auto capture ready", {
                    name: file.name,
                    size: file.size,
                    type: file.type,
                    anchorX,
                    anchorY,
                });
                const ok = await handleImageFile(file);
                setAutoCaptureStatus(ok ? `Captured ${new Date().toLocaleTimeString()}` : "Capture failed");
            }
            catch (error) {
                console.error("[iTrack] auto capture failed", error);
                setAutoCaptureStatus("Capture error");
            }
            finally {
                autoCapture.captureInFlight = false;
            }
        }
    }
    else if (autoCapture.enabled) {
        setAutoCaptureStatus("No capture (left anchor box)");
    }
    if (autoCapture.enabled) {
        if (autoCapture.hasLastGaze && autoCapture.lastCalibrated) {
            startAutoCaptureWindow(autoCapture.lastGazeX, autoCapture.lastGazeY);
        }
        else {
            setAutoCaptureStatus("Waiting for calibrated gaze...");
        }
    }
}
function startAutoCaptureWindow(anchorX, anchorY) {
    if (!autoCapture.enabled)
        return;
    if (autoCapture.anchorTimerId !== null)
        return;
    autoCapture.hasAnchor = true;
    autoCapture.anchorX = anchorX;
    autoCapture.anchorY = anchorY;
    autoCapture.anchorStartedAt = Date.now();
    autoCapture.stayedInsideBox = true;
    moveAnchorBox(anchorX, anchorY);
    setAnchorBoxState(true);
    syncAnchorBoxVisibility();
    startAnchorProgressAnimation();
    setAutoCaptureStatus("Anchored. Hold gaze for 2s...");
    autoCapture.anchorTimerId = setTimeout(() => {
        autoCapture.anchorTimerId = null;
        void finishAutoCaptureWindow();
    }, AUTO_CAPTURE_WINDOW_MS);
}
function observeAutoCaptureGaze(x, y, calibrated) {
    autoCapture.hasLastGaze = true;
    autoCapture.lastGazeX = x;
    autoCapture.lastGazeY = y;
    autoCapture.lastCalibrated = calibrated;
    if (!autoCapture.enabled)
        return;
    if (!calibrated)
        return;
    if (!autoCapture.hasAnchor) {
        startAutoCaptureWindow(x, y);
        return;
    }
    if (autoCapture.stayedInsideBox && !isInsideAnchoredBox(x, y)) {
        autoCapture.stayedInsideBox = false;
        setAnchorBoxState(false);
        const elapsed = Date.now() - autoCapture.anchorStartedAt;
        setAnchorProgress(elapsed / AUTO_CAPTURE_WINDOW_MS, false);
        setAutoCaptureStatus("Left anchor box. Waiting cycle end...");
    }
}
function setAutoCaptureEnabled(enabled) {
    if (autoCapture.enabled === enabled)
        return;
    autoCapture.enabled = enabled;
    updateAutoCaptureToggleUi();
    if (!enabled) {
        if (autoCapture.anchorTimerId !== null) {
            clearTimeout(autoCapture.anchorTimerId);
            autoCapture.anchorTimerId = null;
        }
        autoCapture.hasAnchor = false;
        autoCapture.stayedInsideBox = false;
        stopAnchorProgressAnimation(true);
        syncAnchorBoxVisibility();
        setAutoCaptureStatus("Off");
        return;
    }
    if (autoCapture.hasLastGaze && autoCapture.lastCalibrated) {
        startAutoCaptureWindow(autoCapture.lastGazeX, autoCapture.lastGazeY);
    }
    else {
        setAutoCaptureStatus("Waiting for calibrated gaze...");
    }
}
function isInstagram() {
    return window.location.hostname.includes("instagram.com");
}
function removeInstagramUI() {
    document.querySelectorAll('div[aria-label*="Messages"]').forEach(el => el.remove());
    document.querySelectorAll('div[role="button"] > div[data-visualcompletion="ignore"]').forEach(el => { var _a; return (_a = el.parentElement) === null || _a === void 0 ? void 0 : _a.remove(); });
    const reelsNav = document.querySelector('div[aria-label="Reels navigation controls"]');
    if (reelsNav)
        reelsNav.remove();
    const observer = new MutationObserver(() => {
        document.querySelectorAll('div[aria-label*="Messages"]').forEach(el => el.remove());
        document.querySelectorAll('div[role="button"] > div[data-visualcompletion="ignore"]').forEach(el => { var _a; return (_a = el.parentElement) === null || _a === void 0 ? void 0 : _a.remove(); });
    });
    observer.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => observer.disconnect(), 15000);
}
function getOrCreatePanel() {
    let panel = document.getElementById(PANEL_ID);
    if (!panel) {
        panel = document.createElement("div");
        panel.id = PANEL_ID;
        panel.className = "itrack-panel";
        document.body.appendChild(panel);
    }
    panel.innerHTML = "";
    return panel;
}
function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
}
function attachImageFallback(img) {
    img.addEventListener("error", () => {
        img.src = "https://placehold.co/280x280/111827/F9FAFB?text=Product";
    }, { once: true });
}
// Clicking tile now opens the product URL in a new tab
function renderTile(container, product) {
    var _a;
    const tile = document.createElement("div");
    tile.className = "itrack-tile";
    tile.setAttribute("data-product-id", product.id);
    tile.setAttribute("data-product-name", product.name);
    tile.setAttribute("data-product-url", product.url);
    tile.setAttribute("data-product-price", (_a = product.price) !== null && _a !== void 0 ? _a : "");
    const priceHtml = product.price ? ` <span class="itrack-tile-price">${escapeHtml(product.price)}</span>` : "";
    tile.innerHTML = `
    <div class="itrack-tile-media">
      <img src="${escapeHtml(product.imageUrl)}" alt="" width="56" height="56" loading="lazy" />
    </div>
    <div class="itrack-tile-body">
      <span class="itrack-tile-name">${escapeHtml(product.name)}</span>${priceHtml}
    </div>
  `;
    const img = tile.querySelector("img");
    if (img)
        attachImageFallback(img);
    // Open product link on click
    tile.addEventListener("click", () => {
        window.open(product.url, "_blank");
    });
    container.appendChild(tile);
}
function createSection(parent, title, products, containerId) {
    const section = document.createElement("div");
    section.className = "itrack-section";
    section.innerHTML = `<h2 class="itrack-section-title">${escapeHtml(title)}</h2><div id="${containerId}" class="itrack-tiles"></div>`;
    parent.appendChild(section);
    const container = section.querySelector(`#${containerId}`);
    products.forEach(p => renderTile(container, p));
    return container;
}
function createReopenPill() {
    if (document.getElementById(REOPEN_ID))
        return;
    const pill = document.createElement("button");
    pill.id = REOPEN_ID;
    pill.type = "button";
    pill.className = "itrack-reopen-pill itrack-reopen-hidden";
    pill.setAttribute("aria-label", "Open iTrack panel");
    pill.textContent = "iTrack";
    pill.addEventListener("click", () => {
        const panel = document.getElementById(PANEL_ID);
        if (panel) {
            panel.classList.remove("itrack-panel-hidden");
            pill.classList.add("itrack-reopen-hidden");
        }
    });
    document.body.appendChild(pill);
}
function createImageUploadControl(parent) {
    if (document.getElementById("imageFile"))
        return;
    const row = document.createElement("div");
    row.style.cssText = [
        "display:flex",
        "align-items:center",
        "gap:8px",
        "margin:0",
    ].join(";");
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Upload image";
    button.style.cssText = [
        "padding:6px 10px",
        "border-radius:8px",
        "border:1px solid rgba(255,255,255,0.25)",
        "background:rgba(255,255,255,0.1)",
        "color:#fff",
        "cursor:pointer",
        "font-size:12px",
    ].join(";");
    const status = document.createElement("span");
    status.id = "itrack-upload-status";
    status.textContent = "Idle";
    status.style.cssText = "display:none;";
    const input = document.createElement("input");
    input.id = "imageFile";
    input.type = "file";
    input.accept = "image/*";
    input.style.display = "none";
    button.addEventListener("click", () => input.click());
    row.appendChild(button);
    row.appendChild(status);
    row.appendChild(input);
    parent.appendChild(row);
}
function createAutoCaptureControl(parent) {
    if (document.getElementById(AUTO_CAPTURE_TOGGLE_ID))
        return;
    const row = document.createElement("div");
    row.style.cssText = [
        "display:flex",
        "align-items:center",
        "gap:8px",
        "margin:0",
    ].join(";");
    const button = document.createElement("button");
    button.id = AUTO_CAPTURE_TOGGLE_ID;
    button.type = "button";
    button.style.cssText = [
        "padding:6px 10px",
        "border-radius:8px",
        "border:1px solid rgba(255,255,255,0.25)",
        "background:rgba(255,255,255,0.1)",
        "color:#fff",
        "cursor:pointer",
        "font-size:12px",
    ].join(";");
    button.addEventListener("click", () => setAutoCaptureEnabled(!autoCapture.enabled));
    const status = document.createElement("span");
    status.id = AUTO_CAPTURE_STATUS_ID;
    status.textContent = "Off";
    status.style.cssText = "display:none;";
    row.appendChild(button);
    row.appendChild(status);
    parent.appendChild(row);
    updateAutoCaptureToggleUi();
}
function createPanel() {
    removeInstagramUI();
    const panel = getOrCreatePanel();
    panel.classList.remove("itrack-panel-hidden");
    panelIframeLoaded = false;
    clearPanelIframeLoadTimeout();
    recommendedTilesContainer = null;
    allTilesContainer = null;
    const content = document.createElement("div");
    content.className = "itrack-content";
    panel.appendChild(content);
    const actionsRow = document.createElement("div");
    actionsRow.id = DEV_ACTIONS_ROW_ID;
    actionsRow.style.cssText = [
        "display:flex",
        "align-items:center",
        "gap:10px",
        "margin:8px 0 12px",
        "flex-wrap:nowrap",
    ].join(";");
    content.appendChild(actionsRow);
    createImageUploadControl(actionsRow);
    createAutoCaptureControl(actionsRow);
    updateDevActionsVisibility();
    const panelIframe = document.createElement("iframe");
    panelIframe.id = PANEL_IFRAME_ID;
    panelIframe.className = "itrack-panel-iframe";
    panelIframe.setAttribute("title", "iTrack products");
    panelIframe.setAttribute("allowTransparency", "true");
    const fallbackToLegacy = () => {
        if (panelIframeLoaded)
            return;
        panelIframe.remove();
        mountLegacyPanelSections(content);
    };
    panelIframe.addEventListener("error", () => {
        console.warn("[iTrack] panel iframe failed to load; using legacy panel renderer");
        clearPanelIframeLoadTimeout();
        fallbackToLegacy();
    });
    panelIframe.addEventListener("load", () => {
        panelIframeLoaded = true;
        clearPanelIframeLoadTimeout();
        sendPanelDataToIframe(panelData);
    });
    try {
        panelIframe.src = runtimeGetUrl("panel/panel.html");
    }
    catch (error) {
        console.warn("[iTrack] runtime URL unavailable; using legacy panel renderer", error);
        fallbackToLegacy();
        updateProductSectionVisibility();
        createReopenPill();
        return;
    }
    content.appendChild(panelIframe);
    panelIframeLoadTimeoutId = setTimeout(() => {
        if (panelIframeLoaded)
            return;
        console.warn("[iTrack] panel iframe load timeout; using legacy panel renderer");
        fallbackToLegacy();
    }, 2000);
    updateProductSectionVisibility();
    createReopenPill();
}
// ---------------------------------------------------------------------------
// Gaze iframe injection
// ---------------------------------------------------------------------------
function injectGazeIframe() {
    if (document.getElementById(GAZE_IFRAME_ID))
        return;
    const iframe = document.createElement("iframe");
    iframe.id = GAZE_IFRAME_ID;
    // runtime.getURL resolves extension page URL across browser/chrome APIs.
    iframe.src = runtimeGetUrl("gaze-page.html");
    // Zero-size, fully transparent â€“ EyeGesturesLite renders its own overlay
    // inside the iframe's own document (moz-extension:// origin).
    // allowTransparency makes the iframe surface genuinely transparent so the
    // default white iframe background does not bleed through.
    iframe.setAttribute("allowTransparency", "true");
    // Start invisible (normal mode) â€” setGazeMode() can change this
    iframe.style.cssText = [
        "position:fixed",
        "top:0", "left:0",
        "width:100vw", "height:100vh",
        "border:none",
        "background:transparent",
        "pointer-events:none",
        `z-index:${2147483645}`,
        "opacity:1",
    ].join(";");
    // Once loaded, apply the current mode (in case setGazeMode was called before load)
    iframe.addEventListener("load", () => setGazeMode(gazeMode), { once: true });
    // Allow the iframe to use the camera
    iframe.allow = "camera";
    document.body.appendChild(iframe);
}
// ---------------------------------------------------------------------------
// Gaze hit-testing
// ---------------------------------------------------------------------------
function getGazedTile(x, y) {
    const tiles = document.querySelectorAll(".itrack-tile");
    for (const tile of Array.from(tiles)) {
        const r = tile.getBoundingClientRect();
        if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
            return tile;
        }
    }
    return null;
}
function clearDwell() {
    if (dwell.timerId !== null) {
        clearTimeout(dwell.timerId);
        dwell.timerId = null;
    }
    if (dwell.tileId) {
        const prev = document.querySelector(`[data-product-id="${dwell.tileId}"]`);
        if (prev) {
            prev.classList.remove("itrack-tile--gaze-active");
            prev.style.removeProperty("--dwell-progress");
        }
    }
    dwell.tileId = null;
    dwell.startTime = 0;
}
function fireDwellPost(tileEl, dwellMs, gazeX, gazeY) {
    var _a, _b, _c, _d;
    const body = {
        productId: (_a = tileEl.dataset.productId) !== null && _a !== void 0 ? _a : "",
        productName: (_b = tileEl.dataset.productName) !== null && _b !== void 0 ? _b : "",
        productUrl: (_c = tileEl.dataset.productUrl) !== null && _c !== void 0 ? _c : "",
        productPrice: (_d = tileEl.dataset.productPrice) !== null && _d !== void 0 ? _d : "",
        gazeX,
        gazeY,
        dwellDuration: dwellMs,
    };
    fetch(GAZE_API_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    }).catch(err => console.warn("[iTrack] gaze POST failed:", err));
}
function fireDwellPostFromPayload(payload) {
    const body = {
        productId: typeof payload.productId === "string" ? payload.productId : "",
        productName: typeof payload.productName === "string" ? payload.productName : "",
        productUrl: typeof payload.productUrl === "string" ? payload.productUrl : "",
        productPrice: typeof payload.productPrice === "string" ? payload.productPrice : "",
        gazeX: typeof payload.gazeX === "number" ? payload.gazeX : 0,
        gazeY: typeof payload.gazeY === "number" ? payload.gazeY : 0,
        dwellDuration: typeof payload.dwellDuration === "number" ? payload.dwellDuration : DWELL_THRESHOLD_MS,
    };
    fetch(GAZE_API_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    }).catch(err => console.warn("[iTrack] gaze POST failed:", err));
}
// ---------------------------------------------------------------------------
// Gaze message handler (called on each postMessage from gaze-page.html)
// ---------------------------------------------------------------------------
function handleGazeMessage(event) {
    // Only accept messages from our own extension
    if (!event.origin.startsWith("moz-extension://"))
        return;
    const data = event.data;
    if ((data === null || data === void 0 ? void 0 : data.type) !== "ITRACK_GAZE")
        return;
    const { x, y, calibrated } = data;
    if (typeof x !== "number" || typeof y !== "number")
        return;
    const calibratedBool = Boolean(calibrated);
    // Move the native gaze dot in dev mode so the cursor is visible even while
    // calibration is still in progress (useful for debugging gaze accuracy).
    if (gazeMode === "dev")
        moveGazeDot(x, y);
    observeAutoCaptureGaze(x, y, calibratedBool);
    relayGazeToPanelIframe(x, y, calibratedBool);
}
function handlePanelDwellMessage(event) {
    if (!event.origin.startsWith("moz-extension://"))
        return;
    const data = event.data;
    if ((data === null || data === void 0 ? void 0 : data.type) !== "ITRACK_DWELL_FIRED" || !data.payload || typeof data.payload !== "object")
        return;
    fireDwellPostFromPayload(data.payload);
}
function handleWindowMessage(event) {
    const data = event.data;
    if (!(data === null || data === void 0 ? void 0 : data.type))
        return;
    if (data.type === "ITRACK_GAZE") {
        handleGazeMessage(event);
        return;
    }
    if (data.type === "ITRACK_DWELL_FIRED") {
        handlePanelDwellMessage(event);
        return;
    }
    if (data.type === "ITRACK_PANEL_RESIZE") {
        const resizeData = event.data;
        if (typeof resizeData.height === "number" && Number.isFinite(resizeData.height)) {
            applyPanelIframeHeight(resizeData.height);
        }
    }
}
function init() {
    if (!isInstagram())
        return;
    if (document.getElementById(PANEL_ID))
        return;
    createPanel();
    injectGazeDot();
    injectAnchorBox();
    injectGazeIframe();
    watchForImageInput();
    window.addEventListener("message", handleWindowMessage);
}
if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
}
else {
    init();
}
window.addEventListener("itrack-products", ((e) => {
    const { recommended, all } = e.detail || { recommended: [], all: [] };
    panelData = {
        recommended: [...recommended],
        all: [...all],
    };
    sendPanelDataToIframe(panelData);
}));
const DEFAULT_CLOUDINARY_CLOUD_NAME = "";
const DEFAULT_CLOUDINARY_UPLOAD_PRESET = "";
const DEFAULT_DWELL_BACKEND_BASE_URL = "http://127.0.0.1:8000";
const DEFAULT_DWELL_USER_ID = "frontend-test-user";
const DEFAULT_DWELL_DURATION_MS = 2400;
const BACKEND_CONFIG_CACHE_MS = 60000;
const PANEL_HISTORY_LIMIT = 24;
// Optional runtime override:
// window.ITRACK_RUNTIME_CONFIG = {
//   cloudinaryCloudName: "your_cloud_name",
//   cloudinaryUploadPreset: "your_unsigned_preset",
//   dwellBackendBaseUrl: "http://127.0.0.1:8000",
//   userId: "frontend-test-user",
//   dwellDurationMs: 2400,
// };
const format = (value) => JSON.stringify(value, null, 2);
let backendConfigCache;
let panelProductSequence = 0;
function toText(value) {
    return typeof value === "string" ? value : "";
}
function toPanelProduct(raw, kind, index) {
    const name = toText(raw.name).trim();
    if (!name)
        return null;
    const imageUrl = toText(raw.image_url).trim();
    const buyUrl = toText(raw.buy_url).trim();
    const price = toText(raw.price).trim();
    const source = toText(raw.source).trim();
    return {
        id: `${kind}-live-${Date.now()}-${index}-${panelProductSequence++}`,
        name,
        shortDescription: source || "live",
        imageUrl: imageUrl || "https://placehold.co/280x280/111827/F9FAFB?text=Product",
        price: price || undefined,
        url: buyUrl || "#",
        kind,
    };
}
function normalizeProductField(value) {
    return value.trim().toLowerCase().replace(/\s+/g, " ");
}
function getProductSignature(product) {
    return [
        normalizeProductField(product.name),
        normalizeProductField(product.url),
        normalizeProductField(product.imageUrl),
    ].join("|");
}
function getUniqueProducts(products) {
    const seen = new Set();
    const unique = [];
    for (const product of products) {
        const signature = getProductSignature(product);
        if (seen.has(signature))
            continue;
        seen.add(signature);
        unique.push(product);
    }
    return unique;
}
function mergeProductHistory(existing, incoming, kind) {
    if (!incoming) {
        return getUniqueProducts(existing).slice(0, PANEL_HISTORY_LIMIT);
    }
    const normalizedIncoming = { ...incoming, kind };
    const merged = [normalizedIncoming, ...existing.map((item) => ({ ...item, kind }))];
    return getUniqueProducts(merged).slice(0, PANEL_HISTORY_LIMIT);
}
function pickBestRecommendedProduct(currentRaw, picksRaw) {
    if (currentRaw) {
        return toPanelProduct(currentRaw, "recommended", 0);
    }
    const firstPick = picksRaw[0];
    return firstPick ? toPanelProduct(firstPick, "recommended", 1) : null;
}
function pickBestCuratedProduct(picksRaw, excludedSignatures) {
    for (let index = 0; index < picksRaw.length; index += 1) {
        const candidate = toPanelProduct(picksRaw[index], "all", index);
        if (!candidate)
            continue;
        const signature = getProductSignature(candidate);
        if (excludedSignatures.has(signature))
            continue;
        return candidate;
    }
    return null;
}
function updatePanelFromDwellResponse(payload) {
    if (!payload || typeof payload !== "object") {
        console.warn("[iTrack] dwell response is not an object; panel not updated");
        return;
    }
    const response = payload;
    const currentRaw = response.current_product && typeof response.current_product === "object"
        ? response.current_product
        : undefined;
    const picksRaw = Array.isArray(response.taste_picks)
        ? response.taste_picks.filter((item) => Boolean(item && typeof item === "object"))
        : [];
    const recommendedCandidate = pickBestRecommendedProduct(currentRaw, picksRaw);
    const excludedSignatures = new Set();
    if (recommendedCandidate) {
        excludedSignatures.add(getProductSignature(recommendedCandidate));
    }
    const curatedCandidate = pickBestCuratedProduct(picksRaw, excludedSignatures);
    const recommended = mergeProductHistory(panelData.recommended, recommendedCandidate, "recommended");
    const all = mergeProductHistory(panelData.all, curatedCandidate, "all");
    if (!recommended.length && !all.length) {
        console.warn("[iTrack] dwell response did not include usable products");
        return;
    }
    window.dispatchEvent(new CustomEvent("itrack-products", {
        detail: { recommended, all },
    }));
}
function setUploadStatus(text) {
    const statusEl = document.getElementById("itrack-upload-status");
    if (statusEl)
        statusEl.textContent = text;
}
function getWindowPipelineConfig() {
    var _a, _b, _c, _d, _e;
    const runtimeConfig = ((_a = globalThis.ITRACK_RUNTIME_CONFIG) !== null && _a !== void 0 ? _a : {});
    return {
        cloudinaryCloudName: (_b = runtimeConfig.cloudinaryCloudName) !== null && _b !== void 0 ? _b : DEFAULT_CLOUDINARY_CLOUD_NAME,
        cloudinaryUploadPreset: (_c = runtimeConfig.cloudinaryUploadPreset) !== null && _c !== void 0 ? _c : DEFAULT_CLOUDINARY_UPLOAD_PRESET,
        dwellBackendBaseUrl: (_d = runtimeConfig.dwellBackendBaseUrl) !== null && _d !== void 0 ? _d : DEFAULT_DWELL_BACKEND_BASE_URL,
        userId: (_e = runtimeConfig.userId) !== null && _e !== void 0 ? _e : DEFAULT_DWELL_USER_ID,
        dwellDurationMs: typeof runtimeConfig.dwellDurationMs === "number"
            ? runtimeConfig.dwellDurationMs
            : DEFAULT_DWELL_DURATION_MS,
    };
}
async function requestViaProxyOrDirect(request) {
    var _a, _b, _c;
    const runtime = (_a = globalThis.browser) === null || _a === void 0 ? void 0 : _a.runtime;
    if (runtime === null || runtime === void 0 ? void 0 : runtime.sendMessage) {
        try {
            const raw = (await runtime.sendMessage({
                type: "ITRACK_PROXY_FETCH",
                request,
            }));
            if (raw && typeof raw.status === "number") {
                return {
                    ok: Boolean(raw.ok),
                    status: raw.status,
                    statusText: String((_b = raw.statusText) !== null && _b !== void 0 ? _b : ""),
                    text: String((_c = raw.bodyText) !== null && _c !== void 0 ? _c : ""),
                    transport: "proxy",
                };
            }
        }
        catch (proxyError) {
            console.warn("[iTrack] proxy request failed, using direct fetch", proxyError);
        }
    }
    const response = await fetch(request.url, {
        method: request.method,
        headers: request.headers,
        body: request.body,
    });
    return {
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        text: await response.text(),
        transport: "direct",
    };
}
async function fetchBackendClientConfig(dwellBackendBaseUrl) {
    const baseUrl = dwellBackendBaseUrl.replace(/\/+$/, "");
    if (backendConfigCache &&
        backendConfigCache.baseUrl === baseUrl &&
        Date.now() < backendConfigCache.expiresAt) {
        return backendConfigCache.config;
    }
    const endpoint = `${baseUrl}/runtime/client-config`;
    const result = await requestViaProxyOrDirect({ url: endpoint, method: "GET" });
    if (!result.ok) {
        console.warn("[iTrack] backend client config request failed", {
            endpoint,
            status: result.status,
            statusText: result.statusText,
            transport: result.transport,
        });
        return {};
    }
    try {
        const payload = JSON.parse(result.text);
        const config = {
            cloudinaryCloudName: typeof payload.cloudinary_cloud_name === "string" ? payload.cloudinary_cloud_name : "",
            cloudinaryUploadPreset: typeof payload.cloudinary_upload_preset === "string" ? payload.cloudinary_upload_preset : "",
        };
        backendConfigCache = {
            baseUrl,
            expiresAt: Date.now() + BACKEND_CONFIG_CACHE_MS,
            config,
        };
        console.log("[iTrack] loaded backend client config", {
            endpoint,
            transport: result.transport,
            cloudinaryDirectUploadEnabled: Boolean(config.cloudinaryCloudName && config.cloudinaryUploadPreset),
        });
        return config;
    }
    catch {
        console.warn("[iTrack] backend client config parse failed", {
            endpoint,
            transport: result.transport,
        });
        return {};
    }
}
async function resolvePipelineConfig() {
    const windowConfig = getWindowPipelineConfig();
    if (windowConfig.cloudinaryCloudName && windowConfig.cloudinaryUploadPreset) {
        return windowConfig;
    }
    const backendConfig = await fetchBackendClientConfig(windowConfig.dwellBackendBaseUrl);
    return {
        ...windowConfig,
        cloudinaryCloudName: windowConfig.cloudinaryCloudName || backendConfig.cloudinaryCloudName || "",
        cloudinaryUploadPreset: windowConfig.cloudinaryUploadPreset || backendConfig.cloudinaryUploadPreset || "",
    };
}
const asBase64 = (blob) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
        var _a;
        const result = String((_a = reader.result) !== null && _a !== void 0 ? _a : "");
        const base64 = result.includes(",") ? result.split(",")[1] : "";
        resolve(base64);
    };
    reader.onerror = () => { var _a; return reject((_a = reader.error) !== null && _a !== void 0 ? _a : new Error("Blob read failed")); };
    reader.readAsDataURL(blob);
});
async function uploadImageToCloudinary(file, config) {
    var _a;
    if (!config.cloudinaryCloudName || !config.cloudinaryUploadPreset) {
        throw new Error("Missing Cloudinary config. Set window.ITRACK_RUNTIME_CONFIG.cloudinaryCloudName and .cloudinaryUploadPreset.");
    }
    const formData = new FormData();
    formData.append("file", file);
    formData.append("upload_preset", config.cloudinaryUploadPreset);
    const response = await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(config.cloudinaryCloudName)}/image/upload`, { method: "POST", body: formData });
    const payload = (await response.json());
    const cloudinaryError = typeof payload.error === "string" ? payload.error : (_a = payload.error) === null || _a === void 0 ? void 0 : _a.message;
    if (!response.ok || !payload.secure_url || !payload.public_id) {
        throw new Error(`Cloudinary upload failed (${response.status} ${response.statusText}): ${cloudinaryError !== null && cloudinaryError !== void 0 ? cloudinaryError : "invalid response"}`);
    }
    return { secureUrl: payload.secure_url, publicId: payload.public_id };
}
async function cloudinaryUrlToBase64(url) {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to fetch uploaded Cloudinary image (${response.status} ${response.statusText})`);
    }
    const blob = await response.blob();
    return asBase64(blob);
}
async function processImageForDwell(file) {
    var _a;
    const config = await resolvePipelineConfig();
    let screenshotB64 = "";
    let screenshotUrl;
    let screenshotPublicId;
    if (config.cloudinaryCloudName && config.cloudinaryUploadPreset) {
        setUploadStatus("Uploading to Cloudinary...");
        const uploaded = await uploadImageToCloudinary(file, config);
        screenshotUrl = uploaded.secureUrl;
        screenshotPublicId = uploaded.publicId;
        screenshotB64 = await cloudinaryUrlToBase64(uploaded.secureUrl);
        console.log("[iTrack] cloudinary upload method", {
            method: "browser_unsigned_direct_file",
            secureUrl: screenshotUrl,
            publicId: screenshotPublicId,
        });
    }
    else {
        // Fallback so backend-side Cloudinary upload can still run in /dwell.
        setUploadStatus("Cloudinary config missing, sending base64...");
        screenshotB64 = await asBase64(file);
        console.log("[iTrack] cloudinary upload method", {
            method: "local_base64_fallback",
            reason: "missing cloudinaryCloudName or cloudinaryUploadPreset",
        });
    }
    if (!screenshotB64) {
        throw new Error("Image conversion to base64 failed.");
    }
    const body = {
        user_id: config.userId,
        dwell_duration_ms: config.dwellDurationMs,
        page_url: window.location.href,
        page_title: document.title,
        screenshot_b64: screenshotB64,
        screenshot_url: screenshotUrl,
        screenshot_public_id: screenshotPublicId,
    };
    console.log("[iTrack] sending /dwell", {
        endpoint: `${config.dwellBackendBaseUrl}/dwell`,
        userId: body.user_id,
        dwellDurationMs: body.dwell_duration_ms,
        hasScreenshotB64: Boolean(body.screenshot_b64),
        screenshotB64Length: body.screenshot_b64.length,
        screenshotUrl: (_a = body.screenshot_url) !== null && _a !== void 0 ? _a : null,
    });
    const endpoint = `${config.dwellBackendBaseUrl}/dwell`;
    const requestBody = JSON.stringify(body);
    setUploadStatus("Sending to backend...");
    const result = await requestViaProxyOrDirect({
        url: endpoint,
        method: "POST",
        headers: { "content-type": "application/json" },
        body: requestBody,
    });
    console.log("[iTrack] /dwell transport", {
        transport: result.transport,
        status: result.status,
        statusText: result.statusText,
    });
    let parsed = null;
    if (result.text) {
        try {
            parsed = JSON.parse(result.text);
        }
        catch {
            parsed = result.text;
        }
    }
    if (!result.ok) {
        throw new Error(`Request failed: ${result.status} ${result.statusText}`);
    }
    return parsed;
}
async function handleImageFile(file) {
    setUploadStatus("Sending...");
    try {
        const parsed = await processImageForDwell(file);
        updatePanelFromDwellResponse(parsed);
        console.log("[iTrack] dwell workflow response", format(parsed));
        setUploadStatus(`Success ${new Date().toLocaleTimeString()}`);
        return true;
    }
    catch (error) {
        console.error("[iTrack] dwell workflow error", format({ error: String(error) }));
        setUploadStatus("Error");
        return false;
    }
}
function bindImageInput() {
    const fileInput = document.getElementById("imageFile");
    if (!(fileInput instanceof HTMLInputElement))
        return;
    if (fileInput.dataset.itrackBound === "true")
        return;
    fileInput.dataset.itrackBound = "true";
    fileInput.addEventListener("change", () => {
        var _a;
        const file = (_a = fileInput.files) === null || _a === void 0 ? void 0 : _a[0];
        if (!file)
            return;
        console.log("[iTrack] upload selected", {
            name: file.name,
            size: file.size,
            type: file.type,
        });
        void handleImageFile(file);
    });
}
function watchForImageInput() {
    bindImageInput();
    const observer = new MutationObserver(() => bindImageInput());
    observer.observe(document.body, { childList: true, subtree: true });
}
window.addEventListener("itrack-process-image", ((e) => {
    var _a;
    const file = (_a = e.detail) === null || _a === void 0 ? void 0 : _a.file;
    if (!(file instanceof File)) {
        console.warn("[iTrack] itrack-process-image event missing detail.file");
        return;
    }
    void handleImageFile(file);
}));
