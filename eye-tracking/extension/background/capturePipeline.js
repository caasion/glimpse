(function initCapturePipeline(global) {
  "use strict";

  var namespace = global.EyeGazeCapture = global.EyeGazeCapture || {};
  var browserApi = namespace.browser;
  var config = namespace.config;

  function sanitizeSegment(value) {
    return String(value || "item")
      .replace(/[^a-z0-9_-]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase() || "item";
  }

  function buildTimestampToken(timestampMs) {
    return new Date(timestampMs)
      .toISOString()
      .replace(/:/g, "-")
      .replace(/\./g, "-")
      .replace("T", "_");
  }

  function clampBounds(bounds, viewport) {
    var x = Math.max(0, Math.round(bounds.x));
    var y = Math.max(0, Math.round(bounds.y));
    var maxWidth = Math.max(1, viewport.width - x);
    var maxHeight = Math.max(1, viewport.height - y);
    return {
      x: x,
      y: y,
      width: Math.max(1, Math.min(Math.round(bounds.width), maxWidth)),
      height: Math.max(1, Math.min(Math.round(bounds.height), maxHeight))
    };
  }

  function loadImage(dataUrl) {
    return new Promise(function (resolve, reject) {
      var image = new Image();
      image.onload = function () {
        resolve(image);
      };
      image.onerror = reject;
      image.src = dataUrl;
    });
  }

  async function cropDataUrl(dataUrl, cssBounds, viewport) {
    var image = await loadImage(dataUrl);
    var scaleX = image.naturalWidth / Math.max(1, viewport.width);
    var scaleY = image.naturalHeight / Math.max(1, viewport.height);
    var safeBounds = clampBounds(cssBounds, viewport);
    var imageBounds = {
      x: Math.round(safeBounds.x * scaleX),
      y: Math.round(safeBounds.y * scaleY),
      width: Math.max(1, Math.round(safeBounds.width * scaleX)),
      height: Math.max(1, Math.round(safeBounds.height * scaleY))
    };
    var canvas = global.document.createElement("canvas");
    var context = canvas.getContext("2d");

    canvas.width = imageBounds.width;
    canvas.height = imageBounds.height;
    context.drawImage(
      image,
      imageBounds.x,
      imageBounds.y,
      imageBounds.width,
      imageBounds.height,
      0,
      0,
      imageBounds.width,
      imageBounds.height
    );

    return {
      dataUrl: canvas.toDataURL("image/png"),
      captureWidth: image.naturalWidth,
      captureHeight: image.naturalHeight,
      cssBounds: safeBounds,
      imageBounds: imageBounds,
      scaleX: scaleX,
      scaleY: scaleY
    };
  }

  async function downloadDataUrl(dataUrl, filename) {
    return browserApi.downloads.download({
      url: dataUrl,
      filename: filename,
      saveAs: false,
      conflictAction: "uniquify"
    });
  }

  async function downloadJson(data, filename) {
    var blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json"
    });
    var objectUrl = URL.createObjectURL(blob);

    try {
      return await browserApi.downloads.download({
        url: objectUrl,
        filename: filename,
        saveAs: false,
        conflictAction: "uniquify"
      });
    } finally {
      global.setTimeout(function () {
        URL.revokeObjectURL(objectUrl);
      }, 10000);
    }
  }

  async function captureAndSave(request, settings, tabContext) {
    var timestamp = Number(request.timestamp || Date.now());
    var token = buildTimestampToken(timestamp);
    var roiId = sanitizeSegment(request.roi.id);
    var baseName = config.CAPTURE_PREFIX + "_" + token + "_" + roiId;
    var directory = config.DOWNLOAD_DIR;
    var cropFilename = directory + "/" + baseName + "_crop.png";
    var fullFilename = directory + "/" + baseName + "_full.png";
    var metaFilename = directory + "/" + baseName + "_meta.json";
    var fullCapture = await browserApi.tabs.captureVisibleTab(tabContext.windowId, {
      format: "png"
    });
    var crop = await cropDataUrl(fullCapture, request.roi.bounds, request.viewport);

    await downloadDataUrl(crop.dataUrl, cropFilename);

    if (settings.saveFullScreenshot) {
      await downloadDataUrl(fullCapture, fullFilename);
    }

    var metadata = {
      timestamp: new Date(timestamp).toISOString(),
      pageUrl: request.pageUrl,
      pageTitle: request.pageTitle || "",
      roiId: request.roi.id,
      roiLabel: request.roi.label || "",
      roiBounds: crop.cssBounds,
      dwellDurationMs: request.dwellDurationMs,
      filterMode: request.filterMode,
      overlayEnabled: request.overlayEnabled,
      trackingEnabled: request.trackingEnabled,
      viewport: request.viewport,
      captureImageSize: {
        width: crop.captureWidth,
        height: crop.captureHeight
      },
      cropImageBounds: crop.imageBounds,
      captureScale: {
        x: crop.scaleX,
        y: crop.scaleY
      }
    };

    if (settings.saveMetadata) {
      await downloadJson(metadata, metaFilename);
    }

    return {
      baseName: baseName,
      cropFilename: cropFilename,
      fullFilename: settings.saveFullScreenshot ? fullFilename : null,
      metaFilename: settings.saveMetadata ? metaFilename : null,
      metadata: metadata
    };
  }

  namespace.background = namespace.background || {};
  namespace.background.capturePipeline = {
    captureAndSave: captureAndSave
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
