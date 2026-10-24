import contextlib
import io
import unittest
from viewer import parse_args, Playback


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
