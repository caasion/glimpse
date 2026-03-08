(function startContentScript(global) {
  "use strict";

  var namespace = global.EyeGazeCapture = global.EyeGazeCapture || {};
  var browserApi = namespace.browser;
  var messages = namespace.messages.MESSAGE_TYPES;
  var config = namespace.config;

  var overlay = new namespace.content.OverlayManager();
  var dwellEngine = new namespace.content.DwellEngine({
    dwellThresholdMs: config.DEFAULT_SETTINGS.dwellThresholdMs,
    cooldownMs: config.DEFAULT_SETTINGS.cooldownMs,
    minimumConfidence: config.DEFAULT_SETTINGS.minimumConfidence,
    anchorBoxSize: config.ANCHOR_BOX_SIZE
  });
  var session = {
    settings: Object.assign({}, config.DEFAULT_SETTINGS),
    calibration: Object.assign({}, config.DEFAULT_CALIBRATION_STATE),
    bridgeStatus: config.BRIDGE_STATUSES.DISCONNECTED,
    trackingActive: false,
    lastError: null
  };
  var lastSample = null;

  function getViewportOrigin() {
    if (typeof global.mozInnerScreenX === "number" && typeof global.mozInnerScreenY === "number") {
      return {
        x: global.mozInnerScreenX,
        y: global.mozInnerScreenY
      };
    }

    return {
      x: global.screenX || 0,
      y: global.screenY || 0
    };
  }

  function getViewportMetrics() {
    var origin = getViewportOrigin();
    return {
      width: global.innerWidth,
      height: global.innerHeight,
      devicePixelRatio: global.devicePixelRatio || 1,
      innerScreenX: origin.x,
      innerScreenY: origin.y
    };
  }

  function clampPointToViewport(point) {
    if (!point) {
      return null;
    }

    return {
      x: Math.max(0, Math.min(global.innerWidth, Math.round(point.x))),
      y: Math.max(0, Math.min(global.innerHeight, Math.round(point.y)))
    };
  }

  function syncSession(snapshot) {
    if (!snapshot) {
      return;
    }

    session = {
      settings: Object.assign({}, session.settings, snapshot.settings || {}),
      calibration: Object.assign({}, session.calibration, snapshot.calibration || {}),
      bridgeStatus: snapshot.bridgeStatus || session.bridgeStatus,
      trackingActive: Boolean(snapshot.trackingActive),
      lastError: snapshot.lastError || null
    };

    dwellEngine.updateConfig(
      session.settings.dwellThresholdMs,
      session.settings.cooldownMs,
      session.settings.minimumConfidence
    );

    renderOverlay(lastSample);
  }

  function toViewportPoint(sample) {
    var origin = getViewportOrigin();
    var offsetX = Number(session.settings.gazeOffsetX) || 0;
    var offsetY = Number(session.settings.gazeOffsetY) || 0;
    return {
      x: Math.round(sample.x - origin.x - offsetX),
      y: Math.round(sample.y - origin.y - offsetY)
    };
  }

  function isValidViewportPoint(point, sample) {
    return Boolean(
      sample &&
      sample.valid &&
      point &&
      point.x >= 0 &&
      point.y >= 0 &&
      point.x <= global.innerWidth &&
      point.y <= global.innerHeight
    );
  }

  function buildPointerBounds(point) {
    var half = config.POINTER_BOX_SIZE / 2;
    return {
      x: Math.round(point.x - half),
      y: Math.round(point.y - half),
      width: config.POINTER_BOX_SIZE,
      height: config.POINTER_BOX_SIZE
    };
  }

  function buildStatusText(point, sample, dwellSnapshot) {
    var lines = [];
    lines.push("Bridge: " + session.bridgeStatus);
    lines.push("Calibration: " + session.calibration.status);
    lines.push("Tracking: " + (session.trackingActive ? "running" : "stopped"));
    lines.push("Dwell state: " + dwellSnapshot.state);
    lines.push("Dwell: " + Math.round((dwellSnapshot.progress || 0) * 100) + "%");
    if (point && sample && sample.valid) {
      lines.push("Viewport gaze: " + point.x + ", " + point.y);
    } else {
      lines.push("Viewport gaze: invalid");
    }
    if (dwellSnapshot.anchorBounds) {
      lines.push(
        "Anchor box: " +
        dwellSnapshot.anchorBounds.x + ", " +
        dwellSnapshot.anchorBounds.y + ", " +
        dwellSnapshot.anchorBounds.width + "x" +
        dwellSnapshot.anchorBounds.height
      );
    }
    if (session.lastError) {
      lines.push("Error: " + session.lastError);
    }
    return lines.join("\n");
  }

  function renderOverlay(sample) {
    var point = sample ? toViewportPoint(sample) : null;
    var valid = point ? isValidViewportPoint(point, sample) : false;
    var clampedPoint = point ? clampPointToViewport(point) : null;
    var dwellSnapshot = dwellEngine.getSnapshot();

    overlay.render({
      trackingEnabled: session.settings.trackingEnabled,
      overlayEnabled: session.settings.overlayEnabled,
      debugEnabled: session.settings.debugEnabled,
      point: clampedPoint,
      valid: Boolean(valid && clampedPoint),
      pointerBounds: clampedPoint ? buildPointerBounds(clampedPoint) : null,
      anchorBounds: dwellSnapshot.anchorBounds,
      dwellState: dwellSnapshot.state,
      dwellProgress: dwellSnapshot.progress,
      statusText: buildStatusText(point, sample, dwellSnapshot)
    });
  }

  async function triggerCapture(result, sample) {
    try {
      await browserApi.runtime.sendMessage({
        type: messages.DWELL_TRIGGER,
        payload: {
          timestamp: sample.timestamp || Date.now(),
          pageUrl: global.location.href,
          pageTitle: global.document.title || "",
          roi: result.roi,
          dwellDurationMs: result.dwellDurationMs,
          filterMode: session.settings.filterMode,
          overlayEnabled: session.settings.overlayEnabled,
          trackingEnabled: session.settings.trackingEnabled,
          viewport: getViewportMetrics()
        }
      });
    } catch (error) {
      console.warn("Dwell trigger failed", error);
    }
  }

  async function handleGazeSample(sample) {
    var point;
    var valid;
    var result;

    if (!session.settings.trackingEnabled) {
      dwellEngine.reset();
      renderOverlay(sample);
      return;
    }

    lastSample = sample;
    point = toViewportPoint(sample);
    valid = isValidViewportPoint(point, sample) &&
      (sample.confidence == null || sample.confidence >= session.settings.minimumConfidence);

    result = dwellEngine.update({
      point: point,
      valid: valid,
      confidence: sample.confidence,
      timestamp: sample.timestamp
    });

    renderOverlay(sample);

    if (result.triggered) {
      await triggerCapture(result, sample);
    }
  }

  function handleMessage(message) {
    if (!message || !message.type) {
      return undefined;
    }

    switch (message.type) {
      case messages.GAZE_SAMPLE:
        return handleGazeSample(message.payload);
      case messages.SESSION_STATE_UPDATED:
        syncSession(message.payload);
        return Promise.resolve();
      case messages.CAPTURE_COMPLETED:
        overlay.flashCapture("Saved " + message.payload.baseName, false);
        return Promise.resolve();
      case messages.CAPTURE_FAILED:
        overlay.flashCapture("Capture failed: " + message.payload.message, true);
        return Promise.resolve();
      default:
        return undefined;
    }
  }

  async function initialize() {
    overlay.mount();
    renderOverlay(null);

    global.addEventListener("resize", function () {
      renderOverlay(lastSample);
    });

    global.addEventListener("scroll", function () {
      renderOverlay(lastSample);
    }, {
      passive: true
    });

    global.document.addEventListener("visibilitychange", function () {
      if (global.document.hidden) {
        dwellEngine.reset();
      }
      renderOverlay(lastSample);
    });

    browserApi.runtime.onMessage.addListener(handleMessage);

    try {
      var snapshot = await browserApi.runtime.sendMessage({
        type: messages.CONTENT_READY,
        payload: {
          url: global.location.href,
          title: global.document.title,
          viewport: getViewportMetrics()
        }
      });
      syncSession(snapshot);
    } catch (error) {
      console.warn("Content script could not reach background script", error);
    }
  }

  initialize().catch(function (error) {
    console.error("Content script initialization failed", error);
  });
})(typeof globalThis !== "undefined" ? globalThis : this);
