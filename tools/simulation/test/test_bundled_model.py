"""The checked-in model must work without external assets or prepared files."""
import contextlib
import hashlib
import io
import json
from pathlib import Path
import tempfile
import unittest
import xml.etree.ElementTree as ET

import mujoco
import numpy as np

from model import HERE, prepare, build_model, apply_pose

SOURCE = HERE / "urdf"


class BundledModelTests(unittest.TestCase):
    def test_source_hashes_and_all_referenced_meshes(self):
        root = SOURCE
        manifest = json.loads((root / 'source.json').read_text())
        for relative, expected in manifest["sha256"].items():
            self.assertEqual(hashlib.sha256((root / relative).read_bytes()).hexdigest(), expected, relative)
        mesh_names = {Path(mesh.get('filename')).name for mesh in ET.parse(SOURCE / 'so_arm_102.urdf').findall('.//mesh')}
        self.assertEqual(len(mesh_names), 8)
        for name in mesh_names:
            self.assertTrue((SOURCE / 'meshes' / name).is_file())

    def test_clean_import_and_jaw_coupling(self):
        with tempfile.TemporaryDirectory() as directory, contextlib.redirect_stdout(io.StringIO()):
            build = Path(directory)
            preview = prepare(build=build)
            model, data = build_model(preview)
            self.assertEqual(model.njnt, 7)
            # MuJoCo's XML export rounds inertial values to six significant digits.
            self.assertAlmostEqual(float(model.body_mass.sum()), 0.8885166973026, delta=2e-6)
            self.assertEqual(model.ngeom, 8)  # Visual meshes only, no collision boxes.
            self.assertEqual(model.neq, 1)
            for _ in range(1000):
                mujoco.mj_step(model, data)
            self.assertTrue(np.isfinite(data.qpos).all())
            self.assertFalse(any(w.number for w in data.warning))

    def test_recorded_poses_keep_joint_locations_after_cad_zero_change(self):
        # World joint locations captured from the previous model and confirmed
        # encoder map. New CAD reference angles must not rotate recorded poses.
        cases = [
            ([2048, 2048, 2048, 2048], [
                [-.006, 0, .025], [.034, -.018, .098357],
                [.039947969, .018, .211201357], [.176098927, .018, .240104332],
                [.235209711, -.000001, .236966412]]),
            ([2055, 968, 3108, 876], [
                [-.006, 0, .025], [.033804416, -.018428469, .098357],
                [-.078741093, .018782152, .094601294], [.056451408, .017330417, .127667072],
                [.044227799, -.000540360, .185625556]]),
            ([1159, 2532, 2033, 1548], [
                [-.006, 0, .025], [.019839827, .035444370, .098357],
                [.001196792, .121798427, .177481213], [.026169316, .240658940, .109503151],
                [.055956428, .294886146, .109178638]]),
        ]
        mapping = json.loads((HERE / 'encoder-angle-map.json').read_text())
        with tempfile.TemporaryDirectory() as directory, contextlib.redirect_stdout(io.StringIO()):
            model, data = build_model(prepare(build=directory))
            for counts, expected in cases:
                apply_pose(model, data, {str(i + 1): v for i, v in enumerate(counts)}, mapping)
                # Both exports round geometry; two micrometres allows that loss.
                np.testing.assert_allclose(data.xanchor[:5], expected, atol=2e-6, rtol=0)
                self.assertAlmostEqual(data.qpos[5], -data.qpos[6])
                self.assertTrue(np.all(data.qpos[5:] >= model.jnt_range[5:, 0]))
                self.assertTrue(np.all(data.qpos[5:] <= model.jnt_range[5:, 1]))
                equality_rows = data.efc_type == mujoco.mjtConstraint.mjCNSTR_EQUALITY
                self.assertEqual(int(equality_rows.sum()), 1)
                np.testing.assert_allclose(data.efc_pos[equality_rows], 0, atol=1e-12)


if __name__ == '__main__':
    unittest.main()
