"""The checked-in model must work without the old workspace or generated files."""
import contextlib
import hashlib
import io
import json
from pathlib import Path
import tempfile
import unittest
import xml.etree.ElementTree as ET

from prepare_so102 import SOURCE, prepare
from run_demo import build_demo, check
from model import build_model


class BundledModelTests(unittest.TestCase):
    def test_source_hashes_and_all_referenced_meshes(self):
        root = SOURCE.parent
        manifest = json.loads((root / 'source-hashes.json').read_text())
        for relative, expected in manifest.items():
            self.assertEqual(hashlib.sha256((root / relative).read_bytes()).hexdigest(), expected, relative)
        mesh_names = {Path(mesh.get('filename')).name for mesh in ET.parse(SOURCE / 'urdf/so-arm.urdf').findall('.//mesh')}
        self.assertEqual(len(mesh_names), 8)
        for name in mesh_names:
            self.assertTrue((SOURCE / 'meshes' / name).is_file())

    def test_clean_import_and_twenty_second_demo(self):
        with tempfile.TemporaryDirectory() as directory, contextlib.redirect_stdout(io.StringIO()):
            build = Path(directory)
            preview = prepare(build=build)
            model, _ = build_model(preview)
            self.assertEqual(model.njnt, 7)
            self.assertAlmostEqual(float(model.body_mass.sum()), 1.225, places=6)
            model, data = build_demo(build=build)
            check(model, data, build)
            report = json.loads((build / 'demo-check.json').read_text())
            self.assertEqual(report['warnings'], 0)
            self.assertAlmostEqual(report['seconds'], 20, places=6)


if __name__ == '__main__':
    unittest.main()
