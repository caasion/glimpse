(function startPopup(global) {
  "use strict";

  var namespace = global.EyeGazeCapture = global.EyeGazeCapture || {};
  var browserApi = namespace.browser;
  var messages = namespace.messages.MESSAGE_TYPES;

  var elements = {};
  var isApplyingState = false;

  function $(id) {
    return global.document.getElementById(id);
  }

  function readElements() {
    elements = {
      heroStatus: $("heroStatus"),
      trackingEnabled: $("trackingEnabled"),
      overlayEnabled: $("overlayEnabled"),
      filterMode: $("filterMode"),
      calibrationMode: $("calibrationMode"),
      cooldownMs: $("cooldownMs"),
      emaAlpha: $("emaAlpha"),
      kdeConfidence: $("kdeConfidence"),
      cameraIndex: $("cameraIndex"),
      debugEnabled: $("debugEnabled"),
      saveFullScreenshot: $("saveFullScreenshot"),
      saveMetadata: $("saveMetadata"),
      recalibrateButton: $("recalibrateButton"),
      reconnectButton: $("reconnectButton"),
      companionStatus: $("companionStatus"),
      calibrationStatus: $("calibrationStatus"),
      trackingStatus: $("trackingStatus"),
      errorText: $("errorText")
    };
  }

  function capitalize(value) {
    return String(value || "")
      .replace(/_/g, " ")
      .replace(/\b\w/g, function (match) {
        return match.toUpperCase();
      });
  }

  function applySnapshot(snapshot) {
    var settings = snapshot.settings || {};
    var calibration = snapshot.calibration || {};

    isApplyingState = true;
    elements.trackingEnabled.checked = Boolean(settings.trackingEnabled);
    elements.overlayEnabled.checked = Boolean(settings.overlayEnabled);
    elements.filterMode.value = settings.filterMode || "kalman_ema";
    elements.calibrationMode.value = settings.calibrationMode || "9p";
    elements.cooldownMs.value = settings.cooldownMs;
    elements.emaAlpha.value = settings.emaAlpha;
    elements.kdeConfidence.value = settings.kdeConfidence;
    elements.cameraIndex.value = settings.cameraIndex;
    elements.debugEnabled.checked = Boolean(settings.debugEnabled);
    elements.saveFullScreenshot.checked = Boolean(settings.saveFullScreenshot);
    elements.saveMetadata.checked = Boolean(settings.saveMetadata);
    isApplyingState = false;

    elements.heroStatus.textContent = capitalize(snapshot.bridgeStatus || "disconnected");
    elements.companionStatus.textContent = capitalize(snapshot.bridgeStatus || "disconnected");
    elements.calibrationStatus.textContent = capitalize(calibration.status || "required");
    elements.trackingStatus.textContent = snapshot.trackingActive ? "Running" : "Stopped";
    elements.errorText.textContent = snapshot.lastError || "None";

    elements.emaAlpha.disabled = elements.filterMode.value !== "kalman_ema";
    elements.kdeConfidence.disabled = elements.filterMode.value !== "kde";
    elements.recalibrateButton.disabled = calibration.status === "running";
  }

  async function sendMessage(message) {
    return browserApi.runtime.sendMessage(message);
  }

  async function refreshState() {
    try {
      applySnapshot(await sendMessage({
        type: messages.GET_SESSION_STATE
      }));
    } catch (error) {
      elements.errorText.textContent = error.message;
    }
  }

  function buildSettingsPatch(controlId) {
    switch (controlId) {
      case "trackingEnabled":
      case "overlayEnabled":
      case "debugEnabled":
      case "saveFullScreenshot":
      case "saveMetadata":
        return (function () {
          var patch = {};
          patch[controlId] = elements[controlId].checked;
          return patch;
        })();
      case "filterMode":
      case "calibrationMode":
        return (function () {
          var patch = {};
          patch[controlId] = elements[controlId].value;
          return patch;
        })();
      case "cooldownMs":
      case "cameraIndex":
      case "emaAlpha":
      case "kdeConfidence":
        return (function () {
          var patch = {};
          patch[controlId] = Number(elements[controlId].value);
          return patch;
        })();
      default:
        return null;
    }
  }

  function wireControl(controlId, eventName) {
    elements[controlId].addEventListener(eventName, async function () {
      if (isApplyingState) {
        return;
      }

      try {
        applySnapshot(await sendMessage({
          type: messages.UPDATE_SETTINGS,
          payload: buildSettingsPatch(controlId)
        }));
      } catch (error) {
        elements.errorText.textContent = error.message;
      }
    });
  }

  function registerEvents() {
    ["trackingEnabled", "overlayEnabled", "debugEnabled", "saveFullScreenshot", "saveMetadata"].forEach(function (controlId) {
      wireControl(controlId, "change");
    });

    ["filterMode", "calibrationMode"].forEach(function (controlId) {
      wireControl(controlId, "change");
    });

    ["cooldownMs", "emaAlpha", "kdeConfidence", "cameraIndex"].forEach(function (controlId) {
      wireControl(controlId, "change");
    });

    elements.recalibrateButton.addEventListener("click", async function () {
      try {
        var response = await sendMessage({
          type: messages.START_CALIBRATION
        });
        if (response && response.snapshot) {
          applySnapshot(response.snapshot);
        }
      } catch (error) {
        elements.errorText.textContent = error.message;
      }
    });

    elements.reconnectButton.addEventListener("click", async function () {
      try {
        applySnapshot(await sendMessage({
          type: messages.RECONNECT_BRIDGE
        }));
      } catch (error) {
        elements.errorText.textContent = error.message;
      }
    });

    browserApi.runtime.onMessage.addListener(function (message) {
      if (message && message.type === messages.SESSION_STATE_UPDATED) {
        applySnapshot(message.payload);
      }
      return undefined;
    });
  }

  global.document.addEventListener("DOMContentLoaded", function () {
    readElements();
    registerEvents();
    refreshState();
  });
})(typeof globalThis !== "undefined" ? globalThis : this);
