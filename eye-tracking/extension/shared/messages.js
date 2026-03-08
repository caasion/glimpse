(function initMessages(global) {
  "use strict";

  var namespace = global.EyeGazeCapture = global.EyeGazeCapture || {};

  namespace.messages = {
    MESSAGE_TYPES: {
      GET_SESSION_STATE: "GET_SESSION_STATE",
      SESSION_STATE_UPDATED: "SESSION_STATE_UPDATED",
      UPDATE_SETTINGS: "UPDATE_SETTINGS",
      START_CALIBRATION: "START_CALIBRATION",
      RECONNECT_BRIDGE: "RECONNECT_BRIDGE",
      CONTENT_READY: "CONTENT_READY",
      GAZE_SAMPLE: "GAZE_SAMPLE",
      DWELL_TRIGGER: "DWELL_TRIGGER",
      CAPTURE_COMPLETED: "CAPTURE_COMPLETED",
      CAPTURE_FAILED: "CAPTURE_FAILED",
      START_CUSTOM_CALIBRATION: "START_CUSTOM_CALIBRATION"
    },
    BRIDGE_MESSAGE_TYPES: {
      HELLO: "hello",
      GET_STATUS: "get_status",
      START_CALIBRATION: "start_calibration",
      START_TRACKING: "start_tracking",
      STOP_TRACKING: "stop_tracking",
      LOAD_MODEL: "load_model",
      SAVE_MODEL: "save_model",
      PING: "ping",
      START_COLLECT_TARGET: "start_collect_target",
      FIT_CALIBRATION_MODEL: "fit_calibration_model"
    },
    BRIDGE_EVENT_TYPES: {
      BRIDGE_READY: "bridge_ready",
      STATUS: "status",
      CALIBRATION_STARTED: "calibration_started",
      CALIBRATION_COMPLETED: "calibration_completed",
      TRACKING_STARTED: "tracking_started",
      TRACKING_STOPPED: "tracking_stopped",
      GAZE_SAMPLE: "gaze_sample",
      VALIDATION_TARGET: "validation_target",
      COLLECT_TARGET_DONE: "collect_target_done",
      ERROR: "error",
      PONG: "pong"
    }
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
