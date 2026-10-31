"""Read-only telemetry presentation shared by live and recorded viewers."""
from collections import deque
import math
import time

import mujoco
import numpy as np

from model import PoseMap

from recording import number


def copy_geom(source, dest, rgba=None):
    """Copy native geometry consistently for the ghost and saved previews."""
    mujoco.mjv_initGeom(dest, source.type, source.size, source.pos,
                      source.mat.reshape(-1), source.rgba if rgba is None else np.asarray(rgba))
    for name in ("dataid", "matid", "texid", "texcoord", "texuniform", "modelrbound",
                 "transparent", "label", "category", "objtype", "objid"):
        setattr(dest, name, getattr(source, name))


def feed_status(frame, now_ms=None, stale_ms=1500):
    now_ms = time.time() * 1000 if now_ms is None else now_ms
    if frame.get("playback"):
        return "RECORDED PLAYBACK FINISHED" if frame.get("playbackFinished") else "RECORDED PLAYBACK"
    if frame.get("status") in ("complete", "interrupted", "failed"):
        return f"SESSION FINISHED ({frame.get('status', 'unknown')})"
    motor_times = [frame.get("measuredUnixMs", {}).get(i) for i in frame.get("measured", {})]
    if any(number(stamp) and now_ms - stamp > stale_ms for stamp in motor_times):
        return "STALE MOTOR DATA - showing last received pose"
    if now_ms - frame["publishedUnixMs"] > stale_ms:
        return "STALE - showing last received pose"
    if frame.get("publishedUnixMs", 0) - now_ms > 1000:
        return "CLOCK MISMATCH"
    return "LIVE"


def fmt(value, decimals=1):
    return f"{value:.{decimals}f}" if number(value) else "--"


def sample(frame, motor):
    value = frame.get("telemetry", {}).get(str(motor), {})
    return value if isinstance(value, dict) else {}


def value(frame, key, motor):
    return frame.get(key, {}).get(str(motor))


def error_counts(frame, motor):
    measured, reference = value(frame, "measured", motor), value(frame, "reference", motor)
    return reference - measured if number(measured) and number(reference) else None


def state_text(s):
    if not s:
        return "no detail"
    flags = ["SAT"] if s.get("saturated") else []
    if s.get("faults"):
        flags.append(f"fault {s['faults']}")
    if s.get("fresh") is False:
        flags.append("old sample")
    flags.append("moving" if s.get("running") else "hold" if s.get("armed") else "idle")
    if s.get("driveEnabled") is False:
        flags.append("drive off")
    return ", ".join(flags)


