import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from recording import Frames, follow_live, follow_recording, load_recording


def preflight(ids=range(1, 5)):
    return {"type": "preflight", "limits": {"follower": {str(i): {} for i in ids}}}


def ready_frames():
    frames = Frames("test")
    frames.accept(preflight())
    return frames


def telemetry(motor, timestamp=1000, reference=None):
    sample = {'measuredPositionQ8': (2000 + motor) * 256, 'sampleSequence': 1, 'sampleMs': 1}
    if reference is not None:
        sample['referencePositionQ8'] = reference * 256
    return {'type': 'telemetry', 'timestamp': timestamp, 'id': motor, 'telemetry': sample}


class RecordingTests(unittest.TestCase):
    def test_legacy_log_uses_intermediate_reference_and_correct_label(self):
        frames = Frames('legacy')
        frames.accept({**preflight(ids=[1]), 'mode': 'legacy'})
        frames.accept({'type': 'command', 'timestamp': 1000, 'targets': [{'id': 1, 'position': 3000}]})
        frame = frames.accept({'type': 'telemetry', 'timestamp': 1001, 'id': 1,
                               'telemetry': {'measuredPositionQ8': 2000 * 256,
                                             'referencePositionQ8': 2010 * 256,
                                             'appliedEffort': 30, 'faults': 0}})
        self.assertEqual(frame['measured']['1'], 2000)
        self.assertEqual(frame['reference']['1'], 2010)
        self.assertEqual(frame['target']['1'], 3000)
        self.assertEqual(frame['referenceLabel'], 'Legacy planner reference')
        self.assertEqual(frame['referenceKind']['1'], 'planner')

    def write_session(self, file, position=2000, stamp=1000):
        events = [preflight()]
        for i in range(1, 5):
            event = telemetry(i, stamp)
            event['telemetry']['measuredPositionQ8'] = (position + i) * 256
            events.append(event)
        file.write_text(''.join(json.dumps(e) + '\n' for e in events))

    def test_live_directory_waits_then_switches_without_mixing_sessions(self):
        with tempfile.TemporaryDirectory() as folder, patch('recording.time.monotonic', side_effect=range(20)):
            root = Path(folder)
            reader = follow_live(root, {})
            try:
                self.assertIsNone(next(reader))
                first = root / 'first.ndjson'
                self.write_session(first)
                self.assertEqual(next(reader)['measured']['1'], 2001)
                second = root / 'second.ndjson'
                second.write_text('')
                self.assertIsNone(next(reader))  # Never present the old session as the new one.
                self.write_session(second, 2500, 500)  # A new run has independent timestamps.
                frame = next(reader)
                self.assertEqual(frame['measured']['1'], 2501)
                self.assertEqual(frame['directory'], str(second.resolve()))
                with first.open('a') as stream:
                    stream.write(json.dumps({'type': 'stopped', 'timestamp': 2000}) + '\n')
                self.assertEqual(next(reader)['directory'], str(second.resolve()))
            finally:
                reader.close()

    def test_live_directory_opens_newest_existing_log_and_ignores_other_files(self):
        import os
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            first, second = root / 'a.ndjson', root / 'b.ndjson'
            self.write_session(first)
            self.write_session(second, 2200)
            os.utime(first, ns=(1, 1))
            (root / 'notes.json').write_text('not telemetry')
            reader = follow_live(root, {})
            try:
                self.assertEqual(next(reader)['directory'], str(second.resolve()))
            finally:
                reader.close()

    def test_explicit_live_file_stays_pinned_when_new_logs_appear(self):
        with tempfile.TemporaryDirectory() as folder:
            file = Path(folder) / 'one.ndjson'
            self.write_session(file)
            reader = follow_live(file, {})
            try:
                first = next(reader)
                self.write_session(Path(folder) / 'two.ndjson', 2500)
                self.assertEqual(next(reader), first)
            finally:
                reader.close()

    def test_shadow_follows_planner_samples_instead_of_new_destination(self):
        f = Frames('test')
        f.accept(preflight(range(1, 7)))
        for motor in range(1, 7):
            f.accept(telemetry(motor, 1000, 2000))
        command = f.accept({'type': 'command', 'timestamp': 1001,
                            'targets': [{'id': i, 'position': 3000} for i in range(1, 7)]})
        self.assertEqual(set(command['reference'].values()), {2000})
        self.assertEqual(set(command['target'].values()), {3000})
        for now, position in [(1050, 2010), (1100, 2040), (1150, 2090)]:
            for motor in range(1, 7):
                frame = f.accept(telemetry(motor, now, position))
            self.assertEqual(set(frame['reference'].values()), {position})
            self.assertEqual(set(frame['referenceKind'].values()), {'planner'})
            self.assertEqual(set(frame['target'].values()), {3000})

    def test_mixed_c1_c2_fields_and_original_sample_times(self):
        f = ready_frames()
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
        f.accept(preflight(range(1, 7)))
        for i in range(1, 6):
            self.assertIsNone(f.accept(telemetry(i)))
        self.assertEqual(len(f.accept(telemetry(6))['measured']), 6)
        f.accept(telemetry(1, 1100))
        command = f.accept({'type': 'command', 'timestamp': 1110, 'targets': [{'id': 1, 'position': 2100}]})
        self.assertEqual(command['measuredUnixMs']['1'], 1000)

    def test_partial_lines_and_calibration_mismatch(self):
        settings = {'positionCorrection': 0, 'resolution': 1, 'reverse': False}
        pre = preflight()
        pre['limits']['follower']['1']['encoderCalibration'] = settings
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
        f = ready_frames()
        for i in range(1, 5):
            f.accept(telemetry(i))
        for i in range(1, 4):
            f.accept(telemetry(i, 999))
        with self.assertRaises(ValueError):
            f.accept(telemetry(4, 999))
        with self.assertRaises(ValueError):
            f.accept(telemetry(1, float('nan')))

    def test_live_and_playback_share_frames_and_terminal_state(self):
        events = [preflight()]
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
            (json.dumps(preflight()) + '\n' + json.dumps(preflight()) + '\n', 'more than one session'),
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
                file.write_text(json.dumps(preflight()) + '\n')
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
        frames = ready_frames()
        for i in range(1, 5):
            frames.accept(telemetry(i))
        frame = frames.accept({'type': 'command', 'timestamp': 5000, 'targets': [{'id': 1, 'position': 2500}]})
        self.assertTrue(feed_status(frame, 5000).startswith('STALE MOTOR'))

    def test_boolean_and_out_of_range_positions_are_rejected(self):
        for value in [True, 32768 * 256]:
            frames = ready_frames()
            for i in range(1, 4):
                frames.accept(telemetry(i))
            event = telemetry(4)
            event['telemetry']['measuredPositionQ8'] = value
            with self.assertRaises(ValueError):
                frames.accept(event)


if __name__ == '__main__':
    unittest.main()
