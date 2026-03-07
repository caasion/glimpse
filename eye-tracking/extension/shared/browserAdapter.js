(function initBrowserAdapter(global) {
  "use strict";

  var namespace = global.EyeGazeCapture = global.EyeGazeCapture || {};
  var api = global.browser || global.chrome;

  if (!api) {
    throw new Error("WebExtensions browser API was not found.");
  }

  namespace.browser = api;
  namespace.getBrowser = function getBrowser() {
    return api;
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
