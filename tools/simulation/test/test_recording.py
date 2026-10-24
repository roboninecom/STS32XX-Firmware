import json
from pathlib import Path
import tempfile
import unittest
from recording import Frames, follow_recording, load_recording


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
            self.assertEqual(len(load_recording(file, mapping)), 1)
            with self.assertRaisesRegex(ValueError, 'calibration'):
                load_recording(file, {'encoderCalibration': {'1': {**settings, 'positionCorrection': 20}}})

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

    def test_live_and_playback_share_frames_and_terminal_state(self):
        events = [{'type': 'preflight', 'limits': {'follower': {}}}]
        events += [telemetry(i) for i in range(1, 5)]
        events += [{'type': 'stopped', 'timestamp': 1100}]
        with tempfile.TemporaryDirectory() as directory:
            file = Path(directory) / 'events.ndjson'
            file.write_text(''.join(json.dumps(e) + '\n' for e in events))
            reader = follow_recording(file, {})
            try:
                self.assertEqual(next(reader), load_recording(file, {})[-1])
                self.assertEqual(next(reader)['status'], 'complete')
            finally:
                reader.close()

    def test_missing_calibration_and_invalid_json_fail_both_readers(self):
        for content, message in [
            (json.dumps(telemetry(1)) + '\n', 'calibration preflight'),
            ('{broken}\n', 'property name'),
            ('[]\n', 'event object'),
            ('{"type":"preflight"}\n{"type":"preflight"}\n', 'more than one session'),
        ]:
            with self.subTest(content=content), tempfile.TemporaryDirectory() as directory:
                file = Path(directory) / 'events.ndjson'
                file.write_text(content)
                with self.assertRaisesRegex(ValueError, message):
                    load_recording(file, {})
                reader = follow_recording(file, {})
                try:
                    with self.assertRaisesRegex(ValueError, message):
                        next(reader)
                finally:
                    reader.close()

    def test_live_replacement_or_truncation_rejected(self):
        for replace in (False, True):
            with self.subTest(replace=replace), tempfile.TemporaryDirectory() as directory:
                file = Path(directory) / 'events.ndjson'
                file.write_text(json.dumps({'type': 'preflight', 'limits': {'follower': {}}}) + '\n')
                reader = follow_recording(file, {})
                self.assertIsNone(next(reader))
                if replace:
                    other = Path(directory) / 'new.ndjson'
                    other.write_text('')
                    other.replace(file)
                else:
                    file.write_text('')
                try:
                    with self.assertRaisesRegex(ValueError, 'replaced or truncated'):
                        next(reader)
                finally:
                    reader.close()

    def test_command_updates_do_not_make_old_measurements_fresh(self):
        from telemetry_display import feed_status
        frames = Frames('test')
        for i in range(1, 5):
            frames.accept(telemetry(i))
        frame = frames.accept({'type': 'command', 'timestamp': 5000, 'targets': [{'id': 1, 'position': 2500}]})
        self.assertTrue(feed_status(frame, 5000).startswith('STALE MOTOR'))

    def test_boolean_and_out_of_range_positions_are_rejected(self):
        for value in [True, 32768 * 256]:
            frames = Frames('test')
            for i in range(1, 4):
                frames.accept(telemetry(i))
            event = telemetry(4)
            event['telemetry']['measuredPositionQ8'] = value
            with self.assertRaises(ValueError):
                frames.accept(event)


if __name__ == '__main__':
    unittest.main()
