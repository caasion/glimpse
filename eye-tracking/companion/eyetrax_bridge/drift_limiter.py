"""
Drift limiter: severely limits gaze drift by median filter, velocity cap, and dead zone.
Prioritizes stability over responsiveness.
"""

from __future__ import annotations

import math
import time
from collections import deque
from typing import Any, Tuple


class DriftLimitWrapper:
    """
    Wraps any smoother and applies:
    - Median filter over last N samples (rejects outlier-driven drift).
    - Max velocity cap (px/s) so the point cannot drift away quickly.
    - Dead zone: ignore movements smaller than radius (stops micro-drift).
    """

    def __init__(
        self,
        inner: Any,
        *,
        max_velocity: float = 200.0,
        median_window: int = 7,
        dead_zone_radius: float = 15.0,
        screen_width: int = 1920,
        screen_height: int = 1200,
    ) -> None:
        self._inner = inner
        self._max_velocity = max(1.0, max_velocity)
        self._median_window = max(1, min(31, median_window))  # odd preferred
        if self._median_window % 2 == 0:
            self._median_window += 1
        self._dead_zone = max(0.0, dead_zone_radius)
        self._history: deque[Tuple[float, float]] = deque(maxlen=self._median_window)
        self._out_x = float(screen_width) / 2
        self._out_y = float(screen_height) / 2
        self._t_prev: float | None = None

    def step(self, raw_x: float, raw_y: float) -> Tuple[float, float]:
        x, y = self._inner.step(raw_x, raw_y)
        t = time.perf_counter()

        self._history.append((x, y))
        if len(self._history) < 2:
            self._out_x, self._out_y = x, y
            self._t_prev = t
            return (self._out_x, self._out_y)

        # Median (robust to outliers / drift spikes)
        xs = [p[0] for p in self._history]
        ys = [p[1] for p in self._history]
        xs.sort()
        ys.sort()
        mid = len(xs) // 2
        cand_x = xs[mid]
        cand_y = ys[mid]

        dt = 0.033
        if self._t_prev is not None:
            dt = min(0.2, max(0.001, t - self._t_prev))
        self._t_prev = t

        # Dead zone: ignore tiny movements
        dx = cand_x - self._out_x
        dy = cand_y - self._out_y
        dist = math.hypot(dx, dy)
        if dist <= self._dead_zone and dist > 0:
            return (self._out_x, self._out_y)
        if dist > 0:
            # Velocity cap: move at most max_velocity * dt
            max_move = self._max_velocity * dt
            if dist > max_move:
                scale = max_move / dist
                cand_x = self._out_x + dx * scale
                cand_y = self._out_y + dy * scale

        self._out_x = cand_x
        self._out_y = cand_y
        return (self._out_x, self._out_y)
