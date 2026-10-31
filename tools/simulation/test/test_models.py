"""Model selection, six-joint mapping and live-frame completeness."""
import copy
import hashlib
import json
import tempfile
import unittest
from pathlib import Path
import xml.etree.ElementTree as ET

import mujoco
import numpy as np

from model import MODELS, PoseMap, build_model, load_mapping
from recording import Frames, follow_recording, load_recording
from telemetry_display import Display, feed_status
from viewer import parse_args


def preflight(ids=range(1, 7)):
    return {'type': 'preflight', 'limits': {'follower': {
        str(i): {'encoderCalibration': {'positionCorrection': 0, 'resolution': 1, 'reverse': False}}
        for i in ids}}}


def telemetry(motor, time=1000):
    return {'type': 'telemetry', 'id': motor, 'timestamp': time,
            'telemetry': {'measuredPositionQ8': (2048 + motor) * 256}}


class ModelTests(unittest.TestCase):
    def test_both_models_have_nonphysical_translucent_grid_and_background(self):
        for name in MODELS:
            with self.subTest(model=name):
                model, data = build_model(model_name=name)
                floor = mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_GEOM, 'display_floor')
                self.assertGreaterEqual(floor, 0)
                self.assertEqual(model.geom_type[floor], mujoco.mjtGeom.mjGEOM_PLANE)
                self.assertEqual(model.geom_bodyid[floor], 0)
                self.assertEqual(model.geom_group[floor], 0)
                self.assertEqual(model.geom_contype[floor], 0)
                self.assertEqual(model.geom_conaffinity[floor], 0)
                material = model.geom_matid[floor]
                self.assertGreater(model.mat_rgba[material, 3], 0)
                self.assertLess(model.mat_rgba[material, 3], 1)
                background = mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_TEXTURE, 'display_background')
                self.assertEqual(model.tex_type[background], mujoco.mjtTexture.mjTEXTURE_SKYBOX)
                PoseMap(model, load_mapping(name)).apply(data, dict.fromkeys(load_mapping(name)['joints'], 2048))
                self.assertEqual(data.ncon, 0)

    def test_every_bundled_asset_matches_pinned_source(self):
        for name, spec in MODELS.items():
            with self.subTest(model=name):
                root = spec['urdf'].parent
                manifest = json.loads((root / 'source.json').read_text())
                for filename, digest in manifest['sha256'].items():
                    self.assertEqual(hashlib.sha256((root / filename).read_bytes()).hexdigest(), digest)
                for mesh in ET.parse(spec['urdf']).findall('.//mesh'):
                    self.assertTrue((root / mesh.get('filename')).is_file())

    def test_so101_reference_and_all_six_independent_axes(self):
        model, data = build_model(model_name='so101')
        pose = PoseMap(model, load_mapping('so101'))
        self.assertEqual(model.njnt, 6)
        self.assertEqual(model.neq, 0)
        counts = dict.fromkeys(pose.motors, 2048)
        pose.apply(data, counts)
        np.testing.assert_allclose(data.qpos, 0, atol=1e-12)
        for motor, joint in zip(pose.motors, pose.joint_ids):
            with self.subTest(motor=motor):
                pose.apply(data, {**counts, motor: 2112})
                expected = np.zeros(model.nq)
                expected[model.jnt_qposadr[joint]] = 64 * 2 * np.pi / 4096
                np.testing.assert_allclose(data.qpos, expected, atol=1e-12)
                self.assertTrue(np.isfinite(data.xpos).all())
        # Wrist and jaw are genuine moving bodies, not fixed visual placeholders.
        for motor in ('5', '6'):
            joint = pose.joint_ids[pose.motors.index(motor)]
            body = model.jnt_bodyid[joint]
            pose.apply(data, counts)
            orientation = data.xmat[body].copy()
            pose.apply(data, {**counts, motor: 2300})
            self.assertGreater(np.max(np.abs(data.xmat[body] - orientation)), 0.1)
        self.assertFalse(any(w.number for w in data.warning))

    def test_custom_sign_and_offset_and_missing_model_joint(self):
        model, data = build_model(model_name='so101')
        mapping = load_mapping('so101')
        mapping['joints']['5'].update(referenceCount=1000, referenceRadians=.2, radiansPerCount=-.01)
        pose = PoseMap(model, mapping)
        pose.apply(data, {**dict.fromkeys(pose.motors, 2048), '5': 1010})
        self.assertAlmostEqual(data.qpos[pose.addresses[4]], .1)
        mapping['joints']['6']['joint'] = 'missing'
        with self.assertRaisesRegex(ValueError, 'missing'):
            PoseMap(model, mapping)
        mapping = load_mapping('so101')
        del mapping['joints']['6']
        with self.assertRaisesRegex(ValueError, 'Every model joint'):
            PoseMap(model, mapping)

    def test_mapping_rejects_wrong_model_duplicates_and_invalid_units(self):
        for change in ('model', 'version', 'duplicate', 'fixed', 'scale', 'nan'):
            mapping = load_mapping('so101')
            if change == 'model': mapping['model'] = 'so102'
            if change == 'version': mapping['version'] = 1
            if change == 'duplicate': mapping['joints']['6']['joint'] = mapping['joints']['5']['joint']
            if change == 'fixed': mapping['fixedJoints']['gripper'] = 0
            if change == 'scale': mapping['joints']['1']['radiansPerCount'] = 0
            if change == 'nan': mapping['joints']['1']['referenceRadians'] = float('nan')
            with self.subTest(change=change), tempfile.TemporaryDirectory() as directory:
                file = Path(directory) / 'map.json'
                file.write_text(json.dumps(mapping))
                with self.assertRaises(ValueError): load_mapping('so101', file)

    def test_both_commands_select_model_and_default_mapping(self):
        for command in ('live', 'play'):
            args = parse_args([command, 'run.ndjson', '--model', 'so101'])
            self.assertEqual(args.model, 'so101')
            self.assertIsNone(args.mapping)
        self.assertEqual(parse_args(['play', 'run.ndjson']).model, 'so102')

    def test_so101_live_and_playback_wait_for_wrist_and_gripper(self):
        mapping = load_mapping('so101')
        with tempfile.TemporaryDirectory() as directory:
            file = Path(directory) / 'events.ndjson'
            events = [preflight()] + [telemetry(i) for i in range(1, 6)]
            file.write_text(''.join(json.dumps(e) + '\n' for e in events))
            reader = follow_recording(file, mapping)
            try:
                self.assertIsNone(next(reader))
                with file.open('a') as stream:
                    stream.write(json.dumps(telemetry(6)) + '\n')
                live = next(reader)
                self.assertEqual(live, load_recording(file, mapping)[-1])
                self.assertEqual(live['measured']['6'], 2054)
                self.assertEqual(len(live['measured']), 6)
                # Commands cannot refresh old wrist/gripper measurements.
                live['publishedUnixMs'] = 5000
                self.assertTrue(feed_status(live, 5000).startswith('STALE MOTOR'))
            finally:
                reader.close()

    def test_so101_requires_six_motors_and_honors_bound_calibration(self):
        mapping = load_mapping('so101')
        with self.assertRaisesRegex(ValueError, 'lacks motors'):
            Frames('test', mapping).accept(preflight(range(1, 5)))
        mapping['encoderCalibration']['6'] = {'positionCorrection': 123, 'resolution': 1, 'reverse': False}
        with self.assertRaisesRegex(ValueError, 'Motor 6'):
            Frames('test', mapping).accept(preflight())

    def test_unbound_mapping_rejects_scaled_or_reversed_encoders(self):
        for field, value in [('resolution', 2), ('reverse', True)]:
            event = preflight()
            event['limits']['follower']['6']['encoderCalibration'][field] = value
            with self.subTest(field=field), self.assertRaises(ValueError):
                Frames('test', load_mapping('so101')).accept(event)

    def test_frames_remain_independent_and_validate_last_axis(self):
        frames = Frames('test', load_mapping('so101'))
        frames.accept(preflight())
        for i in range(1, 7): old = frames.accept(telemetry(i))
        saved = copy.deepcopy(old)
        for i in range(1, 6): frames.accept(telemetry(i, 2000))
        bad = telemetry(6, 2000)
        bad['telemetry']['measuredPositionQ8'] = 32768 * 256
        with self.assertRaisesRegex(ValueError, 'Invalid pose'):
            frames.accept(bad)
        self.assertEqual(old, saved)

    def test_so101_display_does_not_claim_fixed_wrist_or_calibrated_map(self):
        model, _ = build_model(model_name='so101')
        display = Display(model, load_mapping('so101'))
        frames = Frames('test', load_mapping('so101'))
        frames.accept(preflight())
        for i in range(1, 7): frame = frames.accept(telemetry(i))
        heading = display.texts(frame)[0][2]
        self.assertIn('6 joints mapped', heading)
        self.assertIn('reference pose assumed', heading)
        self.assertNotIn('fixed geometry', heading)
