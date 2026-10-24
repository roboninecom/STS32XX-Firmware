"""Build the provisional SO-102 model from sources inside this simulation folder."""
from pathlib import Path
import argparse
import json
import shutil
import xml.etree.ElementTree as ET

import mujoco
import numpy as np

HERE = Path(__file__).resolve().parent
SOURCE = HERE / "models/so102/so-arm_description"

BUILD = HERE / "logs/model"


def prepare(source=SOURCE, build=BUILD):
    source, build = Path(source).resolve(), Path(build).resolve()
    build.mkdir(parents=True, exist_ok=True)
    shutil.copytree(source / "meshes", build / "meshes", dirs_exist_ok=True)
    tree = ET.parse(source / "urdf/so-arm.urdf")
    robot = tree.getroot()
    for mesh in robot.findall(".//mesh"):
        mesh.set("filename", Path(mesh.get("filename")).name)
    extension = ET.SubElement(robot, "mujoco")
    ET.SubElement(extension, "compiler", meshdir="meshes", discardvisual="false",
                  fusestatic="false", inertiafromgeom="false")
    imported = build / "so102-resolved.urdf"
    tree.write(imported, encoding="utf-8", xml_declaration=True)
    model = mujoco.MjModel.from_xml_path(str(imported))
    mujoco.mj_saveLastXML(str(build / "so102-imported.xml"), model)
    mjcf = ET.parse(build / "so102-imported.xml")
    root = mjcf.getroot()
    option = root.find("option")
    if option is None:
        option = ET.SubElement(root, "option")
    # Geometry preview: unqualified mesh contacts and gravity disabled deliberately.
    option.set("gravity", "0 0 0")
    option.set("timestep", "0.001")
    for geom in root.findall(".//geom"):
        geom.set("contype", "0")
        geom.set("conaffinity", "0")
    # Explicitly preserve the source's jaw coupling across importer versions.
    equality = root.find("equality")
    if equality is None:
        equality = ET.SubElement(root, "equality")
    coupled = any(e.get("joint1") in ("clamp1", "clamp2") and
                  e.get("joint2") in ("clamp1", "clamp2") for e in equality)
    if not coupled:
        ET.SubElement(equality, "joint", name="jaw_mimic", joint1="clamp2",
                      joint2="clamp1", polycoef="0 1 0 0 0")
    output = build / "so102-preview.xml"
    mjcf.write(output, encoding="utf-8", xml_declaration=True)
    model = mujoco.MjModel.from_xml_path(str(output))
    data = mujoco.MjData(model)
    mujoco.mj_forward(model, data)
    assert model.njnt == 7, f"Expected five rotary joints and two jaw slides: {model.njnt}"
    assert model.neq == 1, f"Expected one jaw coupling: {model.neq}"
    assert np.isclose(model.body_mass.sum(), 1.225), model.body_mass.sum()
    for _ in range(1000):
        mujoco.mj_step(model, data)
    assert np.isfinite(data.qpos).all() and np.isfinite(data.qvel).all()
    assert not any(w.number for w in data.warning), "MuJoCo issued a simulation warning"
    report = {
        "mujoco": mujoco.__version__, "model": str(output),
        "joints": [mujoco.mj_id2name(model, mujoco.mjtObj.mjOBJ_JOINT, i)
                   for i in range(model.njnt)],
        "mass_kg": float(model.body_mass.sum()), "jaw_equalities": model.neq,
        "actuators": model.nu, "preview_steps": 1000,
        "gravity_enabled": False, "contacts_enabled": False,
        "dynamics_calibrated": False,
    }
    (build / "check.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))
    return output


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--view", action="store_true", help="Open the geometry preview (use mjpython on macOS)")
    parser.add_argument("--assets", default=SOURCE, type=Path, help="SO-102 package (default: bundled model)")
    parser.add_argument("--output", type=Path, default=BUILD)
    args = parser.parse_args()
    path = prepare(args.assets, args.output)
    if args.view:
        import mujoco.viewer
        mujoco.viewer.launch(mujoco.MjModel.from_xml_path(str(path)))
