/**
 * iTrack Firefox extension – content script.
 * Injects a right-side panel on Instagram with Recommended products (top) and All products (bottom).
 * Clicking a product tile redirects to its link immediately in a new tab.
 * Removes Instagram Reels nav buttons, Messages toolbar, and floating buttons dynamically.
 *
 * Eye-gaze integration via EyeGesturesLite:
 * A hidden moz-extension iframe (gaze-page.html) runs EyeGesturesLite and relays
 * gaze coordinates here via postMessage. When the gaze dwells on a product tile
 * for DWELL_THRESHOLD_MS milliseconds, a POST is sent to GAZE_API_ENDPOINT.
 */

interface Product {
  id: string;
  name: string;
  shortDescription: string;
  imageUrl: string;
  price?: string;
  url: string; // product link
  kind: "recommended" | "all";
}

const MOCK_RECOMMENDED: Product[] = [
  { id: "rec-1", name: "Pegasus Runner", shortDescription: "Lightweight road-running shoe", imageUrl: "https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=280&h=280&fit=crop", price: "$120", url: "https://example.com/pegasus-runner", kind: "recommended" },
  { id: "rec-2", name: "Studio Headphones", shortDescription: "Noise-cancelling over-ear", imageUrl: "https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=280&h=280&fit=crop", price: "$349", url: "https://example.com/studio-headphones", kind: "recommended" },
  { id: "rec-3", name: "Everyday Tote", shortDescription: "Soft leather carry-all", imageUrl: "https://images.unsplash.com/photo-1584917865442-de89df76afd3?w=280&h=280&fit=crop", price: "$245", url: "https://example.com/everyday-tote", kind: "recommended" },
];

const MOCK_ALL: Product[] = [
  { id: "all-1", name: "Classic Tee", shortDescription: "Organic cotton, relaxed fit", imageUrl: "https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=280&h=280&fit=crop", price: "$25", url: "https://example.com/classic-tee", kind: "all" },
  { id: "all-2", name: "Daypack", shortDescription: "Minimal everyday backpack", imageUrl: "https://images.unsplash.com/photo-1553062407-98eeb64c6a62?w=280&h=280&fit=crop", price: "$89", url: "https://example.com/daypack", kind: "all" },
  { id: "all-3", name: "Smart Water Bottle", shortDescription: "Tracks intake, glows on schedule", imageUrl: "https://images.unsplash.com/photo-1602143407151-7111542de6e8?w=280&h=280&fit=crop", price: "$59", url: "https://example.com/smart-bottle", kind: "all" },
];

const PANEL_ID       = "itrack-panel";
const REOPEN_ID      = "itrack-reopen-pill";
const GAZE_IFRAME_ID = "itrack-gaze-iframe";
const GAZE_DOT_ID    = "itrack-gaze-dot";

/** Replace with your real API endpoint. */
const GAZE_API_ENDPOINT = "http://localhost:3000/api/gaze";

/** Milliseconds a gaze must stay on a tile before the POST fires. */
const DWELL_THRESHOLD_MS = 1500;

// ---------------------------------------------------------------------------
// Gaze mode
// ---------------------------------------------------------------------------
type GazeMode = "calibration" | "dev" | "normal";

let gazeMode: GazeMode = "normal";

// ---------------------------------------------------------------------------
// Dev-mode gaze dot (a native element on the host page, always transparent)
// ---------------------------------------------------------------------------

/**
 * Creates a small circular dot fixed over the whole viewport.
 * It is the visual stand-in for EyeGesturesLite's own cursor in dev mode,
 * rendered on the host page so it is completely unaffected by the iframe's
 * white document background.
 */
