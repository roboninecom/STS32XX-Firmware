"""Bounded viewer timing and monotonic pacing; no device or rendering access."""
from collections import deque
import math
import statistics


class Pacer:
    def __init__(self, start, hz=60):
        self.period = 1 / hz
        self.deadline = start + self.period
        self.missed = 0

    def remaining(self, now):
        # Skip elapsed slots instead of running catch-up bursts.
        if now > self.deadline:
            slots = math.floor((now - self.deadline) / self.period) + 1
            self.deadline += slots * self.period
            self.missed += slots
        delay = max(0, self.deadline - now)
        self.deadline += self.period
        return delay


class Timing:
    def __init__(self):
        self.preparation = deque(maxlen=240)
        self.sync = deque(maxlen=240)
        self.intervals = deque(maxlen=240)
        self.previous = None
        self.last_refresh = -math.inf
        self.text = "VIEWER TIMING | collecting samples (not GPU FPS)"

    def record(self, started, prepared, synced):
        self.preparation.append((prepared - started) * 1000)
        self.sync.append((synced - prepared) * 1000)
        if self.previous is not None:
            self.intervals.append((started - self.previous) * 1000)
        self.previous = started

    def summary(self, now, missed):
        if now - self.last_refresh < 0.5:
            return self.text
        self.last_refresh = now
        if not self.preparation:
            return self.text
        def stats(values):
            ordered = sorted(values)
            return f"{statistics.median(ordered):.2f}/{ordered[math.ceil(0.95 * len(ordered)) - 1]:.2f}"
        rate = 1000 / statistics.mean(self.intervals) if self.intervals else 0
        self.text = (f"VIEWER TIMING | loop {rate:.1f} Hz | missed deadlines {missed}\n"
                     f"Loop interval median/p95: {stats(self.intervals) if self.intervals else '--'} ms\n"
                     f"Prep median/p95: {stats(self.preparation)} ms | sync: {stats(self.sync)} ms\n"
                     "Viewer update timing; GPU rendering/FPS not measured")
        return self.text
