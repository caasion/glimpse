/**
 * iTrack gaze relay script – runs inside gaze-page.html (moz-extension:// page).
 *
 * Initialises EyeGesturesLite using the webcam, runs the built-in calibration
 * sequence, and forwards every gaze sample to the parent Instagram page via
 * postMessage so the content script can do hit-testing on product tiles.
 */

/* Wait until all CDN scripts have loaded before initialising */
window.addEventListener("load", function () {
  if (typeof EyeGestures === "undefined") {
    console.error("[iTrack] EyeGesturesLite failed to load.");
    return;
  }

  /**
   * Called on every processed frame.
   * @param {[number, number]} point  – [x, y] gaze position in viewport pixels
   * @param {boolean} calibration     – true while calibration is in progress
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

  const gestures = new EyeGestures("video", onGaze);
  gestures.start();
});
