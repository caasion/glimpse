from __future__ import annotations

import math
import pickle
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
import threading
import time
from typing import Any, Callable

import numpy as np

from eyetrax_bridge.drift_limiter import DriftLimitWrapper

DEFAULT_SCREEN_SIZE = (1920, 1200)


class EyeTraxDependencyError(RuntimeError):
    pass


def _default_runtime_provider() -> dict[str, Any]:
    try:
        from eyetrax import GazeEstimator
        from eyetrax.calibration import (
            run_5_point_calibration,
            run_9_point_calibration,
            run_dense_grid_calibration,
            run_lissajous_calibration,
        )
        from eyetrax.filters import (
            KDESmoother,
            KalmanEMASmoother,
            KalmanSmoother,
            NoSmoother,
            make_kalman,
        )
        from eyetrax.utils.screen import get_screen_size
        from eyetrax.utils.video import open_camera
    except Exception as exc:  # pragma: no cover - depends on local native packages
        raise EyeTraxDependencyError(
            "EyeTrax dependencies are unavailable. Install companion requirements with "
            "`python -m pip install -r companion/requirements.txt` before starting the bridge."
        ) from exc

    return {
        "GazeEstimator": GazeEstimator,
        "run_5_point_calibration": run_5_point_calibration,
        "run_9_point_calibration": run_9_point_calibration,
        "run_dense_grid_calibration": run_dense_grid_calibration,
        "run_lissajous_calibration": run_lissajous_calibration,
        "KDESmoother": KDESmoother,
        "KalmanEMASmoother": KalmanEMASmoother,
        "KalmanSmoother": KalmanSmoother,
        "NoSmoother": NoSmoother,
        "make_kalman": make_kalman,
        "get_screen_size": get_screen_size,
        "open_camera": open_camera,
    }


@dataclass
class BridgeState:
    calibrated: bool = False
    tracking: bool = False
    calibration_mode: str = "9p"
    filter_mode: str = "kalman_ema"
    model_file: str = ""
    last_calibrated_at: str | None = None
    sample_count: int | None = None


