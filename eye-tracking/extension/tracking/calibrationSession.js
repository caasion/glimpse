(function initCalibrationSession(global) {
  "use strict";

  var namespace = global.EyeGazeCapture = global.EyeGazeCapture || {};

  function buildCalibrationPayload(settings) {
    return {
      mode: settings.calibrationMode,
      camera_index: settings.cameraIndex,
      model_name: settings.modelName,
      model_file: settings.modelFile || null,
      dense: {
        rows: settings.denseRows,
        cols: settings.denseCols,
        margin_ratio: settings.denseMargin
      }
    };
  }

  function buildTrackingPayload(settings) {
    return {
      camera_index: settings.cameraIndex,
      model_name: settings.modelName,
      model_file: settings.modelFile || null,
      filter_mode: settings.filterMode,
      ema_alpha: settings.emaAlpha,
      kde_confidence: settings.kdeConfidence,
      kalman_tune_enabled: settings.kalmanTuneEnabled
    };
  }

  function hasTrackingConfigChanged(previous, next) {
    var keys = [
      "cameraIndex",
      "modelName",
      "modelFile",
      "filterMode",
      "emaAlpha",
      "kdeConfidence",
      "bridgeUrl",
      "kalmanTuneEnabled"
    ];

    return keys.some(function (key) {
      return previous[key] !== next[key];
    });
  }

  namespace.tracking = namespace.tracking || {};
  namespace.tracking.buildCalibrationPayload = buildCalibrationPayload;
  namespace.tracking.buildTrackingPayload = buildTrackingPayload;
  namespace.tracking.hasTrackingConfigChanged = hasTrackingConfigChanged;
})(typeof globalThis !== "undefined" ? globalThis : this);
