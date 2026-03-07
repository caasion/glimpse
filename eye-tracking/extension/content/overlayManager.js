(function initOverlayManager(global) {
  "use strict";

  var namespace = global.EyeGazeCapture = global.EyeGazeCapture || {};
  var config = namespace.config;

  function OverlayManager() {
    this.host = null;
    this.shadow = null;
    this.scene = null;
    this.guidesLayer = null;
    this.reticle = null;
    this.status = null;
    this.flash = null;
    this.lastFlashTimer = null;
  }

  OverlayManager.prototype.mount = function mount() {
    var style;

    if (this.host) {
      return;
    }

    this.host = global.document.createElement("div");
    this.host.id = "eyetrax-dwell-overlay-host";
    this.host.setAttribute("aria-hidden", "true");
    this.host.style.position = "fixed";
    this.host.style.inset = "0";
    this.host.style.zIndex = String(config.OVERLAY_Z_INDEX);
    this.host.style.pointerEvents = "none";

    this.shadow = this.host.attachShadow({
      mode: "open"
    });

    style = global.document.createElement("style");
    style.textContent = [
      ":host { all: initial; }",
      ".scene { position: fixed; inset: 0; pointer-events: none; opacity: 1; transition: opacity 180ms ease; color: #eff4ff; font-family: 'Segoe UI', 'SF Pro Display', sans-serif; }",
      ".scene.hidden { opacity: 0; }",
      ".guides { position: absolute; inset: 0; }",
      ".anchor-box { position: absolute; border: 1px solid rgba(103, 245, 196, 0.9); border-radius: 16px; background: rgba(103, 245, 196, 0.08); box-shadow: 0 0 0 1px rgba(103, 245, 196, 0.18), 0 0 28px rgba(103, 245, 196, 0.12); overflow: hidden; }",
      ".anchor-box.cooldown { border-color: rgba(255, 194, 109, 0.9); background: rgba(255, 194, 109, 0.08); box-shadow: 0 0 0 1px rgba(255, 194, 109, 0.18), 0 0 28px rgba(255, 194, 109, 0.12); }",
      ".anchor-progress { position: absolute; left: 0; right: 0; bottom: 0; height: 4px; width: 0%; background: linear-gradient(90deg, rgba(103, 245, 196, 0.95), rgba(130, 169, 255, 0.9)); transition: width 80ms linear; }",
      ".pointer-box { position: absolute; border: 1px solid rgba(255, 255, 255, 0.92); border-radius: 4px; background: rgba(255, 255, 255, 0.08); box-shadow: 0 0 12px rgba(255, 255, 255, 0.22); }",
      ".reticle { position: absolute; width: 10px; height: 10px; margin-left: -5px; margin-top: -5px; border-radius: 50%; opacity: 0; transform: translate3d(-9999px, -9999px, 0); background: radial-gradient(circle, rgba(255,255,255,1), rgba(103,245,196,0.95)); box-shadow: 0 0 14px rgba(103, 245, 196, 0.55); transition: opacity 120ms ease, transform 40ms linear; }",
      ".reticle.visible { opacity: 1; }",
      ".status { position: absolute; right: 20px; top: 20px; max-width: 340px; padding: 10px 14px; border-radius: 16px; background: rgba(8, 12, 23, 0.72); border: 1px solid rgba(255,255,255,0.12); box-shadow: 0 20px 40px rgba(4, 6, 12, 0.2); font-size: 12px; line-height: 1.45; white-space: pre-line; }",
      ".status.hidden { opacity: 0; }",
      ".flash { position: absolute; inset: 0; opacity: 0; background: radial-gradient(circle, rgba(255,255,255,0.16), rgba(255,255,255,0)); transition: opacity 180ms ease; }",
      ".flash.active { opacity: 1; }",
      ".flash.error { background: radial-gradient(circle, rgba(255,110,110,0.18), rgba(255,255,255,0)); }"
    ].join("\n");

    this.scene = global.document.createElement("div");
    this.scene.className = "scene hidden";
    this.scene.innerHTML = [
      "<div class='guides'></div>",
      "<div class='reticle'></div>",
      "<div class='status hidden'></div>",
      "<div class='flash'></div>"
    ].join("");

    this.shadow.appendChild(style);
    this.shadow.appendChild(this.scene);
    (global.document.documentElement || global.document.body).appendChild(this.host);

    this.guidesLayer = this.scene.querySelector(".guides");
    this.reticle = this.scene.querySelector(".reticle");
    this.status = this.scene.querySelector(".status");
    this.flash = this.scene.querySelector(".flash");
  };

  OverlayManager.prototype._renderDebugGuides = function renderDebugGuides(anchorBounds, pointerBounds, dwellProgress, isCooldown) {
    var fragment = global.document.createDocumentFragment();

    this.guidesLayer.innerHTML = "";

    if (anchorBounds) {
      var anchor = global.document.createElement("div");
      var progress = global.document.createElement("div");

      anchor.className = "anchor-box" + (isCooldown ? " cooldown" : "");
      anchor.style.left = anchorBounds.x + "px";
      anchor.style.top = anchorBounds.y + "px";
      anchor.style.width = anchorBounds.width + "px";
      anchor.style.height = anchorBounds.height + "px";

      progress.className = "anchor-progress";
      progress.style.width = Math.round(Math.max(0, Math.min(1, dwellProgress || 0)) * 100) + "%";

      anchor.appendChild(progress);
      fragment.appendChild(anchor);
    }

    if (pointerBounds) {
      var pointerBox = global.document.createElement("div");

      pointerBox.className = "pointer-box";
      pointerBox.style.left = pointerBounds.x + "px";
      pointerBox.style.top = pointerBounds.y + "px";
      pointerBox.style.width = pointerBounds.width + "px";
      pointerBox.style.height = pointerBounds.height + "px";

      fragment.appendChild(pointerBox);
    }

    this.guidesLayer.appendChild(fragment);
  };

  OverlayManager.prototype._renderReticle = function renderReticle(point, valid) {
    if (!point || !valid) {
      this.reticle.classList.remove("visible");
      return;
    }

    this.reticle.classList.add("visible");
    this.reticle.style.transform = "translate3d(" + Math.round(point.x) + "px, " + Math.round(point.y) + "px, 0)";
  };

  OverlayManager.prototype.render = function render(model) {
    var visible = Boolean(model.trackingEnabled && model.overlayEnabled);

    this.mount();
    this.scene.classList.toggle("hidden", !visible);
    this._renderReticle(model.point, model.valid);

    if (model.debugEnabled) {
      this._renderDebugGuides(
        model.anchorBounds,
        model.pointerBounds,
        model.dwellProgress || 0,
        model.dwellState === config.DWELL_STATES.COOLDOWN
      );
    } else {
      this.guidesLayer.innerHTML = "";
    }

    if (model.debugEnabled && model.statusText) {
      this.status.classList.remove("hidden");
      this.status.textContent = model.statusText;
    } else {
      this.status.classList.add("hidden");
      this.status.textContent = "";
    }
  };

  OverlayManager.prototype.flashCapture = function flashCapture(message, isError) {
    var overlayManager = this;

    this.mount();
    this.flash.classList.add("active");
    this.flash.classList.toggle("error", Boolean(isError));

    if (message) {
      this.status.classList.remove("hidden");
      this.status.textContent = message;
    }

    if (this.lastFlashTimer) {
      global.clearTimeout(this.lastFlashTimer);
    }

    this.lastFlashTimer = global.setTimeout(function () {
      overlayManager.flash.classList.remove("active");
      overlayManager.flash.classList.remove("error");
    }, 220);
  };

  namespace.content = namespace.content || {};
  namespace.content.OverlayManager = OverlayManager;
})(typeof globalThis !== "undefined" ? globalThis : this);
