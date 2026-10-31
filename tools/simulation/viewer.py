"""Read-only live/recorded telemetry viewer; never connect to the arm."""
import argparse
import math
import os
import sys
from pathlib import Path
import time

import mujoco
import numpy as np

from model import build_model, camera, load_mapping, MODELS, write_png
from telemetry_display import Display, copy_geom
from recording import load_recording, follow_live


class Pacer:
    def __init__(self, start, hz=60):
        self.period = 1 / hz
        self.deadline = start + self.period

    def remaining(self, now):
        # Skip elapsed slots instead of running catch-up bursts.
        if now > self.deadline:
            slots = math.floor((now - self.deadline) / self.period) + 1
            self.deadline += slots * self.period
        delay = max(0, self.deadline - now)
        self.deadline += self.period
        return delay


def render(display, data, frame, path):
    """Offscreen layout check using the same scene, texts and figures as the viewer."""
    display.observe(frame)
    display.pose.apply(data, frame[display.mode])
    cam, opt = camera(display.mapping["model"]), mujoco.MjvOption()
    overlay = mujoco.MjvScene(display.model, maxgeom=200)
    display.overlay_scene(data, frame, overlay, cam, opt)
    with mujoco.Renderer(display.model, height=900, width=1440) as renderer:
        renderer.update_scene(data, camera=cam)
        display.render_settings(renderer.scene)
        for i in range(overlay.ngeom):
            src, dst = overlay.geoms[i], renderer.scene.geoms[renderer.scene.ngeom]
            copy_geom(src, dst)
            renderer.scene.ngeom += 1
        # Draw once, then add overlays before the single pixel readback.
        context = renderer._mjr_context
        rect = mujoco.MjrRect(0, 0, 1440, 900)
        mujoco.mjr_render(rect, renderer.scene, context)
        for font, grid, left, right in display.texts(frame):
            mujoco.mjr_overlay(font, grid, rect, left, right, context)
        if display.charts:
            for chart_rect, figure in zip(display.chart_layout(rect), reversed(display.chart_data())):
                mujoco.mjr_figure(chart_rect, figure, context)
        rgb = np.empty((900, 1440, 3), dtype=np.uint8)
        mujoco.mjr_readPixels(rgb, None, rect, context)
        write_png(path, np.flipud(rgb))


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    for command, help_text in [('live', 'Watch a controller log or switch between new logs in a directory'),
                               ('play', 'Replay a saved controller log')]:
        sub = commands.add_parser(command, help=help_text)
        sub.add_argument('recording', type=Path, help='Log file or directory of .ndjson logs' if command == 'live'
                         else 'Replay, teleoperation or tuning events.ndjson')
        sub.add_argument('--model', choices=MODELS, default='so102', help='Arm geometry (default: so102)')
        sub.add_argument('--mapping', type=Path, help='Override the selected model’s encoder map')
        if command == 'play':
            sub.add_argument('--render', type=Path, help='Save a preview PNG instead of opening a window')
    return parser.parse_args(argv)


class Playback:
    """Select recorded frames by elapsed time, preserving gaps without catch-up renders."""
    def __init__(self, frames):
        self.frames, self.index = frames, 0
        self.start = frames[0]['publishedUnixMs']

    def at(self, elapsed_ms, observe):
        while self.index + 1 < len(self.frames) and self.frames[self.index + 1]['publishedUnixMs'] - self.start <= elapsed_ms:
            observe(self.frames[self.index])
            self.index += 1
        return {**self.frames[self.index], 'playback': True,
                'playbackFinished': self.index + 1 == len(self.frames)}


def view(display, data, recording, mapping, frames=None, duration=None):
    import mujoco.viewer
    follower = follow_live(recording, mapping) if frames is None else None
    playback = Playback(frames) if frames is not None else None
    try:
        with mujoco.viewer.launch_passive(display.model, data, key_callback=display.key,
                                         show_left_ui=False, show_right_ui=False) as viewer:
            with viewer.lock():
                display.render_settings(viewer.user_scn)
                cam = camera(display.mapping["model"])
                viewer.cam.lookat[:] = cam.lookat
                viewer.cam.distance, viewer.cam.azimuth, viewer.cam.elevation = cam.distance, cam.azimuth, cam.elevation
            print('1–6 motor; G ghost; C charts; J markers; F quality; H help; M/R measured/reference.', flush=True)
            start = time.monotonic()
            pacer = Pacer(start)
            while viewer.is_running():
                elapsed = time.monotonic() - start
                if duration is not None and elapsed >= duration:
                    break
                # Invalid log data terminates the view instead of displaying a frozen
                # pose as live or retrying an exhausted generator.
                frame = playback.at(elapsed * 1000, display.observe) if playback else next(follower)
                if frame:
                    display.update(viewer, data, frame)
                else:
                    viewer.clear_figures()
                    viewer.set_texts((None, mujoco.mjtGridPos.mjGRID_TOPLEFT,
                                      'WAITING FOR TELEMETRY | no robot connection\n\n' + display.shortcuts(), ''))
                viewer.sync()
                time.sleep(pacer.remaining(time.monotonic()))
    finally:
        if follower is not None:
            follower.close()


def launch_macos(args, argv):
    """Use MuJoCo's Cocoa launcher without depending on its space-sensitive shebang."""
    if sys.platform != 'darwin' or getattr(args, 'render', None) or os.environ.get('MJPYTHON_BIN'):
        return
    launcher = Path(sys.executable).with_name('mjpython')
    if not launcher.is_file():
        raise ValueError('Install the simulation requirements in this Python environment')
    os.execv(sys.executable, [sys.executable, str(launcher), str(Path(__file__).resolve()), *argv])


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    args = parse_args(argv)
    launch_macos(args, argv)
    mapping = load_mapping(args.model, args.mapping)
    frames = load_recording(args.recording, mapping) if args.command == 'play' else None
    model, data = build_model(model_name=args.model)
    model.vis.global_.offwidth, model.vis.global_.offheight = 1440, 900
    display = Display(model, mapping)
    if args.command == 'play' and args.render:
        motor = str(display.selected)
        index = max(range(len(frames)), key=lambda i: abs(frames[i]['reference'].get(motor, 0) - frames[i]['measured'].get(motor, 0)))
        for frame in frames[:index + 1]:
            display.observe(frame)
        render(display, data, {**frames[index], 'playback': True}, args.render)
        print(f'Saved {args.render} ({len(frames)} recorded frames)')
    else:
        view(display, data, args.recording, mapping, frames)


if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        pass
    except (OSError, ValueError, KeyError, TypeError) as error:
        raise SystemExit(f'Viewer: {error}') from error
