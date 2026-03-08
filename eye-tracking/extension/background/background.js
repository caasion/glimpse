(function startBackground(global) {
  "use strict";

  var namespace = global.EyeGazeCapture = global.EyeGazeCapture || {};
  var browserApi = namespace.browser;
  var messages = namespace.messages.MESSAGE_TYPES;
  var bridgeEvents = namespace.messages.BRIDGE_EVENT_TYPES;
  var config = namespace.config;
  var storage = namespace.storage;
  var tracking = namespace.tracking;
  var capturePipeline = namespace.background.capturePipeline;

  var state = {
    settings: storage.clone(config.DEFAULT_SETTINGS),
    calibration: storage.clone(config.DEFAULT_CALIBRATION_STATE),
    bridgeStatus: config.BRIDGE_STATUSES.DISCONNECTED,
    trackingActive: false,
    lastError: null,
    activeTabId: null,
    activeWindowId: null,
    pageContexts: {},
    screenWidth: 1920,
    screenHeight: 1200,
    customCalibrationTargets: null,
    customCalibrationIndex: 0
  };

  var bridge = null;

  function getSnapshot() {
    return {
      settings: storage.clone(state.settings),
      calibration: storage.clone(state.calibration),
      bridgeStatus: state.bridgeStatus,
      trackingActive: state.trackingActive,
      lastError: state.lastError,
      screenWidth: state.screenWidth,
      screenHeight: state.screenHeight
    };
  }

  async function sendRuntimeMessage(message) {
    try {
      await browserApi.runtime.sendMessage(message);
    } catch (error) {
      if (error && error.message && error.message.indexOf("Receiving end does not exist") >= 0) {
        return;
      }
      console.debug("runtime.sendMessage skipped", error);
    }
  }

  async function sendToTab(tabId, message) {
    if (!tabId) {
      return;
    }

    try {
      await browserApi.tabs.sendMessage(tabId, message);
    } catch (error) {
      console.debug("tabs.sendMessage skipped", tabId, error);
    }
  }

  async function broadcastSessionState() {
    var snapshot = getSnapshot();
    await sendRuntimeMessage({
      type: messages.SESSION_STATE_UPDATED,
      payload: snapshot
    });
    await sendToTab(state.activeTabId, {
      type: messages.SESSION_STATE_UPDATED,
      payload: snapshot
    });
  }

  async function refreshActiveTab() {
    var tabs = await browserApi.tabs.query({
      active: true,
      lastFocusedWindow: true
    });
    if (tabs && tabs.length > 0) {
      state.activeTabId = tabs[0].id;
      state.activeWindowId = tabs[0].windowId;
    }
  }

  async function ensureBridgeConnected() {
    if (!bridge) {
      return false;
    }

    bridge.setUrl(state.settings.bridgeUrl);

    try {
      await bridge.connect(state.settings.bridgeUrl);
      return true;
    } catch (error) {
      state.lastError = error.message;
      state.bridgeStatus = config.BRIDGE_STATUSES.ERROR;
      await broadcastSessionState();
      return false;
    }
  }

  async function stopTracking() {
    if (!bridge) {
      return;
    }

    try {
      await bridge.stopTracking();
    } catch (error) {
      console.debug("stopTracking bridge call failed", error);
    }

    state.trackingActive = false;
    await broadcastSessionState();
  }

  async function maybeStartTracking(forceRestart) {
    if (!state.settings.trackingEnabled) {
      await stopTracking();
      return {
        ok: true,
        reason: "tracking-disabled"
      };
    }

    if (state.calibration.status !== config.CALIBRATION_STATUSES.READY) {
      state.lastError = "Calibration is required before live tracking.";
      await broadcastSessionState();
      return {
        ok: false,
        reason: "calibration-required"
      };
    }

    if (!await ensureBridgeConnected()) {
      return {
        ok: false,
        reason: "bridge-unavailable"
      };
    }

    if (forceRestart) {
      try {
        await bridge.stopTracking();
      } catch (error) {
        console.debug("bridge stopTracking during restart failed", error);
      }
    }

    try {
      await bridge.startTracking(tracking.buildTrackingPayload(state.settings));
      state.lastError = null;
      return {
        ok: true
      };
    } catch (error) {
      state.lastError = error.message;
      await broadcastSessionState();
      return {
        ok: false,
        reason: "bridge-start-failed"
      };
    }
  }

  async function reconnectBridge() {
    if (!bridge) {
      return getSnapshot();
    }

    bridge.disconnect();
    state.bridgeStatus = config.BRIDGE_STATUSES.DISCONNECTED;
    await broadcastSessionState();

    if (!await ensureBridgeConnected()) {
      return getSnapshot();
    }

    try {
      await bridge.requestStatus();
    } catch (error) {
      console.debug("bridge status request failed", error);
    }

    if (state.settings.trackingEnabled && state.calibration.status === config.CALIBRATION_STATUSES.READY) {
      await maybeStartTracking(true);
    }

    return getSnapshot();
  }

  async function handleSettingsUpdate(partialSettings) {
    var previousSettings = storage.clone(state.settings);
    state.settings = await storage.saveSettings(Object.assign({}, state.settings, partialSettings || {}));
    state.lastError = null;

    if (previousSettings.bridgeUrl !== state.settings.bridgeUrl && bridge) {
      bridge.disconnect();
      state.bridgeStatus = config.BRIDGE_STATUSES.DISCONNECTED;
    }

    if (!state.settings.trackingEnabled) {
      await stopTracking();
    } else if (tracking.hasTrackingConfigChanged(previousSettings, state.settings) || !state.trackingActive) {
      await maybeStartTracking(true);
    }

    await broadcastSessionState();
    return getSnapshot();
  }

  function buildCustomCalibrationTargets() {
    var w = state.screenWidth;
    var h = state.screenHeight;
    var m = 0.15;
    return [
      { x: Math.round(w / 2), y: Math.round(h / 2) },
      { x: Math.round(w * m), y: Math.round(h * m) },
      { x: Math.round(w * (1 - m)), y: Math.round(h * m) },
      { x: Math.round(w * m), y: Math.round(h * (1 - m)) },
      { x: Math.round(w * (1 - m)), y: Math.round(h * (1 - m)) },
      { x: Math.round(w / 2), y: Math.round(h * m) },
      { x: Math.round(w / 2), y: Math.round(h * (1 - m)) },
      { x: Math.round(w * m), y: Math.round(h / 2) },
      { x: Math.round(w * (1 - m)), y: Math.round(h / 2) }
    ];
  }

  async function handleCustomCalibrationRequest() {
    if (!await ensureBridgeConnected()) {
      return { ok: false, snapshot: getSnapshot() };
    }

    state.customCalibrationTargets = buildCustomCalibrationTargets();
    state.customCalibrationIndex = 0;

    state.calibration = await storage.saveCalibrationState({
      status: config.CALIBRATION_STATUSES.RUNNING,
      mode: "custom",
      lastCompletedAt: state.calibration.lastCompletedAt,
      modelFile: state.calibration.modelFile,
      sampleCount: null
    });
    await stopTracking();
    await broadcastSessionState();

    try {
      var first = state.customCalibrationTargets[0];
      await bridge.startCollectTarget({
        target_x: first.x,
        target_y: first.y,
        duration_ms: 2000,
        camera_index: state.settings.cameraIndex
      });
      return { ok: true, snapshot: getSnapshot() };
    } catch (error) {
      state.customCalibrationTargets = null;
      state.lastError = error.message;
      state.calibration = await storage.saveCalibrationState({
        status: config.CALIBRATION_STATUSES.ERROR,
        mode: "custom",
        lastCompletedAt: state.calibration.lastCompletedAt,
        modelFile: state.calibration.modelFile,
        sampleCount: null
      });
      await broadcastSessionState();
      return { ok: false, snapshot: getSnapshot() };
    }
  }

  async function handleCalibrationRequest() {
    if (!await ensureBridgeConnected()) {
      return {
        ok: false,
        snapshot: getSnapshot()
      };
    }

    state.calibration = await storage.saveCalibrationState({
      status: config.CALIBRATION_STATUSES.RUNNING,
      mode: state.settings.calibrationMode,
      lastCompletedAt: state.calibration.lastCompletedAt,
      modelFile: state.calibration.modelFile,
      sampleCount: state.calibration.sampleCount
    });

    await stopTracking();
    await broadcastSessionState();

    try {
      await bridge.startCalibration(tracking.buildCalibrationPayload(state.settings));
      return {
        ok: true,
        snapshot: getSnapshot()
      };
    } catch (error) {
      state.calibration = await storage.saveCalibrationState({
        status: config.CALIBRATION_STATUSES.ERROR,
        mode: state.settings.calibrationMode,
        lastCompletedAt: state.calibration.lastCompletedAt,
        modelFile: state.calibration.modelFile,
        sampleCount: state.calibration.sampleCount
      });
      state.lastError = error.message;
      await broadcastSessionState();
      return {
        ok: false,
        snapshot: getSnapshot()
      };
    }
  }

  async function handleBridgeStatusChange(status, detail) {
    state.bridgeStatus = status;
    if (status === config.BRIDGE_STATUSES.CONNECTED) {
      state.lastError = null;
      try {
        await bridge.requestStatus();
      } catch (error) {
        console.debug("bridge requestStatus failed", error);
      }
      if (state.settings.trackingEnabled && state.calibration.status === config.CALIBRATION_STATUSES.READY) {
        await maybeStartTracking(false);
      }
    } else if (status === config.BRIDGE_STATUSES.ERROR && detail) {
      state.lastError = detail;
    }

    await broadcastSessionState();
  }

  async function applyBridgeStatusPayload(payload) {
    if (!payload) {
      return;
    }

    if (typeof payload.screen_width === "number") {
      state.screenWidth = payload.screen_width;
    }
    if (typeof payload.screen_height === "number") {
      state.screenHeight = payload.screen_height;
    }

    if (payload.calibrated) {
      state.calibration = await storage.saveCalibrationState({
        status: config.CALIBRATION_STATUSES.READY,
        mode: payload.calibration_mode || state.calibration.mode || state.settings.calibrationMode,
        lastCompletedAt: payload.last_calibrated_at || state.calibration.lastCompletedAt,
        modelFile: payload.model_file || state.calibration.modelFile || state.settings.modelFile,
        sampleCount: payload.sample_count != null ? payload.sample_count : state.calibration.sampleCount
      });
    } else {
      state.calibration = await storage.saveCalibrationState({
        status: config.CALIBRATION_STATUSES.REQUIRED,
        mode: payload.calibration_mode || state.calibration.mode || state.settings.calibrationMode,
        lastCompletedAt: null,
        modelFile: "",
        sampleCount: null
      });
    }

    if (payload.model_file && !state.settings.modelFile) {
      state.settings = await storage.saveSettings(Object.assign({}, state.settings, {
        modelFile: payload.model_file
      }));
    } else if (!payload.model_file && state.settings.modelFile) {
      state.settings = await storage.saveSettings(Object.assign({}, state.settings, {
        modelFile: ""
      }));
    }

    if (typeof payload.tracking === "boolean") {
      state.trackingActive = payload.tracking;
    }
  }

  async function handleBridgeEvent(message) {
    if (!message || !message.type) {
      return;
    }

    switch (message.type) {
      case bridgeEvents.BRIDGE_READY:
      case bridgeEvents.STATUS:
        await applyBridgeStatusPayload(message.payload);
        break;
      case bridgeEvents.CALIBRATION_STARTED:
        state.calibration = await storage.saveCalibrationState({
          status: config.CALIBRATION_STATUSES.RUNNING,
          mode: message.payload && message.payload.mode || state.settings.calibrationMode,
          lastCompletedAt: state.calibration.lastCompletedAt,
          modelFile: state.calibration.modelFile,
          sampleCount: null
        });
        break;
      case bridgeEvents.CALIBRATION_COMPLETED:
        state.customCalibrationTargets = null;
        state.customCalibrationIndex = 0;
        state.calibration = await storage.saveCalibrationState({
          status: config.CALIBRATION_STATUSES.READY,
          mode: message.payload && message.payload.mode || state.settings.calibrationMode,
          lastCompletedAt: message.payload && message.payload.completed_at || new Date().toISOString(),
          modelFile: message.payload && message.payload.model_file || state.settings.modelFile,
          sampleCount: message.payload && message.payload.sample_count != null ? message.payload.sample_count : null,
          validationMeanErrorPx: message.payload && message.payload.validation_mean_error_px != null ? message.payload.validation_mean_error_px : null,
          validationReady: message.payload && message.payload.validation_ready != null ? message.payload.validation_ready : true
        });
        if (message.payload && message.payload.model_file) {
          state.settings = await storage.saveSettings(Object.assign({}, state.settings, {
            modelFile: message.payload.model_file
          }));
        }
        if (state.settings.trackingEnabled) {
          await maybeStartTracking(true);
        }
        break;
      case bridgeEvents.TRACKING_STARTED:
        state.trackingActive = true;
        state.lastError = null;
        break;
      case bridgeEvents.TRACKING_STOPPED:
        state.trackingActive = false;
        break;
      case bridgeEvents.GAZE_SAMPLE:
        await sendToTab(state.activeTabId, {
          type: messages.GAZE_SAMPLE,
          payload: message.payload
        });
        return;
      case bridgeEvents.COLLECT_TARGET_DONE:
        if (message.payload && message.payload.success && state.customCalibrationTargets && state.customCalibrationIndex < state.customCalibrationTargets.length) {
          state.customCalibrationIndex += 1;
          if (state.customCalibrationIndex < state.customCalibrationTargets.length) {
            var next = state.customCalibrationTargets[state.customCalibrationIndex];
            await bridge.startCollectTarget({
              target_x: next.x,
              target_y: next.y,
              duration_ms: 2000,
              camera_index: state.settings.cameraIndex
            });
          } else {
            await bridge.fitCalibrationModel({
              model_file: state.settings.modelFile || null
            });
            state.customCalibrationTargets = null;
            state.customCalibrationIndex = 0;
          }
        }
        break;
      case bridgeEvents.ERROR:
        state.lastError = message.payload && message.payload.message || "EyeTrax bridge error.";
        if (message.payload && message.payload.scope === "calibration") {
          state.calibration = await storage.saveCalibrationState(Object.assign({}, state.calibration, {
            status: config.CALIBRATION_STATUSES.ERROR
          }));
        }
        if (message.payload && message.payload.scope === "tracking") {
          state.trackingActive = false;
        }
        break;
      default:
        break;
    }

    await broadcastSessionState();
  }

  async function handleDwellTrigger(payload, sender) {
    if (!sender.tab) {
      return {
        ok: false,
        error: "No tab context was available for capture."
      };
    }

    try {
      var result = await capturePipeline.captureAndSave({
        timestamp: payload.timestamp,
        pageUrl: payload.pageUrl || sender.tab.url,
        pageTitle: payload.pageTitle || sender.tab.title || "",
        roi: payload.roi,
        dwellDurationMs: payload.dwellDurationMs,
        filterMode: payload.filterMode,
        overlayEnabled: payload.overlayEnabled,
        trackingEnabled: payload.trackingEnabled,
        viewport: payload.viewport
      }, state.settings, {
        windowId: sender.tab.windowId,
        tabId: sender.tab.id
      });

      await sendToTab(sender.tab.id, {
        type: messages.CAPTURE_COMPLETED,
        payload: result
      });

      return {
        ok: true,
        result: result
      };
    } catch (error) {
      await sendToTab(sender.tab.id, {
        type: messages.CAPTURE_FAILED,
        payload: {
          message: error.message
        }
      });
      return {
        ok: false,
        error: error.message
      };
    }
  }

  function handleRuntimeMessage(message, sender) {
    if (!message || !message.type) {
      return undefined;
    }

    switch (message.type) {
      case messages.GET_SESSION_STATE:
        return Promise.resolve(getSnapshot());
      case messages.UPDATE_SETTINGS:
        return handleSettingsUpdate(message.payload);
      case messages.START_CALIBRATION:
        return handleCalibrationRequest();
      case messages.START_CUSTOM_CALIBRATION:
        return handleCustomCalibrationRequest();
      case messages.RECONNECT_BRIDGE:
        return reconnectBridge();
      case messages.CONTENT_READY:
        if (sender.tab && sender.tab.id) {
          state.pageContexts[sender.tab.id] = message.payload || {};
          state.activeTabId = sender.tab.id;
          state.activeWindowId = sender.tab.windowId;
        }
        return Promise.resolve(getSnapshot());
      case messages.DWELL_TRIGGER:
        return handleDwellTrigger(message.payload || {}, sender);
      default:
        return undefined;
    }
  }

  function registerListeners() {
    browserApi.runtime.onMessage.addListener(handleRuntimeMessage);

    if (browserApi.commands && typeof browserApi.commands.onCommand !== "undefined") {
      browserApi.commands.onCommand.addListener(function (command) {
        if (command === "recalibrate") {
          handleCalibrationRequest().catch(function (err) {
            console.warn("Recalibrate shortcut failed", err);
          });
        }
      });
    }

    browserApi.tabs.onActivated.addListener(function (activeInfo) {
      state.activeTabId = activeInfo.tabId;
      state.activeWindowId = activeInfo.windowId;
      broadcastSessionState().catch(function (error) {
        console.debug("broadcastSessionState failed after tab activation", error);
      });
    });

    browserApi.tabs.onRemoved.addListener(function (tabId) {
      delete state.pageContexts[tabId];
      if (state.activeTabId === tabId) {
        state.activeTabId = null;
      }
    });

    browserApi.windows.onFocusChanged.addListener(function () {
      refreshActiveTab().then(broadcastSessionState).catch(function (error) {
        console.debug("Failed to refresh active tab after focus change", error);
      });
    });
  }

  async function initialize() {
    state.settings = await storage.loadSettings();
    state.calibration = await storage.loadCalibrationState();
    await refreshActiveTab();

    bridge = new tracking.EyeTraxBridge({
      url: state.settings.bridgeUrl,
      autoReconnect: state.settings.autoReconnectBridge,
      onMessage: function (message) {
        handleBridgeEvent(message).catch(function (error) {
          console.error("handleBridgeEvent failed", error);
        });
      },
      onStatusChange: function (status, detail) {
        handleBridgeStatusChange(status, detail).catch(function (error) {
          console.error("handleBridgeStatusChange failed", error);
        });
      }
    });

    registerListeners();

    if (await ensureBridgeConnected()) {
      try {
        await bridge.requestStatus();
      } catch (error) {
        console.debug("initial bridge.requestStatus failed", error);
      }
    }

    if (state.settings.trackingEnabled && state.calibration.status === config.CALIBRATION_STATUSES.READY) {
      await maybeStartTracking(false);
    }

    await broadcastSessionState();
  }

  initialize().catch(function (error) {
    state.lastError = error.message;
    console.error("Background initialization failed", error);
  });
})(typeof globalThis !== "undefined" ? globalThis : this);
