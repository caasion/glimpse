# EyeTrax Firefox Dwell Capture Prototype

Firefox Manifest V2 prototype for gaze-triggered screenshot capture, anchored to the [EyeTrax](https://github.com/ck-zhang/EyeTrax) Python repository as the tracking source of truth.

## Architecture Summary

### EyeTrax-first integration choice

This prototype uses the preferred local companion bridge architecture instead of trying to import the Python package directly into Firefox:

- `companion/` runs EyeTrax itself for webcam ingest, calibration, feature extraction, blink rejection, smoothing, and gaze prediction.
- `extension/` handles Firefox MV2 concerns: popup controls, in-page overlay, ROI hit testing, dwell timing, screenshot capture, crop, download, and metadata.

That preserves the EyeTrax workflow instead of replacing it with a different browser-only tracking design.

### Gaze pipeline

1. The local companion creates or reuses an EyeTrax `GazeEstimator`.
2. Calibration is required before tracking. Default mode is `9p`, with `5p`, `lissajous`, and `dense` also wired through.
3. During live tracking, the companion:
   - reads webcam frames
   - calls `extract_features(frame)`
   - rejects blink or invalid frames
   - predicts screen coordinates only for valid samples
   - smooths the output with `none`, `kalman`, `kalman_ema`, or `kde`
4. The companion streams absolute screen coordinates to the extension over `ws://127.0.0.1:8765`.
5. The content script converts screen coordinates into viewport coordinates using Firefox's `window.mozInnerScreenX` and `window.mozInnerScreenY`.

### Calibration workflow

- Default calibration mode: `9p`
- Other supported modes: `5p`, `lissajous`, `dense`
- Calibration is started from the popup
- The current prototype lets the EyeTrax companion own the actual calibration window, so calibration still follows EyeTrax's native flow closely
- Calibrated models are persisted to `companion/models/eyetrax_latest.pkl` by default

### Filtering choices

- Default: `kalman_ema`
- Supported in the bridge: `none`, `kalman`, `kalman_ema`, `kde`
- Popup controls expose filter selection, EMA alpha, cooldown, and camera index
- Kalman fine-tuning is scaffolded behind `kalman_tune_enabled`, but left off by default because it adds another native tuning pass

### Dwell logic

The content script uses a four-state dwell state machine:

- `IDLE`
- `TRACKING`
- `TRIGGERED`
- `COOLDOWN`

Behavior:

- Enter `TRACKING` when gaze enters a predetermined ROI
- Accumulate dwell only while the gaze stays inside that ROI and the sample remains valid
- Trigger capture at `1000 ms`
- Enter cooldown to prevent repeated captures from a single stare

### Screenshot, crop, and save flow

When dwell reaches the threshold:

1. The content script sends the active ROI, dwell time, viewport metrics, and page metadata to the background script.
2. The background script captures the visible tab.
3. The capture pipeline scales ROI CSS pixels to image pixels.
4. The background script crops the image to the ROI.
5. Downloads are written with deterministic names:
   - `output_<timestamp>_<roiId>_crop.png`
   - `output_<timestamp>_<roiId>_full.png`
   - `output_<timestamp>_<roiId>_meta.json`

Metadata includes timestamp, URL, ROI id, ROI bounds, dwell duration, filter mode, overlay state, tracking state, viewport size, and capture scale.

### Overlay interaction model

The content script injects a fixed overlay with:

- very high `z-index`
- `pointer-events: none`
- no focus handling
- animated gaze reticle
- predetermined ROI outlines
- dwell progress bars
- capture flash feedback

Overlay visibility is independent from tracking:

- `Tracking Enabled = off` stops tracking, dwell, and capture
- `Show Visual Overlay = off` keeps tracking and capture active, but hides the overlay only

## File Tree

```text
extension/
  manifest.json
  background/
    background.js
    capturePipeline.js
  content/
    contentScript.js
    dwellEngine.js
    overlayManager.js
    roiManager.js
  tracking/
    calibrationSession.js
    eyetraxBridge.js
  shared/
    browserAdapter.js
    config.js
    messages.js
    storage.js
  ui/
    popup.css
    popup.html
    popup.js
companion/
  requirements.txt
  eyetrax_bridge/
    __init__.py
    protocol.py
    server.py
    service.py
README.md
```

## Running The Prototype

### 1. Start the EyeTrax companion bridge

From the repository root:

```powershell
cd companion
python -m pip install -r requirements.txt
python -m eyetrax_bridge.server
```

Default bridge URL: `ws://127.0.0.1:8765`

If the bridge starts without EyeTrax installed, it now fails lazily with an explicit dependency error instead of crashing during module import.

### 2. Load the Firefox extension

1. Open `about:debugging#/runtime/this-firefox`
2. Choose `Load Temporary Add-on`
3. Select [extension/manifest.json](/d:/Repositories/Hackathons/Hack-Canada/extension/manifest.json)

### 3. Calibrate

1. Open the popup
2. Choose calibration mode if needed
3. Click `Run Calibration`
4. Follow the EyeTrax calibration window
5. After calibration completes, enable tracking

### 4. Use dwell capture

1. Look at one of the predetermined ROI boxes for 1 second
2. The visible tab is captured
3. The capture is cropped to that ROI
4. Files are downloaded locally into `EyeTraxCaptures/`

## ROI Configuration

Predetermined ROIs live in [extension/shared/config.js](/d:/Repositories/Hackathons/Hack-Canada/extension/shared/config.js). They are viewport-ratio based so the same prototype can run across different page sizes.

Current sample ROIs:

- `left_inspect`
- `center_focus`
- `right_action`

For a real deployment, these should become page-aware or user-configurable.

## Popup UI

The popup is a dark-mode control surface with animated toggles and supports:

- tracking on/off
- overlay on/off
- recalibration
- bridge reconnect
- filter mode selection
- cooldown setting
- EMA alpha
- KDE confidence
- camera index
- debug overlay toggle
- save full screenshot toggle
- save metadata toggle

## Known Limitations

- EyeTrax is Python-first, so Firefox uses a local companion bridge rather than in-extension Python execution.
- Calibration currently runs in the EyeTrax native window flow, not an in-page browser calibration overlay.
- The overlay is in-page only, not OS-wide.
- Screenshots are viewport-based using `tabs.captureVisibleTab`.
- ROI coordinates are predetermined and prototype-level.
- Firefox restricted pages and privileged internal pages will not behave like normal web pages.
- This is a Firefox MV2 prototype, not a production-ready packaging path.
- The dwell trigger threshold is fixed to `1000 ms`.

## Testing

The repository includes focused checks for the non-hardware parts of the prototype:

```powershell
python -m unittest discover -s tests -p "test_*.py"
node tests\dwellEngine.test.js
python -m compileall companion
Get-ChildItem extension -Recurse -Filter *.js | ForEach-Object { node --check $_.FullName }
```

Covered cases include:

- bridge protocol validation
- EyeTrax bridge calibration mode routing and lazy dependency handling
- dwell timing, cooldown suppression, ROI exit reset, and low-confidence rejection

## TODOs

- Replace the WebSocket bridge with Firefox native messaging if stricter local-process integration is required.
- Add extension-driven dense-grid calibration visuals while still using EyeTrax feature extraction and model training.
- Persist page-specific ROI templates instead of static defaults.
- Add stronger calibration success validation instead of relying on EyeTrax helper completion.
- Add optional full-screen or window-relative ROI authoring tools.
