"""Adapt shared-controller logs to display frames; never open a serial device."""
import copy
import datetime
import json
import math
import os
import time
from pathlib import Path


def number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def validate_frame(frame):
    if not isinstance(frame, dict):
        raise ValueError("Expected telemetry object")
    if not frame.get("measured") or set(frame["measured"]) != set(frame.get("reference", {})):
        raise ValueError("Missing measured/reference positions")
    for mode in ("measured", "reference"):
        for motor in frame["measured"]:
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
        self.required = set((mapping or {}).get("joints", {}))
        self.label, self.status = '', 'running'
        self.legacy = False
        self.calibration = None
        self.last_time = None

    def accept(self, event):
        if not isinstance(event, dict):
            raise ValueError('Expected a recording event object')
        kind = event.get('type')
        if kind == 'preflight':
            self.legacy = event.get('mode') == 'legacy'
            if self.calibration is not None:
                raise ValueError('Recording contains more than one session preflight')
            self.calibration = {str(k): v.get('encoderCalibration') for k, v in event.get('limits', {}).get('follower', {}).items()}
            if not self.required.issubset(self.calibration):
                raise ValueError("Recording lacks motors required by the selected model")
            if self.mapping is not None:
                check_calibration(self.calibration, self.mapping)
            self.required.update(self.calibration)
            if not self.required:
                raise ValueError("Recording preflight has no follower motors")
            return None
        if self.calibration is None and kind in ('command', 'telemetry'):
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
        if not self.required or not self.required.issubset(self.samples):
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
            'referenceLabel': 'Legacy planner reference' if self.legacy else 'C2 planner reference / C1 destination',
            'referenceKind': {i: 'planner' if 'referencePositionQ8' in s else 'destination' for i, s in self.samples.items()},
            'telemetry': self.samples,
            'label': self.label + (' | Legacy planner reference' if self.legacy else ' | C1: destination; C2: planner reference'),
            'directory': self.directory, 'status': self.status}))


def load_recording(file, mapping):
    frames, adapter = [], Frames(Path(file).resolve(), mapping)
    with Path(file).open() as stream:
        for line in stream:
            frame = adapter.accept(json.loads(line))
            if frame:
                frames.append(frame)
    if not frames:
        raise ValueError('Recording has no complete motor telemetry')
    return frames


def check_calibration(actual, mapping):
    expected = mapping.get('encoderCalibration', {})
    for motor in mapping.get('joints', {}):
        settings = actual.get(motor)
        if not isinstance(settings, dict) or settings.get('resolution') != 1:
            raise ValueError(f'Motor {motor}: display requires unit encoder resolution')
        if settings.get('reverse') and motor not in expected:
            raise ValueError(f'Motor {motor}: reversed encoder needs an explicit calibration mapping')
    for motor, settings in expected.items():
        if actual.get(motor) != settings:
            raise ValueError(f'Motor {motor}: recorded encoder calibration differs from display mapping')


def follow_live(source, mapping):
    """Follow one file, or switch to newly created logs in a directory."""
    source = Path(source)
    if not source.is_dir():
        yield from follow_recording(source, mapping)
        return
    seen, reader, next_scan = set(), None, 0
    try:
        while True:
            now = time.monotonic()
            if now >= next_scan:
                next_scan = now + 0.25
                files = {file for file in source.glob('*.ndjson') if file.is_file()}
                new = files - seen
                seen.update(files)
                if new:
                    # Notice new filenames, not writes to older sessions. Otherwise
                    # two writers could make the viewer bounce between their logs.
                    latest = max(new, key=lambda file: (file.stat().st_mtime_ns, file.name))
                    if reader is not None:
                        reader.close()
                    reader = follow_recording(latest, mapping)
            yield next(reader) if reader is not None else None
    finally:
        if reader is not None:
            reader.close()


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
