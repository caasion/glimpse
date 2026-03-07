(function initConfig(global) {
  "use strict";

  var namespace = global.EyeGazeCapture = global.EyeGazeCapture || {};

  namespace.config = {
    STORAGE_KEYS: {
      SETTINGS: "eyetraxPrototype.settings",
      CALIBRATION: "eyetraxPrototype.calibration"
    },
    BRIDGE_STATUSES: {
      DISCONNECTED: "disconnected",
      CONNECTING: "connecting",
      CONNECTED: "connected",
      ERROR: "error"
    },
    CALIBRATION_STATUSES: {
      REQUIRED: "required",
      RUNNING: "running",
      READY: "ready",
      ERROR: "error"
    },
    DWELL_STATES: {
      IDLE: "IDLE",
      TRACKING: "TRACKING",
      TRIGGERED: "TRIGGERED",
      COOLDOWN: "COOLDOWN"
    },
    FILTER_MODES: ["none", "kalman", "kalman_ema", "kde"],
    CALIBRATION_MODES: ["9p", "5p", "lissajous", "dense"],
    DEFAULT_SETTINGS: {
      trackingEnabled: false,
      overlayEnabled: true,
      debugEnabled: false,
      saveFullScreenshot: false,
      saveMetadata: true,
      dwellThresholdMs: 2000,
      cooldownMs: 3000,
      filterMode: "kalman_ema",
      calibrationMode: "9p",
      emaAlpha: 0.25,
      kdeConfidence: 0.5,
      minimumConfidence: 0.35,
      denseRows: 5,
      denseCols: 5,
      denseMargin: 0.1,
      cameraIndex: 0,
      modelName: "ridge",
      modelFile: "",
      bridgeUrl: "ws://127.0.0.1:8765",
      autoReconnectBridge: true,
      kalmanTuneEnabled: false
    },
    DEFAULT_CALIBRATION_STATE: {
      status: "required",
      mode: "9p",
      lastCompletedAt: null,
      modelFile: "",
      sampleCount: null
    },
    ANCHOR_BOX_SIZE: 200,
    POINTER_BOX_SIZE: 10,
    DYNAMIC_CAPTURE_ID: "gaze_anchor",
    OVERLAY_Z_INDEX: 2147483646,
    CAPTURE_PREFIX: "output",
    DOWNLOAD_DIR: "EyeTraxCaptures"
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
