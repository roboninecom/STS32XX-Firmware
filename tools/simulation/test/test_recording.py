import json
from pathlib import Path
import tempfile
import unittest
from recording import Frames, follow_recording, load_recording, validate_calibration


def telemetry(motor, timestamp=1000, reference=None):
    sample = {'measuredPositionQ8': (2000 + motor) * 256, 'sampleSequence': 1, 'sampleMs': 1}
    if reference is not None:
        sample['referencePositionQ8'] = reference * 256
    return {'type': 'telemetry', 'timestamp': timestamp, 'id': motor, 'telemetry': sample}


class RecordingTests(unittest.TestCase):
    def test_mixed_c1_c2_fields_and_original_sample_times(self):
        f = Frames('test')
        f.accept({'type': 'command', 'timestamp': 999, 'targets': [{'id': 2, 'position': 2100}]})
        for motor in range(1, 5):
            frame = f.accept(telemetry(motor, 1000 + motor, 2050 if motor == 1 else None))
        self.assertEqual(frame['reference']['1'], 2050)
        self.assertEqual(frame['reference']['2'], 2100)
        self.assertEqual(frame['referenceKind']['1'], 'planner')
        self.assertEqual(frame['referenceKind']['2'], 'destination')
        ended = f.accept({'type': 'run-end', 'timestamp': 1200, 'summary': {'status': 'complete'}})
        self.assertEqual(ended['measuredUnixMs']['1'], 1001)
        self.assertEqual(ended['status'], 'complete')
        self.assertEqual(frame['status'], 'running')
        terminal = f.accept({'type': 'stopped'})
        self.assertEqual(terminal['publishedUnixMs'], 1200)
        self.assertEqual(terminal['measuredUnixMs']['1'], 1001)

    def test_only_complete_feedback_passes_update_measured_poses(self):
        f = Frames('test')
        f.accept({'type': 'preflight', 'limits': {'follower': {str(i): {} for i in range(1, 7)}}})
        for i in range(1, 6):
            self.assertIsNone(f.accept(telemetry(i)))
        self.assertEqual(len(f.accept(telemetry(6))['measured']), 6)
        f.accept(telemetry(1, 1100))
        command = f.accept({'type': 'command', 'timestamp': 1110, 'targets': [{'id': 1, 'position': 2100}]})
        self.assertEqual(command['measuredUnixMs']['1'], 1000)

    def test_partial_lines_and_calibration_mismatch(self):
        settings = {'positionCorrection': 0, 'resolution': 1, 'reverse': False}
        pre = {'type': 'preflight', 'limits': {'follower': {'1': {'encoderCalibration': settings}}}}
        mapping = {'encoderCalibration': {'1': settings}}
        with tempfile.TemporaryDirectory() as folder:
            file = Path(folder) / 'events.ndjson'
            file.write_text(json.dumps(pre) + '\n')
            validate_calibration(file, mapping)
            reader = follow_recording(file, mapping)
            self.assertIsNone(next(reader))
            raw = '\n'.join(json.dumps(telemetry(i)) for i in range(1, 5)) + '\n'
            with file.open('a') as stream:
                stream.write(raw[:-6])
            self.assertIsNone(next(reader))
            with file.open('a') as stream:
                stream.write(raw[-6:])
            self.assertEqual(next(reader)['measured']['4'], 2004)
            reader.close()
            self.assertEqual(len(load_recording(file)), 1)
            with self.assertRaisesRegex(ValueError, 'calibration'):
                validate_calibration(file, {'encoderCalibration': {'1': {**settings, 'positionCorrection': 20}}})

    def test_backwards_and_nonfinite_times_are_rejected(self):
        f = Frames('test')
        for i in range(1, 5):
            f.accept(telemetry(i))
        for i in range(1, 4):
            f.accept(telemetry(i, 999))
        with self.assertRaises(ValueError):
            f.accept(telemetry(4, 999))
        with self.assertRaises(ValueError):
            f.accept(telemetry(1, float('nan')))


if __name__ == '__main__':
    unittest.main()
