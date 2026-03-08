/**
 * iTrack gaze relay script - runs inside gaze-page.html (moz-extension:// page).
 *
 * Initialises EyeGesturesLite using the webcam, runs the built-in calibration
 * sequence, and forwards every gaze sample to the parent Instagram page via
 * postMessage so the content script can do hit-testing on product tiles.
 *
 * Mode messages (ITRACK_SET_MODE) from the content script control visibility:
 *   calibration - white background, cursor + calibration dots visible
 *   dev         - transparent background, gaze cursor visible
 *   normal      - transparent background, cursor hidden (tracking in background)
 */

// Holds the mode requested before gestures are ready (CDN scripts may still be loading)
var pendingMode = "normal";
var gesturesInstance = null;

function applyMode(mode) {
  // Update body background
  document.body.className = "mode-" + mode;

  if (!gesturesInstance) return;

  if (mode === "normal") {
    gesturesInstance.invisible();
  } else {
    gesturesInstance.visible();
  }
}

// Listen for mode changes sent by the content script (may arrive before or after load)
window.addEventListener("message", function (e) {
  if (e.data && e.data.type === "ITRACK_SET_MODE") {
    pendingMode = e.data.mode;
    applyMode(pendingMode);
  }
});

/* Wait until all CDN scripts have loaded before initialising */
window.addEventListener("load", function () {
  if (typeof EyeGestures === "undefined") {
    console.error("[iTrack] EyeGesturesLite failed to load.");
    return;
  }

  /**
   * Called on every processed frame.
   * @param {[number, number]} point  - [x, y] gaze position in viewport pixels
   * @param {boolean} calibration     - true while calibration is in progress
   */
  function onGaze(point, calibration) {
    window.parent.postMessage(
      {
        type: "ITRACK_GAZE",
        x: point[0],
        y: point[1],
        // EyeGesturesLite passes `true` while calibration is ONGOING.
        // We invert the flag so the content script receives `calibrated: true`
        // only when calibration is finished.
        calibrated: !calibration,
      },
      "*"
    );
  }

  gesturesInstance = new EyeGestures("video", onGaze);

  // Apply whatever mode was set (or defaulted) before we were ready
  applyMode(pendingMode);

  gesturesInstance.start();
});
