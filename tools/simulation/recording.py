"""Adapt shared-controller logs to display frames; never open a serial device."""
import copy
import datetime
import json
import math
from pathlib import Path


def timestamp(event, fallback=None):
    value = event.get('wallTime')
    if value:
        return datetime.datetime.fromisoformat(value.replace('Z', '+00:00')).timestamp() * 1000
    value = event.get('timestamp', event.get('hostMs', fallback))
    if not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError('Recording event lacks a timestamp')
    return value


class Frames:
    def __init__(self, directory):
        self.directory = str(directory)
        self.samples, self.measured_at, self.targets = {}, {}, {}
        self.pending = {}
        self.required = {str(i) for i in range(1, 5)}
        self.label, self.status = '', 'running'
        self.calibration = None
        self.last_time = None

    def accept(self, event):
        kind = event.get('type')
        if kind == 'preflight':
            self.calibration = {str(k): v.get('encoderCalibration') for k, v in event.get('limits', {}).get('follower', {}).items()}
            self.required.update(self.calibration)
            return None
        if kind == 'trial-start':
            self.label = f"{event['trial']['candidate']} | {event['trial']['split']} | trial {event['trial']['id']}"
            return None
        if kind == 'command':
            self.targets = {str(t['id']): t['position'] for t in event['targets']}
        elif kind == 'telemetry':
            motor = str(event['id'])
            sample = event['telemetry']
            if not math.isfinite(sample['measuredPositionQ8']):
                raise ValueError('Nonfinite measured position')
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
        return copy.deepcopy({'version': 2, 'publishedUnixMs': now, 'measuredUnixMs': self.measured_at,
            'measured': measured, 'reference': reference, 'target': self.targets, 'goal': {},
            'referenceLabel': 'C2 planner reference / C1 destination',
            'referenceKind': {i: 'planner' if 'referencePositionQ8' in s else 'destination' for i, s in self.samples.items()},
            'telemetry': self.samples, 'liveIds': [int(i) for i in self.samples],
            'label': self.label + ' | C1: destination; C2: planner reference',
            'directory': self.directory, 'status': self.status, 'encoderCalibration': self.calibration})


def load_recording(file):
    frames, adapter = [], Frames(Path(file).resolve())
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


def validate_calibration(file, mapping):
    with Path(file).open() as stream:
        for line in stream:
            event = json.loads(line)
            if event.get('type') == 'preflight':
                actual = {str(k): v.get('encoderCalibration') for k, v in event['limits']['follower'].items()}
                check_calibration(actual, mapping)
                return
    raise ValueError('Recording lacks calibration preflight')


def follow_recording(file, mapping):
    """Read only new complete lines. Keep a partial trailing write for next poll."""
    adapter, pending, frame = Frames(Path(file).resolve()), '', None
    with Path(file).open() as stream:
        while True:
            pending += stream.read()
            lines = pending.split('\n')
            pending = lines.pop()
            for line in lines:
                event = json.loads(line)
                updated = adapter.accept(event)
                if event.get('type') == 'preflight':
                    check_calibration(adapter.calibration, mapping)
                if updated:
                    if adapter.calibration is None:
                        raise ValueError('Recording lacks calibration preflight')
                    frame = updated
            yield frame