class EyeTraxBridgeService:
    def __init__(
        self,
        emit: Callable[[str, dict], None],
        *,
        runtime_provider: Callable[[], dict[str, Any]] | None = None,
        screen_size: tuple[int, int] | None = None,
    ) -> None:
        self._emit = emit
        self._runtime_provider = runtime_provider or _default_runtime_provider
        self._runtime: dict[str, Any] | None = None
        self._lock = threading.RLock()
        self._state = BridgeState()
        self._estimator = None
        self._smoother = None
        self._tracking_thread: threading.Thread | None = None
        self._tracking_stop = threading.Event()
        self._calibration_thread: threading.Thread | None = None
        self._default_model_path = (
            Path(__file__).resolve().parent.parent / "models" / "eyetrax_latest.pkl"
        )
        self._last_point = (0, 0)
        self._screen_size = screen_size or self._detect_screen_size()
        self._custom_samples: list[tuple[Any, float, float]] = []
        self._custom_model: dict[str, Any] | None = None
        self._collect_thread: threading.Thread | None = None
        self._collect_stop = threading.Event()

    def _detect_screen_size(self) -> tuple[int, int]:
        try:
            runtime = self._get_runtime()
            width, height = runtime["get_screen_size"]()
            return int(width), int(height)
        except Exception:
            return DEFAULT_SCREEN_SIZE

    def _get_runtime(self) -> dict[str, Any]:
        with self._lock:
            if self._runtime is None:
                self._runtime = self._runtime_provider()
            return self._runtime

    def status_payload(self) -> dict:
        with self._lock:
            return {
                "calibrated": self._state.calibrated,
                "tracking": self._state.tracking,
                "calibration_mode": self._state.calibration_mode,
                "filter_mode": self._state.filter_mode,
                "model_file": self._state.model_file,
                "last_calibrated_at": self._state.last_calibrated_at,
                "sample_count": self._state.sample_count,
                "screen_width": self._screen_size[0],
                "screen_height": self._screen_size[1],
            }

    def ensure_estimator(self, model_name: str = "ridge"):
        with self._lock:
            if self._estimator is None:
                runtime = self._get_runtime()
                self._estimator = runtime["GazeEstimator"](model_name=model_name)
            return self._estimator

    def _resolve_model_path(self, requested_path: str | None) -> Path:
        path = (
            Path(requested_path).expanduser().resolve()
            if requested_path
            else self._default_model_path
        )
        path.parent.mkdir(parents=True, exist_ok=True)
        return path

    def _load_model_if_present(self, model_name: str, model_file: str | None) -> None:
        if not model_file:
            return
        path = Path(model_file).expanduser().resolve()
        if not path.exists():
            return
        try:
            with open(path, "rb") as f:
                data = pickle.load(f)
            if isinstance(data, dict) and data.get("bridge_custom"):
                with self._lock:
                    self._custom_model = data
                    self._state.calibrated = True
                    self._state.model_file = str(path)
                return
        except (pickle.PickleError, OSError):
            pass
        estimator = self.ensure_estimator(model_name=model_name)
        estimator.load_model(path)
        with self._lock:
            self._custom_model = None
            self._state.calibrated = True
            self._state.model_file = str(path)

    def load_model(self, payload: dict) -> None:
        model_file = payload.get("model_file")
        if not model_file:
            raise ValueError("load_model requires model_file")
        path = Path(model_file).expanduser().resolve()
        if not path.exists():
            raise FileNotFoundError(f"model file not found: {path}")
        try:
            with open(path, "rb") as f:
                data = pickle.load(f)
            if isinstance(data, dict) and data.get("bridge_custom"):
                with self._lock:
                    self._custom_model = data
                    self._state.calibrated = True
                    self._state.model_file = str(path)
                return
        except (pickle.PickleError, OSError):
            pass
        model_name = str(payload.get("model_name") or "ridge")
        estimator = self.ensure_estimator(model_name=model_name)
        estimator.load_model(path)
        with self._lock:
            self._custom_model = None
            self._state.calibrated = True
            self._state.model_file = str(path)

    def _build_smoother(self, payload: dict):
        runtime = self._get_runtime()
        filter_mode = str(payload.get("filter_mode") or "kalman_ema")
        camera_index = int(payload.get("camera_index", 0))
        ema_alpha = float(payload.get("ema_alpha", 0.12))
        kde_confidence = float(payload.get("kde_confidence", 0.5))
        kalman_tune_enabled = bool(payload.get("kalman_tune_enabled", False))

        if filter_mode == "kalman":
            base = runtime["KalmanSmoother"](runtime["make_kalman"]())
            if kalman_tune_enabled:
                base.tune(self.ensure_estimator(), camera_index=camera_index)
            return self._maybe_wrap_drift_limit(base, payload)

        if filter_mode == "kalman_ema":
            base = runtime["KalmanEMASmoother"](
                runtime["make_kalman"](),
                ema_alpha=ema_alpha,
            )
            if kalman_tune_enabled:
                base.tune(self.ensure_estimator(), camera_index=camera_index)
            return self._maybe_wrap_drift_limit(base, payload)

        if filter_mode == "kde":
            base = runtime["KDESmoother"](
                self._screen_size[0],
                self._screen_size[1],
                confidence=kde_confidence,
            )
            return self._maybe_wrap_drift_limit(base, payload)

        base = runtime["NoSmoother"]()
        return self._maybe_wrap_drift_limit(base, payload)

    def _maybe_wrap_drift_limit(self, smoother, payload: dict):
        anti_jerk = bool(payload.get("anti_jerk_enabled", False))
        max_vel = float(payload.get("drift_max_velocity", 0))
        median_win = int(payload.get("drift_median_window", 1))
        dead_zone = float(payload.get("drift_dead_zone", 0))
        if anti_jerk and max_vel <= 0 and median_win <= 1 and dead_zone <= 0:
            max_vel = 160.0
            median_win = 9
            dead_zone = 20.0
        if not anti_jerk and max_vel <= 0 and median_win <= 1 and dead_zone <= 0:
            return smoother
        return DriftLimitWrapper(
            smoother,
            max_velocity=max_vel if max_vel > 0 else 160.0,
            median_window=median_win if median_win > 1 else 9,
            dead_zone_radius=dead_zone if dead_zone > 0 else 20.0,
            screen_width=self._screen_size[0],
            screen_height=self._screen_size[1],
        )

    def start_calibration(self, payload: dict) -> None:
        with self._lock:
            if self._calibration_thread and self._calibration_thread.is_alive():
                raise RuntimeError("calibration is already running")

        self.stop_tracking()
        thread = threading.Thread(
            target=self._run_calibration,
            args=(payload,),
            daemon=True,
            name="EyeTraxCalibration",
        )
        self._calibration_thread = thread
        thread.start()

    def _run_calibration(self, payload: dict) -> None:
        runtime = self._get_runtime()
        mode = str(payload.get("mode") or "9p")
        camera_index = int(payload.get("camera_index", 0))
        model_name = str(payload.get("model_name") or "ridge")
        model_path = self._resolve_model_path(payload.get("model_file"))
        dense = payload.get("dense") or {}

        try:
            estimator = self.ensure_estimator(model_name=model_name)
            self._emit("calibration_started", {"mode": mode})

            if mode == "5p":
                runtime["run_5_point_calibration"](estimator, camera_index=camera_index)
            elif mode == "dense":
                runtime["run_dense_grid_calibration"](
                    estimator,
                    rows=int(dense.get("rows", 5)),
                    cols=int(dense.get("cols", 5)),
                    margin_ratio=float(dense.get("margin_ratio", 0.1)),
                    camera_index=camera_index,
                )
            elif mode == "lissajous":
                runtime["run_lissajous_calibration"](estimator, camera_index=camera_index)
            elif mode == "9p+dense":
                runtime["run_9_point_calibration"](estimator, camera_index=camera_index)
                runtime["run_dense_grid_calibration"](
                    estimator,
                    rows=int(dense.get("rows", 7)),
                    cols=int(dense.get("cols", 7)),
                    margin_ratio=float(dense.get("margin_ratio", 0.1)),
                    camera_index=camera_index,
                )
            else:
                runtime["run_9_point_calibration"](estimator, camera_index=camera_index)

            estimator.save_model(model_path)

            validation_mean_error_px = None
            validation_ready = True
            if payload.get("validation_enabled", True):
                try:
                    validation_mean_error_px, validation_ready = self._run_validation(
                        estimator, camera_index, payload
                    )
                except Exception:  # pragma: no cover - hardware dependent
                    validation_mean_error_px = None
                    validation_ready = True

            with self._lock:
                self._state.calibrated = True
                self._state.calibration_mode = mode
                self._state.model_file = str(model_path)
                self._state.last_calibrated_at = datetime.now(timezone.utc).isoformat()
                self._state.sample_count = None

            completed_payload = {
                "mode": mode,
                "completed_at": self._state.last_calibrated_at,
                "model_file": str(model_path),
                "sample_count": self._state.sample_count,
            }
            if validation_mean_error_px is not None:
                completed_payload["validation_mean_error_px"] = round(
                    validation_mean_error_px, 1
                )
                completed_payload["validation_ready"] = validation_ready
            self._emit("calibration_completed", completed_payload)
        except Exception as exc:  # pragma: no cover - exercised by manual flows
            self._emit("error", {"scope": "calibration", "message": str(exc)})
        finally:
            self._calibration_thread = None

    def _run_validation(
        self, estimator: Any, camera_index: int, payload: dict
    ) -> tuple[float, bool]:
        """Run 5-point validation: collect predictions at center + corners, return mean error (px) and ready flag."""
        runtime = self._get_runtime()
        duration_per_target = float(payload.get("validation_duration_per_target_sec", 2.0))
        duration_per_target = max(0.5, min(5.0, duration_per_target))
        threshold_px = float(payload.get("validation_threshold_px", 80.0))
        threshold_px = max(10.0, threshold_px)
        w, h = self._screen_size[0], self._screen_size[1]
        margin = 0.15
        targets = [
            (w // 2, h // 2),
            (int(w * margin), int(h * margin)),
            (int(w * (1 - margin)), int(h * margin)),
            (int(w * margin), int(h * (1 - margin))),
            (int(w * (1 - margin)), int(h * (1 - margin))),
        ]
        cap = runtime["open_camera"](camera_index)
        try:
            errors_per_target: list[float] = []
            for i, (tx, ty) in enumerate(targets):
                self._emit(
                    "validation_target",
                    {"target_x": tx, "target_y": ty, "index": i, "total": len(targets)},
                )
                predictions: list[tuple[float, float]] = []
                t_end = time.perf_counter() + duration_per_target
                while time.perf_counter() < t_end:
                    ok, frame = cap.read()
                    if not ok:
                        time.sleep(0.01)
                        continue
                    features, blink = estimator.extract_features(frame)
                    if features is not None and not blink:
                        raw_x, raw_y = map(float, estimator.predict(np.array([features]))[0])
                        predictions.append((raw_x, raw_y))
                    time.sleep(0.02)
                if predictions:
                    dists = [math.hypot(px - tx, py - ty) for px, py in predictions]
                    errors_per_target.append(sum(dists) / len(dists))
            if not errors_per_target:
                return (float("inf"), False)
            mean_error = sum(errors_per_target) / len(errors_per_target)
            return (mean_error, mean_error < threshold_px)
        finally:
            cap.release()

    def start_collect_target(self, payload: dict) -> None:
        target_x = float(payload.get("target_x", 0))
        target_y = float(payload.get("target_y", 0))
        duration_ms = int(payload.get("duration_ms", 2000))
        duration_ms = max(500, min(10000, duration_ms))
        camera_index = int(payload.get("camera_index", 0))
        with self._lock:
            if self._collect_thread and self._collect_thread.is_alive():
                raise RuntimeError("collect already running")
        self._collect_stop.clear()
        thread = threading.Thread(
            target=self._run_collect_target,
            args=(camera_index, target_x, target_y, duration_ms),
            daemon=True,
            name="CollectTarget",
        )
        self._collect_thread = thread
        thread.start()

    def _run_collect_target(
        self, camera_index: int, target_x: float, target_y: float, duration_ms: int
    ) -> None:
        runtime = self._get_runtime()
        estimator = self.ensure_estimator(model_name="ridge")
        try:
            cap = runtime["open_camera"](camera_index)
        except Exception as exc:  # pragma: no cover
            self._emit("error", {"scope": "calibration", "message": str(exc)})
            self._emit("collect_target_done", {"success": False})
            return
        t_end = time.perf_counter() + (duration_ms / 1000.0)
        collected = 0
        try:
            while time.perf_counter() < t_end and not self._collect_stop.is_set():
                ok, frame = cap.read()
                if not ok:
                    time.sleep(0.01)
                    continue
                features, blink = estimator.extract_features(frame)
                if features is not None and not blink:
                    self._custom_samples.append(
                        (np.asarray(features, dtype=np.float64), target_x, target_y)
                    )
                    collected += 1
                time.sleep(0.02)
            self._emit(
                "collect_target_done",
                {"success": True, "collected": collected, "target_x": target_x, "target_y": target_y},
            )
        finally:
            cap.release()
        self._collect_thread = None

    def fit_calibration_model(self, payload: dict) -> None:
        model_path = self._resolve_model_path(payload.get("model_file"))
        if len(self._custom_samples) < 5:
            raise ValueError(
                f"need at least 5 samples for custom calibration, got {len(self._custom_samples)}"
            )
        X = np.array([s[0] for s in self._custom_samples])
        y_x = np.array([s[1] for s in self._custom_samples])
        y_y = np.array([s[2] for s in self._custom_samples])
        lam = float(payload.get("ridge_alpha", 1.0))
        n, p = X.shape
        reg = lam * np.eye(p)
        coef_x = np.linalg.solve(X.T @ X + reg, X.T @ y_x)
        coef_y = np.linalg.solve(X.T @ X + reg, X.T @ y_y)
        intercept_x = float(np.mean(y_x - X @ coef_x))
        intercept_y = float(np.mean(y_y - X @ coef_y))
        data = {
            "bridge_custom": True,
            "coef_x": coef_x,
            "coef_y": coef_y,
            "intercept_x": intercept_x,
            "intercept_y": intercept_y,
        }
        with open(model_path, "wb") as f:
            pickle.dump(data, f)
        self._custom_samples.clear()
        with self._lock:
            self._custom_model = data
            self._state.calibrated = True
            self._state.model_file = str(model_path)
            self._state.calibration_mode = "custom"
            self._state.last_calibrated_at = datetime.now(timezone.utc).isoformat()
        self._emit(
            "calibration_completed",
            {
                "mode": "custom",
                "completed_at": self._state.last_calibrated_at,
                "model_file": str(model_path),
                "sample_count": len(X),
            },
        )

    def start_tracking(self, payload: dict) -> None:
        model_name = str(payload.get("model_name") or "ridge")
        self._load_model_if_present(model_name, payload.get("model_file"))

        with self._lock:
            if not self._state.calibrated:
                raise RuntimeError(
                    "start_tracking requires a calibrated or loaded EyeTrax model"
                )

        self.stop_tracking()
        self._tracking_stop.clear()
        self._smoother = self._build_smoother(payload)

        thread = threading.Thread(
            target=self._run_tracking_loop,
            args=(payload,),
            daemon=True,
            name="EyeTraxTracking",
        )
        self._tracking_thread = thread
        thread.start()

    def _run_tracking_loop(self, payload: dict) -> None:
        runtime = self._get_runtime()
        camera_index = int(payload.get("camera_index", 0))
        filter_mode = str(payload.get("filter_mode") or "kalman_ema")
        model_name = str(payload.get("model_name") or "ridge")
        gaze_offset_x = int(payload.get("gaze_offset_x", 0))
        gaze_offset_y = int(payload.get("gaze_offset_y", 0))

        try:
            estimator = self.ensure_estimator(model_name=model_name)
            cap = runtime["open_camera"](camera_index)
        except Exception as exc:  # pragma: no cover - hardware dependent
            self._emit("error", {"scope": "tracking", "message": str(exc)})
            return

        with self._lock:
            self._state.tracking = True
            self._state.filter_mode = filter_mode

        self._emit(
            "tracking_started",
            {
                "filter_mode": filter_mode,
                "screen_width": self._screen_size[0],
                "screen_height": self._screen_size[1],
            },
        )

        try:
            while not self._tracking_stop.is_set():
                ok, frame = cap.read()
                if not ok:
                    time.sleep(0.01)
                    continue

                timestamp = int(time.time() * 1000)
                features, blink = estimator.extract_features(frame)

                if features is None or blink:
                    x, y = self._last_point
                    self._emit(
                        "gaze_sample",
                        {
                            "timestamp": timestamp,
                            "x": x + gaze_offset_x,
                            "y": y + gaze_offset_y,
                            "raw_x": x + gaze_offset_x,
                            "raw_y": y + gaze_offset_y,
                            "valid": False,
                            "blink": bool(blink),
                            "confidence": 0.0,
                            "filter": filter_mode,
                        },
                    )
                    continue

                with self._lock:
                    custom = self._custom_model
                if custom is not None:
                    f = np.asarray(features, dtype=np.float64).ravel()
                    raw_x = int(round(float(np.dot(f, custom["coef_x"]) + custom["intercept_x"])))
                    raw_y = int(round(float(np.dot(f, custom["coef_y"]) + custom["intercept_y"])))
                else:
                    raw_x, raw_y = map(int, estimator.predict(np.array([features]))[0])
                smooth_x, smooth_y = self._smoother.step(raw_x, raw_y)
                self._last_point = (smooth_x, smooth_y)

                self._emit(
                    "gaze_sample",
                    {
                        "timestamp": timestamp,
                        "x": smooth_x + gaze_offset_x,
                        "y": smooth_y + gaze_offset_y,
                        "raw_x": raw_x + gaze_offset_x,
                        "raw_y": raw_y + gaze_offset_y,
                        "valid": True,
                        "blink": False,
                        "confidence": 1.0,
                        "filter": filter_mode,
                    },
                )
        except Exception as exc:  # pragma: no cover - hardware dependent
            self._emit("error", {"scope": "tracking", "message": str(exc)})
        finally:
            cap.release()
            with self._lock:
                self._state.tracking = False
            self._emit("tracking_stopped", {"filter_mode": filter_mode})

    def stop_tracking(self) -> None:
        thread = self._tracking_thread
        self._tracking_stop.set()
        if thread and thread.is_alive():
            thread.join(timeout=2.0)
        self._tracking_thread = None
        with self._lock:
            self._state.tracking = False

    def shutdown(self) -> None:
        self.stop_tracking()
        estimator = self._estimator
        if estimator is not None and hasattr(estimator, "close"):
            estimator.close()
