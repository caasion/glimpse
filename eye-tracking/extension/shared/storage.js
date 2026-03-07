(function initStorage(global) {
  "use strict";

  var namespace = global.EyeGazeCapture = global.EyeGazeCapture || {};
  var browserApi = namespace.browser;
  var config = namespace.config;

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function clampNumber(value, min, max, fallback) {
    var numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      return fallback;
    }
    return Math.min(max, Math.max(min, numeric));
  }

  function normalizeSettings(settings) {
    var source = Object.assign({}, config.DEFAULT_SETTINGS, settings || {});
    var filterMode = config.FILTER_MODES.indexOf(source.filterMode) >= 0
      ? source.filterMode
      : config.DEFAULT_SETTINGS.filterMode;
    var calibrationMode = config.CALIBRATION_MODES.indexOf(source.calibrationMode) >= 0
      ? source.calibrationMode
      : config.DEFAULT_SETTINGS.calibrationMode;

    return {
      trackingEnabled: Boolean(source.trackingEnabled),
      overlayEnabled: Boolean(source.overlayEnabled),
      debugEnabled: Boolean(source.debugEnabled),
      saveFullScreenshot: Boolean(source.saveFullScreenshot),
      saveMetadata: Boolean(source.saveMetadata),
      dwellThresholdMs: Math.round(clampNumber(source.dwellThresholdMs, 250, 10000, config.DEFAULT_SETTINGS.dwellThresholdMs)),
      cooldownMs: Math.round(clampNumber(source.cooldownMs, 250, 30000, config.DEFAULT_SETTINGS.cooldownMs)),
      filterMode: filterMode,
      calibrationMode: calibrationMode,
      emaAlpha: clampNumber(source.emaAlpha, 0, 1, config.DEFAULT_SETTINGS.emaAlpha),
      kdeConfidence: clampNumber(source.kdeConfidence, 0.05, 0.99, config.DEFAULT_SETTINGS.kdeConfidence),
      minimumConfidence: clampNumber(source.minimumConfidence, 0, 1, config.DEFAULT_SETTINGS.minimumConfidence),
      denseRows: Math.round(clampNumber(source.denseRows, 2, 12, config.DEFAULT_SETTINGS.denseRows)),
      denseCols: Math.round(clampNumber(source.denseCols, 2, 12, config.DEFAULT_SETTINGS.denseCols)),
      denseMargin: clampNumber(source.denseMargin, 0.02, 0.25, config.DEFAULT_SETTINGS.denseMargin),
      cameraIndex: Math.round(clampNumber(source.cameraIndex, 0, 10, config.DEFAULT_SETTINGS.cameraIndex)),
      modelName: String(source.modelName || config.DEFAULT_SETTINGS.modelName),
      modelFile: String(source.modelFile || ""),
      bridgeUrl: String(source.bridgeUrl || config.DEFAULT_SETTINGS.bridgeUrl),
      autoReconnectBridge: Boolean(source.autoReconnectBridge),
      kalmanTuneEnabled: Boolean(source.kalmanTuneEnabled)
    };
  }

  async function loadSettings() {
    var stored = await browserApi.storage.local.get(config.STORAGE_KEYS.SETTINGS);
    return normalizeSettings(stored[config.STORAGE_KEYS.SETTINGS]);
  }

  async function saveSettings(settings) {
    var normalized = normalizeSettings(settings);
    await browserApi.storage.local.set((function () {
      var payload = {};
      payload[config.STORAGE_KEYS.SETTINGS] = normalized;
      return payload;
    })());
    return normalized;
  }

  async function loadCalibrationState() {
    var stored = await browserApi.storage.local.get(config.STORAGE_KEYS.CALIBRATION);
    return Object.assign({}, config.DEFAULT_CALIBRATION_STATE, stored[config.STORAGE_KEYS.CALIBRATION] || {});
  }

  async function saveCalibrationState(state) {
    var normalized = Object.assign({}, config.DEFAULT_CALIBRATION_STATE, state || {});
    await browserApi.storage.local.set((function () {
      var payload = {};
      payload[config.STORAGE_KEYS.CALIBRATION] = normalized;
      return payload;
    })());
    return normalized;
  }

  namespace.storage = {
    clone: clone,
    normalizeSettings: normalizeSettings,
    loadSettings: loadSettings,
    saveSettings: saveSettings,
    loadCalibrationState: loadCalibrationState,
    saveCalibrationState: saveCalibrationState
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
