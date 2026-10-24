"""Adapt shared-controller logs to display frames; never open a serial device."""
import copy
import datetime
import json
import math
import os
from pathlib import Path


def number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def validate_frame(frame):
    if not isinstance(frame, dict):
        raise ValueError("Expected telemetry object")
    for mode in ("measured", "reference"):
        for motor in ("1", "2", "3", "4"):
            value = frame[mode][motor]
            if not number(value) or not -32768 <= value <= 32767:
                raise ValueError("Invalid pose stream")
    if not number(frame.get("publishedUnixMs")):
        raise ValueError("Missing publication time")
    if not isinstance(frame.get("telemetry", {}), dict):
        raise ValueError("Invalid telemetry")
    return frame


def timestamp(event, fallback=None):
    value = event.get('wallTime')
    if value:
        if not isinstance(value, str):
            raise ValueError('Invalid recording wall time')
        return datetime.datetime.fromisoformat(value.replace('Z', '+00:00')).timestamp() * 1000
    value = event.get('timestamp', fallback)
    if not number(value):
        raise ValueError('Recording event lacks a timestamp')
    return value


class Frames:
    def __init__(self, directory, mapping=None):
        self.mapping = mapping
        self.directory = str(directory)
        self.samples, self.measured_at, self.targets = {}, {}, {}
        self.pending = {}
        self.required = {str(i) for i in range(1, 5)}
        self.label, self.status = '', 'running'
        self.calibration = None
        self.last_time = None

    def accept(self, event):
        if not isinstance(event, dict):
            raise ValueError('Expected a recording event object')
        kind = event.get('type')
        if kind == 'preflight':
            if self.calibration is not None:
                raise ValueError('Recording contains more than one session preflight')
            self.calibration = {str(k): v.get('encoderCalibration') for k, v in event.get('limits', {}).get('follower', {}).items()}
            if self.mapping is not None:
                check_calibration(self.calibration, self.mapping)
            self.required.update(self.calibration)
            return None
        if self.mapping is not None and self.calibration is None and kind in ('command', 'telemetry'):
            raise ValueError('Recording lacks calibration preflight')
        if kind == 'trial-start':
            self.label = f"{event['trial']['candidate']} | {event['trial']['split']} | trial {event['trial']['id']}"
            return None
        if kind == 'command':
            self.targets = {str(t['id']): t['position'] for t in event['targets']}
        elif kind == 'telemetry':
            motor = str(event['id'])
            sample = event['telemetry']
            for field in ('measuredPositionQ8', 'referencePositionQ8'):
                if field in sample and not number(sample[field]):
                    raise ValueError(f'Invalid {field}')
            self.pending[motor] = {**sample, 'capturedUnixMs': timestamp(event)}
            if not self.required.issubset(self.pending):
                return None
            # The controller emits one event per motor in a feedback pass. Publish
            # one full snapshot instead of rendering each partially updated arm.
            self.samples.update(self.pending)
            self.measured_at.update({i: s['capturedUnixMs'] for i, s in self.pending.items()})
            self.pending.clear()
        elif kind in ('error', 'run-end', 'stopped'):
            self.status = 'failed' if kind == 'error' else event.get('summary', {}).get('status', 'complete')
        else:
            return None
        if not all(str(i) in self.samples for i in range(1, 5)):
            return None
        now = timestamp(event, self.last_time if kind in ('error', 'run-end', 'stopped') else None)
        if self.last_time is not None and now < self.last_time:
            raise ValueError('Recording timestamps moved backwards')
        self.last_time = now
        measured = {i: s['measuredPositionQ8'] / 256 for i, s in self.samples.items()}
        # C1 has no planner reference. Label those axes as destination comparisons;
        # C2 (the tuning probe) retains the actual planner reference.
        reference = {i: s['referencePositionQ8'] / 256 if 'referencePositionQ8' in s else self.targets.get(i, measured[i])
                     for i, s in self.samples.items()}
        return validate_frame(copy.deepcopy({'publishedUnixMs': now, 'measuredUnixMs': self.measured_at,
            'measured': measured, 'reference': reference, 'target': self.targets,
            'referenceLabel': 'C2 planner reference / C1 destination',
            'referenceKind': {i: 'planner' if 'referencePositionQ8' in s else 'destination' for i, s in self.samples.items()},
            'telemetry': self.samples,
            'label': self.label + ' | C1: destination; C2: planner reference',
            'directory': self.directory, 'status': self.status}))


def load_recording(file, mapping):
    frames, adapter = [], Frames(Path(file).resolve(), mapping)
    with Path(file).open() as stream:
        for line in stream:
            frame = adapter.accept(json.loads(line))
            if frame:
                frames.append(frame)
    if not frames:
        raise ValueError('Recording has no complete M1–M4 telemetry')
    return frames


def check_calibration(actual, mapping):
    expected = mapping.get('encoderCalibration', {})
    for motor, settings in expected.items():
        if actual.get(motor) != settings:
            raise ValueError(f'Motor {motor}: recorded encoder calibration differs from display mapping')


def follow_recording(file, mapping):
    """Read only new complete lines. Keep a partial trailing write for next poll."""
    adapter, pending, frame = Frames(Path(file).resolve(), mapping), '', None
    with Path(file).open() as stream:
        opened = os.fstat(stream.fileno())
        while True:
            # A restarted writer must use a new recording; do not combine sessions.
            stat = Path(file).stat()
            if stat.st_ino != opened.st_ino or stat.st_size < stream.tell():
                raise ValueError('Live recording was replaced or truncated; reopen the new recording')
            pending += stream.read()
            lines = pending.split('\n')
            pending = lines.pop()
            for line in lines:
                event = json.loads(line)
                updated = adapter.accept(event)
                if updated:
                    frame = updated
            yield frame
