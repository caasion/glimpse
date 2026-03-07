(function initRoiManager(global) {
  "use strict";

  var namespace = global.EyeGazeCapture = global.EyeGazeCapture || {};
  var config = namespace.config;

  function RoiManager(definitions) {
    this.definitions = definitions || config.DEFAULT_ROIS;
  }

  RoiManager.prototype.resolve = function resolve(viewportWidth, viewportHeight) {
    return this.definitions.map(function (definition) {
      var x = Math.round(definition.xRatio * viewportWidth);
      var y = Math.round(definition.yRatio * viewportHeight);
      var width = Math.max(1, Math.round(definition.widthRatio * viewportWidth));
      var height = Math.max(1, Math.round(definition.heightRatio * viewportHeight));

      return {
        id: definition.id,
        label: definition.label,
        color: definition.color,
        bounds: {
          x: x,
          y: y,
          width: Math.min(width, viewportWidth - x),
          height: Math.min(height, viewportHeight - y)
        }
      };
    });
  };

  namespace.content = namespace.content || {};
  namespace.content.RoiManager = RoiManager;
})(typeof globalThis !== "undefined" ? globalThis : this);