class Display:
    def __init__(self, model, mapping):
        self.model, self.mapping = model, mapping
        self.pose = PoseMap(model, mapping)
        self.reference = mujoco.MjData(model)
        self.ref_scene = mujoco.MjvScene(model, maxgeom=200)
        self.history = deque(maxlen=3000)
        self.last_key = None
        self.run = None
        self.history_revision = 0
        self.chart_cache_key = None
        self.chart_rebuilds = 0
        self.submitted_chart_key = None
        self.last_text_at = -math.inf
        self.last_text_key = None
        self.pose_cache_key = None
        self.cached_viewport = None
        self.viewport_refresh_at = -math.inf
        self.figures = [mujoco.MjvFigure() for _ in range(3)]
        for figure in self.figures:
            mujoco.mjv_defaultFigure(figure)
            figure.flg_legend = True
            figure.flg_extend = False
            figure.figurergba[:] = [0.08, 0.10, 0.14, 0.94]
            figure.panergba[:] = [0.05, 0.07, 0.10, 1]
            figure.gridsize[:] = [5, 3]
            figure.linewidth = 2
            figure.yformat = "%.0f"
            figure.xlabel = "seconds before latest sample"
        self.selected = 2
        self.ghost = True
        self.charts = True
        self.markers = True
        self.mode = "measured"
        self.help = True
        self.fast_view = True
        self.render_cache_key = None

    def key(self, key):
        if 49 <= key <= 54:
            self.selected = key - 48
        elif key in (77, 82):
            self.mode = "measured" if key == 77 else "reference"
        elif key == 71:
            self.ghost = not self.ghost
        elif key == 67:
            self.charts = not self.charts
        elif key == 74:
            self.markers = not self.markers
        elif key == 72:
            self.help = not self.help
        elif key == 70:
            self.fast_view = not self.fast_view

    def render_settings(self, scene):
        # These multipass effects cost time on every camera redraw, even when
        # telemetry is unchanged. Keep meshes, reference ghost and charts intact.
        scene.flags[mujoco.mjtRndFlag.mjRND_SHADOW] = not self.fast_view
        scene.flags[mujoco.mjtRndFlag.mjRND_REFLECTION] = not self.fast_view

    def observe(self, frame):
        run = frame.get("directory")
        if run != self.run:
            self.history.clear()
            self.last_key, self.run = None, run
            self.history_revision += 1
        stamps = tuple((key, s.get("sampleSequence"), s.get("sampleMs"), s.get("capturedUnixMs"),
                        s.get("appliedEffort"), s.get("requestedEffort"))
                       for key, s in sorted(frame.get("telemetry", {}).items()) if isinstance(s, dict))
        key = (stamps or frame["publishedUnixMs"],
               tuple(sorted(frame["measured"].items())), tuple(sorted(frame["reference"].items())),
               tuple(sorted(frame.get("target", {}).items())), frame.get("referenceLabel"))
        if key == self.last_key:
            return False
        self.last_key = key
        self.history.append(frame)
        while len(self.history) > 1 and self.history[1]['publishedUnixMs'] < frame['publishedUnixMs'] - 20000:
            self.history.popleft()
        self.history_revision += 1
        return True

    def overlay_scene(self, data, frame, scene, cam, opt):
        scene.ngeom = 0
        if self.ghost and self.mode == "measured":
            self.pose.apply(self.reference, frame["reference"])
            mujoco.mjv_updateScene(self.model, self.reference, opt, None, cam,
                                  mujoco.mjtCatBit.mjCAT_ALL, self.ref_scene)
            for i in range(self.ref_scene.ngeom):
                source = self.ref_scene.geoms[i]
                if source.objtype != mujoco.mjtObj.mjOBJ_GEOM or source.objid < 0:
                    continue
                gid = source.objid
                # Only visible moving visual meshes, excluding fixed base/floor and duplicate colliders.
                if self.model.geom_group[gid] != 1 or self.model.geom_bodyid[gid] <= 1:
                    continue
                dest = scene.geoms[scene.ngeom]
                copy_geom(source, dest, [0.1, 0.85, 1.0, 0.28])
                dest.transparent = True
                dest.category = mujoco.mjtCatBit.mjCAT_DECOR
                dest.objtype, dest.objid = mujoco.mjtObj.mjOBJ_UNKNOWN, -1
                scene.ngeom += 1
        if self.markers:
            for motor, jid in zip(self.pose.motors, self.pose.joint_ids):
                selected = int(motor) == self.selected
                color = [1, 0.65, 0.15, 1] if selected else [0.35, 0.75, 0.95, 0.8]
                pos = data.xanchor[jid].copy()
                geom = scene.geoms[scene.ngeom]
                mujoco.mjv_initGeom(geom, mujoco.mjtGeom.mjGEOM_SPHERE,
                                  [0.008 if selected else 0.004, 0, 0], pos,
                                  np.eye(3).reshape(-1), color)
                scene.ngeom += 1
                if not selected:
                    continue
                geom = scene.geoms[scene.ngeom]
                mujoco.mjv_initGeom(geom, mujoco.mjtGeom.mjGEOM_LABEL, [0, 0, 0],
                                  pos + [0, 0, 0.02], np.eye(3).reshape(-1), color)
                geom.label = f"M{motor} err {fmt(error_counts(frame, motor))} ct"
                scene.ngeom += 1

    def shortcuts(self):
        summary = (f"SHORTCUTS | M{self.selected} selected | C charts {'ON' if self.charts else 'OFF'}"
                   f" | F fast view {'ON' if self.fast_view else 'OFF'} | H help")
        if not self.help:
            return summary
        return (summary + "\n1-6  Select motor for charts and details\n"
                f"G    Reference ghost {'ON' if self.ghost else 'OFF'}\n"
                f"J    Joint markers {'ON' if self.markers else 'OFF'}\n"
                "F    Toggle fast view (shadows/reflections off)\n"
                "M/R  Measured / reference main pose\n"
                "Mouse drag: orbit | scroll: zoom\nClose window: hardware keeps running")

    def chart_layout(self, viewport):
        # Viewer viewport coordinates are framebuffer pixels (Retina can be 2x).
        width = max(1, int(viewport.width * 0.34))
        height = max(1, int(viewport.height * 0.22))
        return [mujoco.MjrRect(viewport.left + viewport.width - width,
                             viewport.bottom + i * height, width, height) for i in range(3)]

    def texts(self, frame):
        status = feed_status(frame)
        bound = set(self.pose.motors).issubset(self.mapping.get("encoderCalibration", {}))
        age = max(0, time.time() * 1000 - frame["publishedUnixMs"])
        age_text = "no robot connection" if frame.get("playback") else f"feed age {age / 1000:.1f}s"
        heading = (f"{status} | {age_text}\n{frame.get('label', '')[:85]}\n"
                   f"Solid: {self.mode} | cyan: reference\n"
                   f"{self.mapping['model'].upper()} | {len(self.pose.motors)} joints mapped"
                   f" | {'calibration checked' if bound else 'reference pose assumed'}\n\n" + self.shortcuts())
        rows = ["Motor     Actual     Ref     Target     Error     Effort     Temp     State"]
        now = time.time() * 1000
        for motor in range(1, 7):
            s = sample(frame, motor)
            temp = s.get("temperatureValidated") if s.get("temperatureValid", False) else None
            rows.append(f"{'>' if motor == self.selected else ' '}M{motor}    "
                        f"{fmt(value(frame,'measured',motor)):>7}  {fmt(value(frame,'reference',motor)):>7}  "
                        f"{fmt(value(frame,'target',motor)):>7}  {fmt(error_counts(frame,motor)):>7}  "
                        f"{fmt(s.get('appliedEffort'),0):>7}  {fmt(temp,0):>4}C  {state_text(s)[:14]}")
        s = sample(frame, self.selected)
        captured = s.get("capturedUnixMs")
        sample_age = max(0, now - captured) + max(0, s.get("ageMs", 0)) if number(captured) else None
        if frame.get("playback"):
            sample_age = max(0, frame["publishedUnixMs"] - captured) + max(0, s.get("ageMs", 0)) if number(captured) else None
        velocity = s.get("measuredVelocityQ8PerS")
        reference_velocity = s.get("referenceVelocityQ8PerS")
        detail = (f"M{self.selected} | sample age {fmt(sample_age,0)} ms | {state_text(s)}\n"
                  f"Velocity actual/ref: {fmt(velocity / 256 if number(velocity) else None)} / "
                  f"{fmt(reference_velocity / 256 if number(reference_velocity) else None)} counts/s\n"
                  f"Effort applied/requested: {fmt(s.get('appliedEffort'),0)} / {fmt(s.get('requestedEffort'),0)}\n"
                  f"P / I / D: {fmt(s.get('pTerm'),0)} / {fmt(s.get('iTerm'),0)} / {fmt(s.get('dTerm'),0)}\n"
                  f"Gravity / velocity FF: {fmt(s.get('gravityEffort'),0)} / "
                  f"{fmt(s.get('velocityFeedforward'),0)}\n"
                  f"Current raw: {fmt(s.get('currentAdcDelta'),0)} | voltage raw: {fmt(s.get('voltageRaw'),0)}\n"
                  f"Overruns (cumulative): {fmt(s.get('overrunCount'),0)}\n"
                  "Position: counts | effort: PWM | current: raw ADC")
        font = mujoco.mjtFontScale.mjFONTSCALE_100
        return [(font, mujoco.mjtGridPos.mjGRID_TOPLEFT, heading, ""),
                (font, mujoco.mjtGridPos.mjGRID_TOPRIGHT, "\n".join(rows), ""),
                (font, mujoco.mjtGridPos.mjGRID_BOTTOMLEFT, detail, "")]

    def chart_data(self):
        cache_key = (self.history_revision, self.selected)
        if cache_key == self.chart_cache_key:
            return self.figures
        self.chart_rebuilds += 1
        motor = self.selected
        definitions = [("Position (encoder counts)", [("measured", lambda f: value(f, "measured", motor)),
                         ("reference", lambda f: value(f, "reference", motor)),
                         ("target", lambda f: value(f, "target", motor))]),
                       ("Tracking error (counts)", [("error", lambda f: error_counts(f, motor))]),
                       ("Effort (controller units)", [("applied", lambda f: sample(f, motor).get("appliedEffort")),
                         ("requested", lambda f: sample(f, motor).get("requestedEffort"))])]
        palette = [[0.95, 0.95, 0.95], [0.1, 0.85, 1.0], [1.0, 0.65, 0.15]]
        frames = list(self.history)
        if frames and frames[-1].get("referenceKind", {}).get(str(motor)) == "destination":
            definitions[1] = ("Destination error (counts)", definitions[1][1])
        def timestamp(f, label):
            if label == "target" or (label in ("reference", "error") and f.get("referenceKind", {}).get(str(motor)) == "destination"):
                return f["publishedUnixMs"]
            return sample(f, motor).get("capturedUnixMs", f.get("measuredUnixMs", {}).get(str(motor), f["publishedUnixMs"]))
        last = frames[-1]["publishedUnixMs"] if frames else 0
        for figure, (title, lines) in zip(self.figures, definitions):
            figure.title = f"M{motor} {title}"
            figure.linepnt[:] = 0
            figure.range[0] = [-20, 0]
            values = []
            for line, (label, getter) in enumerate(lines):
                figure.linename[line] = label
                figure.linergb[line] = palette[line]
                points = [((timestamp(f, label) - last) / 1000, getter(f)) for f in frames]
                # Command points use publication time; unchanged measured samples keep their capture time.
                points = list(dict.fromkeys((x, y) for x, y in points if number(y) and -20 <= x <= 0))
                # Native figure storage has a fixed point capacity.
                capacity = figure.linedata.shape[1] // 2
                points = points[-capacity:]
                if points:
                    figure.linepnt[line] = len(points)
                    figure.linedata[line, :2 * len(points)] = np.array(points).reshape(-1)
                    values.extend(y for _, y in points)
            if values:
                lo, hi = min(values), max(values)
                margin = max(1, (hi - lo) * 0.12)
                figure.range[1] = [lo - margin, hi + margin]
                if max(figure.linepnt) == 1:
                    figure.title += " (snapshot)"
            else:
                figure.range[1] = [-1, 1]
                figure.title += " (unavailable)"
        self.chart_cache_key = cache_key
        return self.figures

    def update(self, viewer, data, frame):
        self.observe(frame)
        if self.render_cache_key != self.fast_view:
            with viewer.lock():
                self.render_settings(viewer.user_scn)
            self.render_cache_key = self.fast_view
        pose_key = (self.mode, self.selected, self.ghost, self.markers,
                    tuple(sorted(frame['measured'].items())), tuple(sorted(frame['reference'].items())))
        if pose_key != self.pose_cache_key:
            with viewer.lock():
                self.pose.apply(data, frame[self.mode])
                self.overlay_scene(data, frame, viewer.user_scn, viewer.cam, viewer.opt)
            self.pose_cache_key = pose_key
        now = time.monotonic()
        text_key = (self.selected, self.help, self.charts, self.markers, self.ghost, self.mode, self.fast_view,
                    feed_status(frame))
        if text_key != self.last_text_key or now - self.last_text_at >= 0.25:
            viewer.set_texts(self.texts(frame))
            self.last_text_at, self.last_text_key = now, text_key
        if self.charts:
            # Native viewport access can contend with rendering. Resize responsiveness
            # needs a few polls per second, not one for every unchanged telemetry frame.
            if self.cached_viewport is None or now - self.viewport_refresh_at >= 0.25:
                self.cached_viewport = viewer.viewport
                self.viewport_refresh_at = now
            viewport = self.cached_viewport
            chart_key = (self.history_revision, self.selected, viewport.left, viewport.bottom,
                         viewport.width, viewport.height)
            if chart_key != self.submitted_chart_key:
                viewer.set_figures(list(zip(self.chart_layout(viewport), reversed(self.chart_data()))))
                self.submitted_chart_key = chart_key
        elif self.submitted_chart_key is not None:
            viewer.clear_figures()
            self.submitted_chart_key = None
