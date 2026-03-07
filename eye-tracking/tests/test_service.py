from __future__ import annotations

from pathlib import Path
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "companion"))

from eyetrax_bridge.service import (
    DEFAULT_SCREEN_SIZE,
    EyeTraxBridgeService,
    EyeTraxDependencyError,
)


class FakeEstimator:
    def __init__(self, model_name: str = "ridge") -> None:
        self.model_name = model_name
        self.saved_models: list[Path] = []
        self.loaded_models: list[Path] = []
        self.closed = False

    def save_model(self, path: str | Path) -> None:
        model_path = Path(path)
        model_path.parent.mkdir(parents=True, exist_ok=True)
        model_path.write_text("fake-model", encoding="utf-8")
        self.saved_models.append(model_path)

    def load_model(self, path: str | Path) -> None:
        self.loaded_models.append(Path(path))

    def close(self) -> None:
        self.closed = True


class FakeKalmanSmoother:
    def __init__(self, kalman: object) -> None:
        self.kalman = kalman
        self.tuned = False

    def tune(self, estimator: FakeEstimator, *, camera_index: int = 0) -> None:
        self.tuned = True
        self.camera_index = camera_index
        self.estimator = estimator


class FakeKalmanEMASmoother(FakeKalmanSmoother):
    def __init__(self, kalman: object, ema_alpha: float = 0.25) -> None:
        super().__init__(kalman)
        self.ema_alpha = ema_alpha


class FakeKDESmoother:
    def __init__(self, screen_width: int, screen_height: int, *, confidence: float) -> None:
        self.screen_width = screen_width
        self.screen_height = screen_height
        self.confidence = confidence


class FakeNoSmoother:
    pass


def build_runtime(calls: list[tuple]) -> dict:
    estimator = FakeEstimator()

    def mark(name: str):
        def callback(*args, **kwargs):
            calls.append((name, args, kwargs))

        return callback

    return {
        "GazeEstimator": lambda model_name="ridge": estimator,
        "run_5_point_calibration": mark("5p"),
        "run_9_point_calibration": mark("9p"),
        "run_dense_grid_calibration": mark("dense"),
        "run_lissajous_calibration": mark("lissajous"),
        "KDESmoother": FakeKDESmoother,
        "KalmanEMASmoother": FakeKalmanEMASmoother,
        "KalmanSmoother": FakeKalmanSmoother,
        "NoSmoother": FakeNoSmoother,
        "make_kalman": lambda: {"kind": "kalman"},
        "get_screen_size": lambda: (2560, 1440),
        "open_camera": lambda camera_index=0: None,
        "estimator": estimator,
    }


class ServiceTests(unittest.TestCase):
    def test_status_payload_falls_back_when_runtime_is_missing(self) -> None:
        service = EyeTraxBridgeService(
            lambda *_: None,
            runtime_provider=lambda: (_ for _ in ()).throw(EyeTraxDependencyError("boom")),
        )

        payload = service.status_payload()
        self.assertEqual(
            (payload["screen_width"], payload["screen_height"]),
            DEFAULT_SCREEN_SIZE,
        )

        with self.assertRaises(EyeTraxDependencyError):
            service.ensure_estimator()

    def test_run_calibration_uses_nine_point_flow_and_persists_model(self) -> None:
        calls: list[tuple] = []
        events: list[tuple[str, dict]] = []
        runtime = build_runtime(calls)
        service = EyeTraxBridgeService(
            lambda message_type, payload: events.append((message_type, payload)),
            runtime_provider=lambda: runtime,
        )

        with tempfile.TemporaryDirectory() as temp_dir:
            model_file = Path(temp_dir) / "gaze.pkl"
            service._run_calibration(
                {
                    "mode": "9p",
                    "camera_index": 2,
                    "model_name": "ridge",
                    "model_file": str(model_file),
                }
            )

            self.assertTrue(model_file.exists())
            self.assertIn(("9p", (runtime["estimator"],), {"camera_index": 2}), calls)
            self.assertEqual(events[0][0], "calibration_started")
            self.assertEqual(events[1][0], "calibration_completed")
            self.assertTrue(service.status_payload()["calibrated"])

    def test_dense_calibration_passes_grid_configuration(self) -> None:
        calls: list[tuple] = []
        runtime = build_runtime(calls)
        service = EyeTraxBridgeService(lambda *_: None, runtime_provider=lambda: runtime)

        with tempfile.TemporaryDirectory() as temp_dir:
            service._run_calibration(
                {
                    "mode": "dense",
                    "model_file": str(Path(temp_dir) / "dense.pkl"),
                    "dense": {
                        "rows": 7,
                        "cols": 6,
                        "margin_ratio": 0.18,
                    },
                }
            )

        dense_call = next(call for call in calls if call[0] == "dense")
        self.assertEqual(dense_call[2]["rows"], 7)
        self.assertEqual(dense_call[2]["cols"], 6)
        self.assertEqual(dense_call[2]["margin_ratio"], 0.18)

    def test_start_tracking_requires_loaded_or_calibrated_model(self) -> None:
        calls: list[tuple] = []
        service = EyeTraxBridgeService(lambda *_: None, runtime_provider=lambda: build_runtime(calls))

        with self.assertRaises(RuntimeError):
            service.start_tracking({"filter_mode": "kalman_ema"})

    def test_build_smoother_uses_kalman_ema_configuration(self) -> None:
        calls: list[tuple] = []
        runtime = build_runtime(calls)
        service = EyeTraxBridgeService(lambda *_: None, runtime_provider=lambda: runtime)

        smoother = service._build_smoother(
            {
                "filter_mode": "kalman_ema",
                "ema_alpha": 0.4,
                "camera_index": 1,
                "kalman_tune_enabled": True,
            }
        )

        self.assertIsInstance(smoother, FakeKalmanEMASmoother)
        self.assertEqual(smoother.ema_alpha, 0.4)
        self.assertTrue(smoother.tuned)


if __name__ == "__main__":
    unittest.main()