function injectGazeDot(): void {
  if (document.getElementById(GAZE_DOT_ID)) return;
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

function showGazeDot(visible: boolean): void {
  const dot = document.getElementById(GAZE_DOT_ID);
  if (dot) dot.style.display = visible ? "block" : "none";
}

/** Translate the dot so its centre sits at (x, y) in viewport coordinates. */
function moveGazeDot(x: number, y: number): void {
  const dot = document.getElementById(GAZE_DOT_ID);
  if (!dot || dot.style.display === "none") return;
  // Dot is 18px wide; shift by -9px so the centre lands on the gaze point.
  dot.style.transform = `translate(${x - 9}px, ${y - 9}px)`;
}

/**
 * calibration – white overlay, pointer-events active so calibration UI is
 *               interactive; eye tracking cursor + calibration dots visible.
 * dev          – iframe stays invisible (opacity 0) so its white background
 *               never shows; a native gaze dot on the host page shows position.
 * normal       – iframe invisible; tracking runs silently in the background,
 *               dwell POSTs still fire.
 */
function setGazeMode(mode: GazeMode): void {
  gazeMode = mode;

  // Update active-button highlight
  document.querySelectorAll<HTMLButtonElement>(".itrack-gaze-btn").forEach(btn => {
    btn.classList.toggle("itrack-gaze-btn--active", btn.dataset.mode === mode);
  });

  // Show the native gaze dot only in dev mode.
  showGazeDot(mode === "dev");

  const iframe = document.getElementById(GAZE_IFRAME_ID) as HTMLIFrameElement | null;
  if (!iframe) return;

  switch (mode) {
    case "calibration":
      // Full-screen overlay needed so calibration dots and the webcam feed
      // are interactive and visible.
      iframe.style.opacity       = "1";
      iframe.style.pointerEvents = "auto";
      break;
    case "dev":
      // Hide the iframe — its document always has a white background that
      // can't be made transparent. The native gaze dot above replaces the
      // built-in EyeGesturesLite cursor.
      iframe.style.opacity       = "0";
      iframe.style.pointerEvents = "none";
      break;
    case "normal":
      iframe.style.opacity       = "0";
      iframe.style.pointerEvents = "none";
      break;
  }

  // Tell the iframe so it can show/hide the cursor and set background colour
  iframe.contentWindow?.postMessage({ type: "ITRACK_SET_MODE", mode }, "*");
}

// ---------------------------------------------------------------------------
// Dwell state
// ---------------------------------------------------------------------------
interface DwellState {
  tileId: string | null;
  timerId: ReturnType<typeof setTimeout> | null;
  startTime: number;
}

const dwell: DwellState = { tileId: null, timerId: null, startTime: 0 };

function isInstagram(): boolean {
  return window.location.hostname.includes("instagram.com");
}

function removeInstagramUI(): void {
  document.querySelectorAll('div[aria-label*="Messages"]').forEach(el => el.remove());
  document.querySelectorAll('div[role="button"] > div[data-visualcompletion="ignore"]').forEach(el => el.parentElement?.remove());
  const reelsNav = document.querySelector('div[aria-label="Reels navigation controls"]');
  if (reelsNav) reelsNav.remove();

  const observer = new MutationObserver(() => {
    document.querySelectorAll('div[aria-label*="Messages"]').forEach(el => el.remove());
    document.querySelectorAll('div[role="button"] > div[data-visualcompletion="ignore"]').forEach(el => el.parentElement?.remove());
  });
  observer.observe(document.body, { childList: true, subtree: true });
  setTimeout(() => observer.disconnect(), 15000);
}

function getOrCreatePanel(): HTMLElement {
  let panel = document.getElementById(PANEL_ID) as HTMLElement | null;
  if (!panel) {
    panel = document.createElement("div");
    panel.id = PANEL_ID;
    panel.className = "itrack-panel";
    document.body.appendChild(panel);
  }
  panel.innerHTML = "";
  return panel;
}

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function attachImageFallback(img: HTMLImageElement): void {
  img.addEventListener("error", () => {
    img.src = "https://placehold.co/280x280/111827/F9FAFB?text=Product";
  }, { once: true });
}

// Clicking tile now opens the product URL in a new tab
function renderTile(container: HTMLElement, product: Product): void {
  const tile = document.createElement("div");
  tile.className = "itrack-tile";
  tile.setAttribute("data-product-id",    product.id);
  tile.setAttribute("data-product-name",  product.name);
  tile.setAttribute("data-product-url",   product.url);
  tile.setAttribute("data-product-price", product.price ?? "");
  const priceHtml = product.price ? ` <span class="itrack-tile-price">${escapeHtml(product.price)}</span>` : "";
  tile.innerHTML = `
    <div class="itrack-tile-media">
      <img src="${escapeHtml(product.imageUrl)}" alt="" width="56" height="56" loading="lazy" />
    </div>
    <div class="itrack-tile-body">
      <span class="itrack-tile-name">${escapeHtml(product.name)}</span>${priceHtml}
    </div>
  `;
  const img = tile.querySelector("img") as HTMLImageElement | null;
  if (img) attachImageFallback(img);

  // Open product link on click
  tile.addEventListener("click", () => {
    window.open(product.url, "_blank");
  });

  container.appendChild(tile);
}

function createSection(parent: HTMLElement, title: string, products: Product[], containerId: string): HTMLElement {
  const section = document.createElement("div");
  section.className = "itrack-section";
  section.innerHTML = `<h2 class="itrack-section-title">${escapeHtml(title)}</h2><div id="${containerId}" class="itrack-tiles"></div>`;
  parent.appendChild(section);
  const container = section.querySelector(`#${containerId}`) as HTMLElement;
  products.forEach(p => renderTile(container, p));
  return container;
}

function createReopenPill(): void {
  if (document.getElementById(REOPEN_ID)) return;
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

function createGazeControls(parent: HTMLElement): void {
  const bar = document.createElement("div");
  bar.className = "itrack-gaze-controls";

  const modes: { mode: GazeMode; label: string; title: string }[] = [
    { mode: "calibration", label: "Calibrate", title: "Show calibration overlay" },
    { mode: "dev",         label: "Dev",       title: "Show gaze cursor (transparent)" },
    { mode: "normal",      label: "Normal",    title: "Run tracking silently" },
  ];

  modes.forEach(({ mode, label, title }) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "itrack-gaze-btn" + (mode === gazeMode ? " itrack-gaze-btn--active" : "");
    btn.dataset.mode = mode;
    btn.textContent  = label;
    btn.title        = title;
    btn.addEventListener("click", () => setGazeMode(mode));
    bar.appendChild(btn);
  });

  parent.appendChild(bar);
}

function createPanel(): void {
  removeInstagramUI();
  const panel = getOrCreatePanel();
  panel.classList.remove("itrack-panel-hidden");

  const content = document.createElement("div");
  content.className = "itrack-content";
  panel.appendChild(content);

  createGazeControls(content);
  createSection(content, "Recommended products", MOCK_RECOMMENDED, "itrack-recommended-tiles");
  createSection(content, "All products", MOCK_ALL, "itrack-all-tiles");

  createReopenPill();
}

// ---------------------------------------------------------------------------
// Gaze iframe injection
// ---------------------------------------------------------------------------
function injectGazeIframe(): void {
  if (document.getElementById(GAZE_IFRAME_ID)) return;
  const iframe = document.createElement("iframe");
  iframe.id  = GAZE_IFRAME_ID;
  // browser.runtime.getURL is available in content scripts in Firefox MV2
  iframe.src = (globalThis as any).browser.runtime.getURL("gaze-page.html");
  // Zero-size, fully transparent – EyeGesturesLite renders its own overlay
  // inside the iframe's own document (moz-extension:// origin).
  // allowTransparency makes the iframe surface genuinely transparent so the
  // default white iframe background does not bleed through.
  iframe.setAttribute("allowTransparency", "true");
  // Start invisible (normal mode) — setGazeMode() can change this
  iframe.style.cssText = [
    "position:fixed",
    "top:0","left:0",
    "width:100vw","height:100vh",
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
function getGazedTile(x: number, y: number): HTMLElement | null {
  const tiles = document.querySelectorAll<HTMLElement>(".itrack-tile");
  for (const tile of Array.from(tiles)) {
    const r = tile.getBoundingClientRect();
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
      return tile;
    }
  }
  return null;
}

function clearDwell(): void {
  if (dwell.timerId !== null) {
    clearTimeout(dwell.timerId);
    dwell.timerId = null;
  }
  if (dwell.tileId) {
    const prev = document.querySelector<HTMLElement>(`[data-product-id="${dwell.tileId}"]`);
    if (prev) {
      prev.classList.remove("itrack-tile--gaze-active");
      prev.style.removeProperty("--dwell-progress");
    }
  }
  dwell.tileId  = null;
  dwell.startTime = 0;
}

function fireDwellPost(
  tileEl: HTMLElement,
  dwellMs: number,
  gazeX: number,
  gazeY: number
): void {
  const body = {
    productId:    tileEl.dataset.productId    ?? "",
    productName:  tileEl.dataset.productName  ?? "",
    productUrl:   tileEl.dataset.productUrl   ?? "",
    productPrice: tileEl.dataset.productPrice ?? "",
    gazeX,
    gazeY,
    dwellDuration: dwellMs,
  };
  fetch(GAZE_API_ENDPOINT, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(body),
  }).catch(err => console.warn("[iTrack] gaze POST failed:", err));
}

// ---------------------------------------------------------------------------
// Gaze message handler (called on each postMessage from gaze-page.html)
// ---------------------------------------------------------------------------
function handleGazeMessage(event: MessageEvent): void {
  // Only accept messages from our own extension
  if (!event.origin.startsWith("moz-extension://")) return;

  const data = event.data as { type?: string; x?: number; y?: number; calibrated?: boolean };
  if (data?.type !== "ITRACK_GAZE") return;

  const { x, y, calibrated } = data;
  if (typeof x !== "number" || typeof y !== "number") return;

  // Move the native gaze dot in dev mode so the cursor is visible even while
  // calibration is still in progress (useful for debugging gaze accuracy).
  if (gazeMode === "dev") moveGazeDot(x, y);

  // Skip frames during calibration – gaze is not yet reliable for dwell
  if (!calibrated) return;

  const tile = getGazedTile(x, y);
  const tileId = tile?.dataset.productId ?? null;

  if (tileId !== dwell.tileId) {
    // Gaze moved to a different tile (or off all tiles)
    clearDwell();
    if (tile && tileId) {
      dwell.tileId    = tileId;
      dwell.startTime = Date.now();
      tile.classList.add("itrack-tile--gaze-active");
      dwell.timerId = setTimeout(() => {
        const el = document.querySelector<HTMLElement>(`[data-product-id="${tileId}"]`);
        if (el) {
          fireDwellPost(el, DWELL_THRESHOLD_MS, x, y);
          // Flash the tile to confirm the dwell fired
          el.classList.add("itrack-tile--dwell-fired");
          setTimeout(() => el.classList.remove("itrack-tile--dwell-fired"), 600);
        }
        clearDwell();
      }, DWELL_THRESHOLD_MS);
    }
  } else if (tile && tileId) {
    // Still dwelling on same tile – update CSS progress variable
    const elapsed  = Date.now() - dwell.startTime;
    const progress = Math.min(elapsed / DWELL_THRESHOLD_MS, 1);
    tile.style.setProperty("--dwell-progress", String(progress));
  }
}

function init(): void {
  if (!isInstagram()) return;
  if (document.getElementById(PANEL_ID)) return;
  createPanel();
  injectGazeDot();
  injectGazeIframe();
  window.addEventListener("message", handleGazeMessage);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}

window.addEventListener("itrack-products", ((e: CustomEvent<{ recommended: Product[]; all: Product[] }>) => {
  const { recommended, all } = e.detail || { recommended: [], all: [] };
  const recContainer = document.getElementById("itrack-recommended-tiles");
  const allContainer = document.getElementById("itrack-all-tiles");
  if (!recContainer || !allContainer) return;
  recContainer.innerHTML = "";
  allContainer.innerHTML = "";
  recommended.forEach(p => renderTile(recContainer, p));
  all.forEach(p => renderTile(allContainer, p));
}) as EventListener);