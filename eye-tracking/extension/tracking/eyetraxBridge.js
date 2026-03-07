(function initEyeTraxBridge(global) {
  "use strict";

  var namespace = global.EyeGazeCapture = global.EyeGazeCapture || {};
  var config = namespace.config;
  var bridgeMessages = namespace.messages.BRIDGE_MESSAGE_TYPES;

  function noop() {}

  function EyeTraxBridge(options) {
    options = options || {};
    this.url = options.url || config.DEFAULT_SETTINGS.bridgeUrl;
    this.autoReconnect = options.autoReconnect !== false;
    this.socket = null;
    this.status = config.BRIDGE_STATUSES.DISCONNECTED;
    this.lastError = null;
    this.manualClose = false;
    this.reconnectTimer = null;
    this.messageHandlers = [];
    this.statusHandlers = [];

    if (typeof options.onMessage === "function") {
      this.messageHandlers.push(options.onMessage);
    }
    if (typeof options.onStatusChange === "function") {
      this.statusHandlers.push(options.onStatusChange);
    }
  }

  EyeTraxBridge.prototype.onMessage = function onMessage(handler) {
    var bridge = this;
    bridge.messageHandlers.push(handler);
    return function unsubscribe() {
      bridge.messageHandlers = bridge.messageHandlers.filter(function (item) {
        return item !== handler;
      });
    };
  };

  EyeTraxBridge.prototype.onStatusChange = function onStatusChange(handler) {
    var bridge = this;
    bridge.statusHandlers.push(handler);
    return function unsubscribe() {
      bridge.statusHandlers = bridge.statusHandlers.filter(function (item) {
        return item !== handler;
      });
    };
  };

  EyeTraxBridge.prototype.setUrl = function setUrl(url) {
    this.url = url || this.url;
  };

  EyeTraxBridge.prototype._emitStatus = function emitStatus(status, detail) {
    this.status = status;
    this.statusHandlers.forEach(function (handler) {
      try {
        handler(status, detail || null);
      } catch (error) {
        console.warn("EyeTraxBridge status handler failed", error);
      }
    });
  };

  EyeTraxBridge.prototype._emitMessage = function emitMessage(message) {
    this.messageHandlers.forEach(function (handler) {
      try {
        handler(message);
      } catch (error) {
        console.warn("EyeTraxBridge message handler failed", error);
      }
    });
  };

  EyeTraxBridge.prototype.connect = function connect(optionalUrl) {
    var bridge = this;

    if (optionalUrl) {
      bridge.url = optionalUrl;
    }

    if (bridge.reconnectTimer) {
      clearTimeout(bridge.reconnectTimer);
      bridge.reconnectTimer = null;
    }

    if (bridge.socket && bridge.socket.readyState === WebSocket.OPEN) {
      return Promise.resolve();
    }

    if (bridge.socket && bridge.socket.readyState === WebSocket.CONNECTING) {
      return Promise.resolve();
    }

    bridge.manualClose = false;

    return new Promise(function (resolve, reject) {
      var settled = false;
      var socket;

      try {
        socket = new WebSocket(bridge.url);
      } catch (error) {
        bridge.lastError = error.message;
        bridge._emitStatus(config.BRIDGE_STATUSES.ERROR, error.message);
        reject(error);
        return;
      }

      bridge.socket = socket;
      bridge._emitStatus(config.BRIDGE_STATUSES.CONNECTING);

      socket.onopen = function () {
        settled = true;
        bridge.lastError = null;
        bridge._emitStatus(config.BRIDGE_STATUSES.CONNECTED);
        bridge.send(bridgeMessages.HELLO, {
          client: "firefox-mv2-extension"
        }).catch(noop);
        resolve();
      };

      socket.onmessage = function (event) {
        var message;
        try {
          message = JSON.parse(event.data);
        } catch (error) {
          console.warn("EyeTraxBridge received invalid JSON", error);
          return;
        }
        bridge._emitMessage(message);
      };

      socket.onerror = function () {
        var error = new Error("Unable to connect to the local EyeTrax bridge.");
        bridge.lastError = error.message;
        bridge._emitStatus(config.BRIDGE_STATUSES.ERROR, error.message);
        if (!settled) {
          settled = true;
          reject(error);
        }
      };

      socket.onclose = function () {
        bridge.socket = null;
        bridge._emitStatus(config.BRIDGE_STATUSES.DISCONNECTED, bridge.lastError);
        if (!bridge.manualClose && bridge.autoReconnect) {
          bridge.reconnectTimer = global.setTimeout(function () {
            bridge.connect().catch(noop);
          }, 1500);
        }
      };
    });
  };

  EyeTraxBridge.prototype.disconnect = function disconnect() {
    this.manualClose = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.socket) {
      this.socket.close(1000, "manual-close");
      this.socket = null;
    }
    this._emitStatus(config.BRIDGE_STATUSES.DISCONNECTED);
  };

  EyeTraxBridge.prototype.ensureConnected = async function ensureConnected() {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      return;
    }
    await this.connect();
  };

  EyeTraxBridge.prototype.send = async function send(type, payload) {
    await this.ensureConnected();
    this.socket.send(JSON.stringify({
      type: type,
      payload: payload || {}
    }));
  };

  EyeTraxBridge.prototype.requestStatus = function requestStatus() {
    return this.send(bridgeMessages.GET_STATUS);
  };

  EyeTraxBridge.prototype.startCalibration = function startCalibration(payload) {
    return this.send(bridgeMessages.START_CALIBRATION, payload);
  };

  EyeTraxBridge.prototype.startTracking = function startTracking(payload) {
    return this.send(bridgeMessages.START_TRACKING, payload);
  };

  EyeTraxBridge.prototype.stopTracking = function stopTracking() {
    return this.send(bridgeMessages.STOP_TRACKING);
  };

  EyeTraxBridge.prototype.loadModel = function loadModel(payload) {
    return this.send(bridgeMessages.LOAD_MODEL, payload);
  };

  namespace.tracking = namespace.tracking || {};
  namespace.tracking.EyeTraxBridge = EyeTraxBridge;
})(typeof globalThis !== "undefined" ? globalThis : this);
