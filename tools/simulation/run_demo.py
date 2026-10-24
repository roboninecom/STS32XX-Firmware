"""Run a repeating SO-102 motion demo with illustrative position servos."""
import argparse
import json
from pathlib import Path
import time
import xml.etree.ElementTree as ET

import mujoco
import numpy as np

from prepare_so102 import prepare, BUILD

JOINTS = ["base_to_link1", "link1_to_link2", "link2_to_link3",
          "link3_to_link4", "link4_to_link5", "clamp1"]


def target(t):
    phase = 2 * np.pi * t / 10
    return np.array([0.6 * np.sin(phase), 0.65 + 0.3 * np.sin(phase),
                     -0.8 + 0.35 * np.sin(phase + 0.7),
                     -0.25 + 0.3 * np.sin(phase + 1.2),
                     0.5 * np.sin(phase + 0.4),
                     0.016 + 0.012 * np.sin(phase)])


def build_demo(assets, build=BUILD):
    tree = ET.parse(prepare(assets, build))
    root = tree.getroot()
    root.set("model", "SO-102 motion demo (illustrative servos)")
    root.find("option").set("gravity", "0 0 -9.81")
    root.find("option").set("integrator", "implicitfast")
    for body in root.findall(".//body"):
        # Idealized support separates this visual demo from uncalibrated gravity loading.
        body.set("gravcomp", "1")
    for body in root.findall(".//body"):
        # URDF has identical visual/collision meshes. Only show the visual copy.
        for geom in list(body.findall("geom")):
            if geom.get("group") != "1":
                body.remove(geom)
    world = root.find("worldbody")
    ET.SubElement(world, "light", pos="0.1 -0.6 1.5", dir="0 0 -1", directional="true")
    ET.SubElement(world, "geom", name="floor", type="plane", size="1.5 1.5 0.05",
                  pos="0 0 -0.005", rgba="0.19 0.23 0.29 1", contype="0", conaffinity="0")
    actuator = ET.SubElement(root, "actuator")
    for i, name in enumerate(JOINTS):
        joint = root.find(f".//joint[@name='{name}']")
        ET.SubElement(actuator, "position", name=f"demo_{name}", joint=name,
                      kp="30" if i < 5 else "80", kv="1" if i < 5 else "0.5",
                      ctrllimited="true", ctrlrange=joint.get("range"),
                      forcelimited="true", forcerange="-2 2" if i < 5 else "-3 3")
    path = build / "so102-demo.xml"
    tree.write(path, encoding="utf-8", xml_declaration=True)
    model = mujoco.MjModel.from_xml_path(str(path))
    data = mujoco.MjData(model)
    data.qpos[:6] = target(0)
    data.qpos[6] = data.qpos[5]
    data.ctrl[:] = target(0)
    mujoco.mj_forward(model, data)
    return model, data


def step(model, data):
    data.ctrl[:] = target(data.time)
    mujoco.mj_step(model, data)


def check(model, data, build=BUILD):
    positions = []
    for i in range(20000):
        step(model, data)
        if i % 100 == 0:
            positions.append(data.qpos.copy())
    positions = np.array(positions)
    assert np.isfinite(positions).all()
    assert not any(w.number for w in data.warning), "MuJoCo issued a warning"
    span = np.ptp(positions, axis=0)
    assert np.all(span[:5] > 0.3) and np.all(span[5:] > 0.015), span
    assert np.max(np.abs(positions[:, 5] - positions[:, 6])) < 0.001
    report = {"seconds": float(data.time), "actuators": model.nu,
              "joint_travel_rad_or_m": span.tolist(), "warnings": 0,
              "servo_parameters_calibrated": False, "contacts_enabled": False,
              "ideal_gravity_compensation": True}
    (build / "demo-check.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2), flush=True)


def view(model, data):
    import mujoco.viewer
    paused = False

    def keypress(key):
        nonlocal paused
        if key == 32:
            paused = not paused

    with mujoco.viewer.launch_passive(model, data, key_callback=keypress,
                                     show_left_ui=False, show_right_ui=False) as viewer:
        viewer.cam.lookat[:] = [0.16, 0, 0.15]
        viewer.cam.distance = 1.05
        viewer.cam.azimuth = 135
        viewer.cam.elevation = -22
        print("SO-102 demo running. Space pauses/resumes; close the window to stop.", flush=True)
        # Batch physics at 60 displayed frames per second and keep wall-clock pacing.
        while viewer.is_running():
            start = time.monotonic()
            with viewer.lock():
                if not paused:
                    for _ in range(16):
                        step(model, data)
            viewer.sync()
            time.sleep(max(0, 0.016 - (time.monotonic() - start)))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Check 20 seconds without a window")
    parser.add_argument("--assets", required=True, type=Path)
    parser.add_argument("--output", type=Path, default=BUILD)
    args = parser.parse_args()
    args.output = args.output.resolve()
    model, data = build_demo(args.assets, args.output)
    if args.check:
        check(model, data, args.output)
    else:
        view(model, data)
