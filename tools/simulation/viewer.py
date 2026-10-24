"""Read-only live/recorded telemetry viewer; never connect to the arm."""
import argparse
import json
from pathlib import Path
import time

import mujoco
import numpy as np

from model import apply_pose, build_model, camera, HERE, write_png
from telemetry_display import Display, validate_frame, feed_status
from viewer_timing import Pacer, Timing
from recording import load_recording, follow_recording, validate_calibration


def read_frame(file):
    return validate_frame(json.loads(Path(file).read_text()))


def render(display, data, frame, path):
    """Offscreen layout check using the same scene, texts and figures as the viewer."""
    display.observe(frame)
    apply_pose(display.model, data, frame[display.mode], display.mapping)
    cam, opt = camera(), mujoco.MjvOption()
    overlay = mujoco.MjvScene(display.model, maxgeom=200)
    display.overlay_scene(data, frame, overlay, cam, opt)
    with mujoco.Renderer(display.model, height=900, width=1440) as renderer:
        renderer.update_scene(data, camera=cam)
        display.render_settings(renderer.scene)
        for i in range(overlay.ngeom):
            src, dst = overlay.geoms[i], renderer.scene.geoms[renderer.scene.ngeom]
            mujoco.mjv_initGeom(dst, src.type, src.size, src.pos, src.mat.reshape(-1), src.rgba)
            for key in ('dataid', 'matid', 'texid', 'texcoord', 'texuniform', 'modelrbound', 'transparent', 'label'):
                setattr(dst, key, getattr(src, key))
            renderer.scene.ngeom += 1
        renderer.render()
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


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument('--feed', type=Path)
    source.add_argument('--recording', type=Path, help='Current replay, teleoperation or tuning events.ndjson')
    parser.add_argument('--check', action='store_true')
    parser.add_argument('--render', type=Path)
    parser.add_argument('--motor', type=int, choices=range(1, 7), default=2)
    parser.add_argument('--quality', action='store_true', help='Start with shadows and reflections; F toggles fast view')
    parser.add_argument('--duration', type=float, help='Close this display after N seconds (hardware is unaffected)')
    parser.add_argument('--model', type=Path, required=True, help='Prepared SO-102 MJCF')
    parser.add_argument('--mapping', type=Path, default=HERE / 'encoder-angle-map.json')
    parser.add_argument('--follow', action='store_true', help='Follow an actively growing recording without touching the bus')
    args = parser.parse_args()
    if args.follow and (not args.recording or args.check or args.render):
        parser.error('--follow requires --recording and a live window')
    mapping = json.loads(args.mapping.read_text())
    if args.recording and not args.follow:
        validate_calibration(args.recording, mapping)
    model, data = build_model(args.model)
    model.vis.global_.offwidth, model.vis.global_.offheight = 1440, 900
    display = Display(model, mapping)
    display.selected = args.motor
    display.fast_view = not args.quality
    frames = load_recording(args.recording) if args.recording and not args.follow else None
    follower = follow_recording(args.recording, mapping) if args.follow else None
    if args.check or args.render:
        checked = frames or [read_frame(args.feed)]
        for frame in checked:
            apply_pose(model, data, frame['measured'], mapping)
            apply_pose(model, display.reference, frame['reference'], mapping)
            assert np.isfinite(data.xpos).all() and np.isfinite(display.reference.xpos).all()
            display.observe(frame)
        display.chart_data()
        frame = {**checked[-1], "playback": True} if frames else checked[-1]
        if args.render:
            frame = max(checked, key=lambda f: abs(f['reference']['2'] - f['measured']['2']))
            frame = {**frame, "playback": True} if frames else frame
            # Populate history preceding the preview sample, not from unrelated later poses.
            display.history.clear(); display.last_key = None
            for prior in checked:
                if prior['publishedUnixMs'] > frame['publishedUnixMs']:
                    break
                display.observe(prior)
            render(display, data, frame, args.render)
        print(json.dumps({'frames': len(checked), 'connected_to_robot': False,
                          'physics_stepped': False, 'status': feed_status(frame),
                          'detailed_motors': list(frame.get('telemetry', {})),
                          'render': str(args.render) if args.render else None}))
        return
    import mujoco.viewer
    with mujoco.viewer.launch_passive(model, data, key_callback=display.key,
                                     show_left_ui=False, show_right_ui=False) as viewer:
        with viewer.lock():
            display.render_settings(viewer.user_scn)
            cam = camera()
            viewer.cam.lookat[:] = cam.lookat
            viewer.cam.distance, viewer.cam.azimuth, viewer.cam.elevation = cam.distance, cam.azimuth, cam.elevation
        print('Telemetry display: 1-6 motor; G ghost; C charts; J labels; F fast view; H help; M/R measured/reference. No serial connection.', flush=True)
        frame, start = None, time.monotonic()
        pacer, timing = Pacer(start), Timing()
        index = 0
        if frames:
            relative = [f['publishedUnixMs'] - frames[0]['publishedUnixMs'] for f in frames]
        while viewer.is_running():
            loop_started = time.monotonic()
            if args.duration is not None and time.monotonic() - start >= args.duration:
                break
            read_error = None
            if frames:
                elapsed = (time.monotonic() - start) * 1000
                while index + 1 < len(frames) and relative[index + 1] <= elapsed:
                    display.observe(frames[index])
                    index += 1
                frame = {**frames[index], 'playback': True, 'playbackFinished': index + 1 == len(frames)}
            else:
                try:
                    frame = next(follower) if follower else read_frame(args.feed)
                except (OSError, ValueError, KeyError, TypeError) as error:
                    read_error = str(error)
            if frame:
                display.diagnostics = timing.summary(loop_started, pacer.missed)
                display.update(viewer, data, frame, read_error)
            else:
                viewer.set_texts((None, mujoco.mjtGridPos.mjGRID_TOPLEFT,
                                  'WAITING FOR TELEMETRY | no robot connection\n' + (read_error or '') + '\n\n' + display.shortcuts(), ''))
            prepared = time.monotonic()
            viewer.sync()
            synced = time.monotonic()
            timing.record(loop_started, prepared, synced)
            time.sleep(pacer.remaining(synced))
        print(timing.summary(time.monotonic() + 0.5, pacer.missed), flush=True)


if __name__ == '__main__':
    main()
