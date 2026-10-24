"""Offline checks for freshness, unavailable fields, pose overlays and plot history."""
import copy
import json
from pathlib import Path
import unittest
import contextlib
import tempfile
import xml.etree.ElementTree as ET
from model import JOINTS

import mujoco
import numpy as np

from model import build_model, camera
from telemetry_display import Display, feed_status, validate_frame
from viewer_timing import Pacer, Timing

HERE = Path(__file__).resolve().parent


def frame():
    return {'publishedUnixMs': 10000, 'directory': 'run-a', 'label': 'test',
            'measured': {str(i): 2048 for i in range(1, 6)},
            'reference': {str(i): 2058 for i in range(1, 6)},
            'telemetry': {'2': {'sampleSequence': 1, 'sampleMs': 4, 'capturedUnixMs': 9990,
                               'appliedEffort': -13, 'requestedEffort': -20}}}


class TelemetryTests(unittest.TestCase):
    def test_fresh_finished_and_legacy(self):
        f = frame()
        self.assertEqual(feed_status(f, 10500), 'LIVE')
        self.assertTrue(feed_status(f, 13000).startswith('STALE'))
        f['finished'], f['status'] = True, 'interrupted'
        self.assertIn('interrupted', feed_status(f, 10500))
        self.assertIn('FINISHED', feed_status({'publishedUnixMs': 10000, 'label': 'complete; arm off=true'}, 10500))
        self.assertEqual(feed_status({**f, 'playback': True}), 'RECORDED PLAYBACK')
        self.assertTrue(feed_status({**frame(), 'measuredUnixMs': {'2': 7000}}, 10500).startswith('STALE MOTOR'))

    def test_bad_pose_rejected(self):
        for invalid in (float('nan'), float('inf'), True, '2048'):
            f = frame(); f['measured']['2'] = invalid
            with self.assertRaises(ValueError):
                validate_frame(f)

    def test_history_deduplicates_and_clears_between_runs(self):
        d = self.make_display(); f = frame()
        d.observe(f); d.observe(f)
        f2 = copy.deepcopy(f); f2['publishedUnixMs'] += 10
        d.observe(f2)
        self.assertEqual(len(d.history), 1)
        f2['telemetry']['2']['sampleSequence'] += 1
        d.observe(f2)
        self.assertEqual(len(d.history), 2)
        f3 = copy.deepcopy(f2); f3['directory'] = 'run-b'
        d.observe(f3)
        self.assertEqual(len(d.history), 1)
        d.observe({**f3, 'finished': True, 'publishedUnixMs': 99999})
        self.assertEqual(len(d.history), 1)

    def test_finished_feed_initializes_snapshot_charts(self):
        d = self.make_display(); f = frame(); f.update(finished=True, status='stopped')
        d.observe(f)
        self.assertEqual(len(d.history), 1)
        figures = d.chart_data()
        self.assertEqual(figures[0].linepnt[0], 1)
        self.assertIn('snapshot', figures[0].title)
        d.observe({**f, 'publishedUnixMs': 99999})
        self.assertEqual(len(d.history), 1)

    def test_chart_cache_and_command_only_updates(self):
        d = self.make_display(); f = frame()
        d.observe(f); d.chart_data()
        rebuilds = d.chart_rebuilds
        d.observe(copy.deepcopy(f)); d.chart_data()
        self.assertEqual(d.chart_rebuilds, rebuilds)
        newer = copy.deepcopy(f)
        newer['publishedUnixMs'] += 100
        newer['reference']['2'] += 12
        newer['target'] = {'2': 2200}
        self.assertTrue(d.observe(newer)); d.chart_data()
        self.assertEqual(d.chart_rebuilds, rebuilds + 1)
        self.assertEqual(d.figures[1].linedata[0, 3], 22)
        # No fabricated fresh measured sample for a command-only update.
        self.assertEqual(d.figures[0].linepnt[0], 1)
        self.assertLess(d.figures[0].linedata[0, 0], 0)
        d.selected = 3; d.chart_data()
        self.assertEqual(d.chart_rebuilds, rebuilds + 2)
        newer['directory'] = 'different-run'; d.observe(newer); d.chart_data()
        self.assertEqual(d.chart_rebuilds, rebuilds + 3)
        self.assertEqual(len(d.history), 1)

    def test_pacing_accounts_for_work_and_skips_missed_slots(self):
        p = Pacer(0)
        self.assertAlmostEqual(p.remaining(0.006), 1 / 60 - 0.006)
        wait = p.remaining(0.0501)
        self.assertGreater(p.missed, 0)
        self.assertGreater(wait, 0)
        self.assertLessEqual(wait, p.period)
        self.assertGreater(p.deadline, 0.0501 + wait)

    def test_native_charts_resubmit_for_resize_selection_and_toggle(self):
        d = self.make_display(); f = frame()
        class Viewer:
            def __init__(self):
                self.viewport = mujoco.MjrRect(0, 0, 1440, 900)
                self.user_scn = mujoco.MjvScene(d.model, maxgeom=200)
                self.cam, self.opt = camera(), mujoco.MjvOption()
                self.submissions, self.clears = 0, 0
            def lock(self): return contextlib.nullcontext()
            def set_texts(self, texts): pass
            def set_figures(self, figures): self.submissions += 1
            def clear_figures(self): self.clears += 1
        v = Viewer(); data = mujoco.MjData(d.model)
        d.update(v, data, f); d.update(v, data, copy.deepcopy(f))
        self.assertEqual(v.submissions, 1)
        self.assertFalse(v.user_scn.flags[mujoco.mjtRndFlag.mjRND_SHADOW])
        self.assertFalse(v.user_scn.flags[mujoco.mjtRndFlag.mjRND_REFLECTION])
        d.key(70); d.update(v, data, f)
        self.assertTrue(v.user_scn.flags[mujoco.mjtRndFlag.mjRND_SHADOW])
        self.assertTrue(v.user_scn.flags[mujoco.mjtRndFlag.mjRND_REFLECTION])
        self.assertEqual(v.submissions, 1)
        self.assertIn('fast view OFF', d.shortcuts())
        rebuilds = d.chart_rebuilds
        v.viewport.width = 1800; d.viewport_refresh_at -= 0.25; d.update(v, data, f)
        self.assertEqual(v.submissions, 2)
        self.assertEqual(d.chart_rebuilds, rebuilds)
        d.key(51); d.update(v, data, f)
        self.assertEqual(v.submissions, 3)
        d.key(67); d.update(v, data, f); d.update(v, data, f)
        self.assertEqual(v.clears, 1)
        d.key(67); d.update(v, data, f)
        self.assertEqual(v.submissions, 4)

    def test_diagnostics_rate_limited_and_separate_sync_from_prep(self):
        t = Timing(); t.record(1, 1.002, 1.005); t.record(1.02, 1.022, 1.025)
        text = t.summary(1.03, 3)
        self.assertIn('50.0 Hz', text)
        self.assertIn('2.00/2.00', text)
        self.assertIn('3.00/3.00', text)
        self.assertIn('missed deadlines 3', text)
        self.assertEqual(t.summary(1.1, 8), text)
        self.assertIn('missed deadlines 8', t.summary(2, 8))

    def test_retina_chart_layout_and_shortcut_states(self):
        d = self.make_display()
        rects = d.chart_layout(mujoco.MjrRect(0, 0, 2880, 2160))
        self.assertGreater(rects[0].width, 900)
        self.assertGreater(rects[0].height, 450)
        for r in rects:
            self.assertLessEqual(r.left + r.width, 2880)
            self.assertLessEqual(r.bottom + r.height, 2160)
        self.assertIn('charts ON', d.shortcuts())
        d.key(67); self.assertIn('charts OFF', d.shortcuts())
        d.key(72); self.assertNotIn('Mouse drag', d.shortcuts())

    def make_display(self):
        # Original primitive geometry: tests need no third-party CAD files.
        root = ET.Element('mujoco')
        world = ET.SubElement(root, 'worldbody')
        body = ET.SubElement(world, 'body')
        for i, name in enumerate(JOINTS):
            body = ET.SubElement(body, 'body', pos='0 0 0.05')
            ET.SubElement(body, 'joint', name=name, type='hinge' if i < 5 else 'slide', axis='0 1 0')
            for x in ('0', '0.02'):
                ET.SubElement(body, 'geom', type='sphere', size='0.01', pos=f'{x} 0 0', group='1', mass='0.1')
        with tempfile.TemporaryDirectory() as folder:
            file = Path(folder) / 'model.xml'
            ET.ElementTree(root).write(file)
            model, _ = build_model(file)
        mapping = json.loads((HERE.parent / 'encoder-angle-map.json').read_text())
        return Display(model, mapping)

    def test_signed_error_ghost_and_missing_effort(self):
        d = self.make_display(); f = frame()
        data = mujoco.MjData(d.model)
        scene = mujoco.MjvScene(d.model, maxgeom=200)
        d.overlay_scene(data, f, scene, camera(), mujoco.MjvOption())
        self.assertGreater(scene.ngeom, 8)
        self.assertTrue(any(scene.geoms[i].transparent for i in range(scene.ngeom)))
        self.assertTrue(np.isfinite(d.reference.xpos).all())
        d.observe(f); figures = d.chart_data()
        self.assertEqual(figures[1].linedata[0, 1], 10)
        self.assertEqual(figures[2].linedata[0, 1], -13)
        d.selected = 6; d.chart_data()
        self.assertIn('unavailable', d.figures[2].title)
        self.assertIn('--', d.texts(f)[2][2])


if __name__ == '__main__':
    unittest.main()
