from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
import threading
import time
from typing import Any, Callable

import numpy as np


DEFAULT_SCREEN_SIZE = (1920, 1080)


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
        estimator = self.ensure_estimator(model_name=model_name)
        if not model_file:
            return

        path = Path(model_file).expanduser().resolve()
        if path.exists():
            estimator.load_model(path)
            with self._lock:
                self._state.calibrated = True
                self._state.model_file = str(path)

    def load_model(self, payload: dict) -> None:
        model_name = str(payload.get("model_name") or "ridge")
        model_file = payload.get("model_file")
        if not model_file:
            raise ValueError("load_model requires model_file")

        estimator = self.ensure_estimator(model_name=model_name)
        path = Path(model_file).expanduser().resolve()
        estimator.load_model(path)

        with self._lock:
            self._state.calibrated = True
            self._state.model_file = str(path)

    def _build_smoother(self, payload: dict):
        runtime = self._get_runtime()
        filter_mode = str(payload.get("filter_mode") or "kalman_ema")
        camera_index = int(payload.get("camera_index", 0))
        ema_alpha = float(payload.get("ema_alpha", 0.25))
        kde_confidence = float(payload.get("kde_confidence", 0.5))
        kalman_tune_enabled = bool(payload.get("kalman_tune_enabled", False))

        if filter_mode == "kalman":
            smoother = runtime["KalmanSmoother"](runtime["make_kalman"]())
            if kalman_tune_enabled:
                smoother.tune(self.ensure_estimator(), camera_index=camera_index)
            return smoother

        if filter_mode == "kalman_ema":
            smoother = runtime["KalmanEMASmoother"](
                runtime["make_kalman"](),
                ema_alpha=ema_alpha,
            )
            if kalman_tune_enabled:
                smoother.tune(self.ensure_estimator(), camera_index=camera_index)
            return smoother

        if filter_mode == "kde":
            return runtime["KDESmoother"](
                self._screen_size[0],
                self._screen_size[1],
                confidence=kde_confidence,
            )

        return runtime["NoSmoother"]()

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
            else:
                runtime["run_9_point_calibration"](estimator, camera_index=camera_index)

            estimator.save_model(model_path)

            with self._lock:
                self._state.calibrated = True
                self._state.calibration_mode = mode
                self._state.model_file = str(model_path)
                self._state.last_calibrated_at = datetime.now(timezone.utc).isoformat()
                self._state.sample_count = None

            self._emit(
                "calibration_completed",
                {
                    "mode": mode,
                    "completed_at": self._state.last_calibrated_at,
                    "model_file": str(model_path),
                    "sample_count": self._state.sample_count,
                },
            )
        except Exception as exc:  # pragma: no cover - exercised by manual flows
            self._emit("error", {"scope": "calibration", "message": str(exc)})
        finally:
            self._calibration_thread = None

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
                            "x": x,
                            "y": y,
                            "raw_x": x,
                            "raw_y": y,
                            "valid": False,
                            "blink": bool(blink),
                            "confidence": 0.0,
                            "filter": filter_mode,
                        },
                    )
                    continue

                raw_x, raw_y = map(int, estimator.predict(np.array([features]))[0])
                smooth_x, smooth_y = self._smoother.step(raw_x, raw_y)
                self._last_point = (smooth_x, smooth_y)

                self._emit(
                    "gaze_sample",
                    {
                        "timestamp": timestamp,
                        "x": smooth_x,
                        "y": smooth_y,
                        "raw_x": raw_x,
                        "raw_y": raw_y,
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
