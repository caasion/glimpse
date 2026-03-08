# How Eye Gaze Tracking Works

## 1. Where the code lives

| Layer | Location | Role |
|-------|----------|------|
| **Extension (Firefox)** | `eye-tracking/extension/` | Popup UI, WebSocket client, overlay, dwell logic |
| **Bridge (this repo)** | `eye-tracking/companion/eyetrax_bridge/` | WebSocket server, camera loop, smoothing, calls EyeTrax |
| **ML / gaze model** | **External:** `eyetrax` (PyPI) | Feature extraction, regression model, calibration |

The actual **feature extraction** and **regression model** live inside the **EyeTrax** package (`eyetrax>=0.2.2`). This repo only calls its API; it does not implement the ML.

---

## 2. End-to-end flow

```
[Webcam] → frame
    ↓
[EyeTrax] extract_features(frame) → (feature_vector, blink)
    ↓
[EyeTrax] predict(feature_vector) → (raw_x, raw_y)  ← ML model (ridge regression)
    ↓
[Bridge]  smoother.step(raw_x, raw_y) → (smooth_x, smooth_y)  ← Kalman / jerk / etc.
    ↓
[Bridge]  emit "gaze_sample" { x, y, raw_x, raw_y, valid, ... }
    ↓
[Extension] WebSocket message → overlay / dwell logic
```

---

## 3. Code locations in this repo

### Companion (Python)

- **Service (orchestration + tracking loop)**  
  `companion/eyetrax_bridge/service.py`  
  - `_run_tracking_loop()`: reads frames, calls `estimator.extract_features(frame)` and `estimator.predict(...)`, runs smoother, emits `gaze_sample`.
  - `ensure_estimator(model_name="ridge")`: creates the EyeTrax `GazeEstimator`.
  - `_build_smoother()`: builds Kalman, Kalman+EMA, jerk, etc. from payload.
- **Server (WebSocket)**  
  `companion/eyetrax_bridge/server.py`  
  - Handles `start_tracking`, `stop_tracking`, `start_calibration`, `load_model`, etc., and delegates to the service.
- **Protocol**  
  `companion/eyetrax_bridge/protocol.py`  
  - Message encoding/decoding (JSON with `type` + `payload`).

### Extension (JavaScript)

- **Bridge client**  
  `extension/tracking/eyetraxBridge.js`  
  - WebSocket connect, `startTracking(payload)`, `startCalibration(payload)`, forwards events to background.
- **Background**  
  `extension/background/background.js`  
  - Keeps bridge connection, maps bridge events to state, starts/stops tracking, handles calibration completion.
- **Payloads**  
  `extension/tracking/calibrationSession.js`  
  - `buildTrackingPayload(settings)`: `filter_mode`, `model_name`, `jerk_max`, `ema_alpha`, etc.
  - `buildCalibrationPayload(settings)`: calibration mode, camera, model path, etc.

The **gaze_sample** handling (overlay, dwell) is in the content script and overlay manager (e.g. `extension/content/`, `extension/content/overlayManager.js`).

---

## 4. ML model: where it runs and what it is

The model is **not** implemented in this repo. It is implemented in the **EyeTrax** library:

- **Package:** `eyetrax` (PyPI), e.g. <https://github.com/ck-zhang/EyeTrax>.
- **Usage in this repo:**  
  `service.py` does:
  - `estimator = runtime["GazeEstimator"](model_name=model_name)`  with `model_name="ridge"`.
  - `features, blink = estimator.extract_features(frame)`  → feature vector + blink flag.
  - `estimator.predict(np.array([features]))[0]` → `(raw_x, raw_y)` in screen coordinates.

So the **ML** is: **feature extraction** (inside EyeTrax, typically face/eye regions and possibly MediaPipe-style features) plus a **regression** step. The bridge only passes `model_name="ridge"` and uses the fitted model after calibration or load.

---

## 5. Math for the regression model (ridge)

The bridge uses a **ridge regression**-type model (name `"ridge"` in EyeTrax). The exact feature vector and training loop are defined in EyeTrax; the **regression step** is standard ridge.

**Notation**

- \( n \) = number of training samples (from calibration).
- \( p \) = feature dimension (from `extract_features`).
- \( \mathbf{X} \in \mathbb{R}^{n \times p} \) = design matrix (one row per calibration sample).
- \( \mathbf{y} \in \mathbb{R}^{n \times 2} \) = targets: each row is \( (x_i, y_i) \) screen coordinates for that sample.
- \( \lambda \geq 0 \) = ridge regularization strength.

**Ridge regression (per output)**

For each output dimension \( d \in \{x, y\} \), solve:

\[
\hat{\boldsymbol\beta}_d = \arg\min_{\boldsymbol\beta} \ \|\mathbf{X}\boldsymbol\beta - \mathbf{y}_d\|^2 + \lambda \|\boldsymbol\beta\|^2
\]

Closed form:

\[
\hat{\boldsymbol\beta}_d = (\mathbf{X}^T\mathbf{X} + \lambda \mathbf{I})^{-1} \mathbf{X}^T \mathbf{y}_d
\]

**Prediction**

For a new feature vector \( \mathbf{f} \in \mathbb{R}^p \) (one row):

\[
\hat{x} = \mathbf{f}\, \hat{\boldsymbol\beta}_x, \qquad \hat{y} = \mathbf{f}\, \hat{\boldsymbol\beta}_y
\]

So the “ML model” in this setup is: **ridge regression** mapping a fixed-size feature vector to 2D screen coordinates. The **features** (what goes into \( \mathbf{X} \) and \( \mathbf{f} \)) are defined and computed inside EyeTrax (e.g. from face/eye crops or landmarks), not in this repo.

**Calibration** in this repo simply triggers EyeTrax’s calibration routines; they collect \( (\mathbf{X}, \mathbf{y}) \) at known screen points, then fit the ridge model and save it (e.g. as `.pkl`). The bridge’s role is to call `load_model` / run calibration and then use the same estimator for `extract_features` + `predict` in the tracking loop.

---

## 6. Summary

- **This repo:** WebSocket bridge, camera loop, smoothing (Kalman, jerk, etc.), and extension UI/connection. It **calls** EyeTrax; it does **not** implement feature extraction or the regression math.
- **EyeTrax (external):** Feature extraction from each frame, blink detection, ridge (or other) regression from features to screen \((x,y)\), calibration and model save/load.
- **Math you asked for:** The regression step is **ridge regression** as above; the **feature** formula is in the EyeTrax source (not in this repo).

For the exact feature pipeline (how `extract_features` builds the vector), see the EyeTrax source on GitHub or the installed package under your venv’s `site-packages/eyetrax/`.
