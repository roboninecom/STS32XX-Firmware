import contextlib
import io
import unittest
from unittest.mock import patch
from viewer import parse_args, Playback, launch_macos


class ViewerTests(unittest.TestCase):
    def test_two_commands_and_only_useful_options(self):
        self.assertEqual(parse_args(['live', 'events.ndjson']).command, 'live')
        args = parse_args(['play', 'events.ndjson', '--render', 'pose.png'])
        self.assertEqual(str(args.render), 'pose.png')
        for args in [[], ['--follow', 'events.ndjson'], ['live', 'events.ndjson', '--render', 'pose.png'],
                     ['play', 'events.ndjson', '--model', 'model.xml']]:
            with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
                parse_args(args)

    def test_playback_preserves_gaps_and_skips_rendering_missed_frames(self):
        frames = [{'publishedUnixMs': t, 'index': i} for i, t in enumerate([100, 150, 1000, 1010])]
        play, history = Playback(frames), []
        self.assertEqual(play.at(0, history.append)['index'], 0)
        self.assertEqual(play.at(899, history.append)['index'], 1)
        last = play.at(2000, history.append)
        self.assertEqual(last['index'], 3)
        self.assertTrue(last['playbackFinished'])
        self.assertEqual([f['index'] for f in history], [0, 1, 2])
        play.at(3000, history.append)
        self.assertEqual(len(history), 3)


class LauncherTests(unittest.TestCase):
    def test_macos_paths_with_spaces_are_separate_arguments(self):
        argv = ['play', '/path with spaces/log.ndjson', '--model', 'so101']
        executable = '/venv with spaces/bin/python'
        with patch('viewer.sys.platform', 'darwin'), patch('viewer.sys.executable', executable), \
             patch.dict('viewer.os.environ', {}, clear=True), patch('viewer.Path.is_file', return_value=True), \
             patch('viewer.os.execv') as execute:
            launch_macos(parse_args(argv), argv)
            binary, arguments = execute.call_args.args
            self.assertEqual(binary, executable)
            self.assertEqual(arguments[1], '/venv with spaces/bin/mjpython')
            self.assertEqual(arguments[3:], argv)

    def test_render_other_platforms_and_existing_launcher_do_not_relaunch(self):
        for platform, environment, argv in [
            ('linux', {}, ['live', 'log.ndjson']),
            ('darwin', {'MJPYTHON_BIN': 'native launcher'}, ['play', 'log.ndjson']),
            ('darwin', {}, ['play', 'log.ndjson', '--render', 'out.png']),
        ]:
            with self.subTest(platform=platform, argv=argv), patch('viewer.sys.platform', platform), \
                 patch.dict('viewer.os.environ', environment, clear=True), patch('viewer.os.execv') as execute:
                launch_macos(parse_args(argv), argv)
                execute.assert_not_called()
