(function initDwellEngine(global) {
  "use strict";

  var namespace = global.EyeGazeCapture = global.EyeGazeCapture || {};
  var config = namespace.config;

  function clampBoxAroundPoint(point, size) {
    var half = size / 2;
    return {
      x: Math.round(point.x - half),
      y: Math.round(point.y - half),
      width: size,
      height: size
    };
  }

  function pointInBounds(point, bounds) {
    return Boolean(
      point &&
      bounds &&
      point.x >= bounds.x &&
      point.x <= bounds.x + bounds.width &&
      point.y >= bounds.y &&
      point.y <= bounds.y + bounds.height
    );
  }

  function DwellEngine(options) {
    options = options || {};
    this.dwellThresholdMs = options.dwellThresholdMs || config.DEFAULT_SETTINGS.dwellThresholdMs;
    this.cooldownMs = options.cooldownMs || config.DEFAULT_SETTINGS.cooldownMs;
    this.minimumConfidence = options.minimumConfidence || config.DEFAULT_SETTINGS.minimumConfidence;
    this.anchorBoxSize = options.anchorBoxSize || config.ANCHOR_BOX_SIZE;
    this.reset();
  }

  DwellEngine.prototype.reset = function reset() {
    this.state = config.DWELL_STATES.IDLE;
    this.anchorBounds = null;
    this.anchorStartedAt = null;
    this.progress = 0;
    this.cooldownUntil = 0;
  };

  DwellEngine.prototype.updateConfig = function updateConfig(dwellThresholdMs, cooldownMs, minimumConfidence) {
    this.dwellThresholdMs = dwellThresholdMs;
    this.cooldownMs = cooldownMs;
    this.minimumConfidence = minimumConfidence;
  };

  DwellEngine.prototype.getSnapshot = function getSnapshot() {
    return {
      state: this.state,
      progress: this.progress,
      cooldownUntil: this.cooldownUntil,
      anchorBounds: this.anchorBounds
    };
  };

  DwellEngine.prototype._anchorOnPoint = function anchorOnPoint(point, now) {
    this.anchorBounds = clampBoxAroundPoint(point, this.anchorBoxSize);
    this.anchorStartedAt = now;
    this.progress = 0;
    this.state = config.DWELL_STATES.TRACKING;
  };

  DwellEngine.prototype.update = function update(sample) {
    var now = Number(sample.timestamp == null ? Date.now() : sample.timestamp);
    var confidence = sample.confidence == null ? 1 : Number(sample.confidence);
    var valid = Boolean(sample.valid) && confidence >= this.minimumConfidence && sample.point;
    var dwellDuration;

    if (!valid) {
      this.state = config.DWELL_STATES.IDLE;
      this.anchorBounds = null;
      this.anchorStartedAt = null;
      this.progress = 0;
      return {
        triggered: false,
        state: this.state,
        progress: this.progress,
        anchorBounds: null
      };
    }

    if (this.cooldownUntil > now) {
      this.state = config.DWELL_STATES.COOLDOWN;
      this.progress = 1;
      return {
        triggered: false,
        state: this.state,
        progress: this.progress,
        anchorBounds: this.anchorBounds
      };
    }

    if (!this.anchorBounds || this.anchorStartedAt == null || !pointInBounds(sample.point, this.anchorBounds)) {
      this._anchorOnPoint(sample.point, now);
      return {
        triggered: false,
        state: this.state,
        progress: this.progress,
        anchorBounds: this.anchorBounds
      };
    }

    dwellDuration = now - this.anchorStartedAt;
    this.progress = Math.max(0, Math.min(1, dwellDuration / this.dwellThresholdMs));
    this.state = config.DWELL_STATES.TRACKING;

    if (dwellDuration >= this.dwellThresholdMs) {
      this.state = config.DWELL_STATES.TRIGGERED;
      this.cooldownUntil = now + this.cooldownMs;
      this.anchorStartedAt = null;

      return {
        triggered: true,
        state: this.state,
        progress: 1,
        dwellDurationMs: dwellDuration,
        anchorBounds: this.anchorBounds,
        roi: {
          id: config.DYNAMIC_CAPTURE_ID,
          label: "Gaze Anchor",
          bounds: {
            x: this.anchorBounds.x,
            y: this.anchorBounds.y,
            width: this.anchorBounds.width,
            height: this.anchorBounds.height
          }
        }
      };
    }

    return {
      triggered: false,
      state: this.state,
      progress: this.progress,
      anchorBounds: this.anchorBounds
    };
  };

  namespace.content = namespace.content || {};
  namespace.content.DwellEngine = DwellEngine;
})(typeof globalThis !== "undefined" ? globalThis : this);
