"""Build a lightweight SO-102 preview from the bundled upstream URDF."""
from pathlib import Path
import argparse
import json
import shutil
import xml.etree.ElementTree as ET

import mujoco
import numpy as np

HERE = Path(__file__).resolve().parent
SOURCE = HERE / "urdf"

BUILD = HERE / "logs/model"


def prepare(source=SOURCE, build=BUILD):
    source, build = Path(source).resolve(), Path(build).resolve()
    build.mkdir(parents=True, exist_ok=True)
    shutil.copytree(source / "meshes", build / "meshes", dirs_exist_ok=True)
    tree = ET.parse(source / "so_arm_102.urdf")
    robot = tree.getroot()
    source_mass = sum(float(mass.get("value")) for mass in robot.findall("./link/inertial/mass"))
    # These tools do not simulate contacts. Skip hundreds of collision boxes at
    # import time while keeping the upstream URDF and visual meshes unchanged.
    for link in robot.findall("link"):
        for collision in link.findall("collision"):
            link.remove(collision)
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
    # Preserve the source's mimic relation, including its sign and offset.
    equality = root.find("equality")
    if equality is None:
        equality = ET.SubElement(root, "equality")
    for joint in robot.findall("joint"):
        mimic = joint.find("mimic")
        if mimic is None:
            continue
        for existing in list(equality):
            if existing.get("joint1") == joint.get("name"):
                equality.remove(existing)
        ET.SubElement(equality, "joint", name=f"{joint.get('name')}_mimic",
                      joint1=joint.get("name"), joint2=mimic.get("joint"),
                      polycoef=f"{mimic.get('offset', '0')} {mimic.get('multiplier', '1')} 0 0 0")
    output = build / "so102-preview.xml"
    mjcf.write(output, encoding="utf-8", xml_declaration=True)
    model = mujoco.MjModel.from_xml_path(str(output))
    data = mujoco.MjData(model)
    mujoco.mj_forward(model, data)
    assert model.njnt == 7, f"Expected five rotary joints and two jaw slides: {model.njnt}"
    assert model.neq == 1, f"Expected one jaw coupling: {model.neq}"
    assert np.isclose(model.body_mass.sum(), source_mass), model.body_mass.sum()
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
    parser.add_argument("--assets", default=SOURCE, type=Path, help="Folder with so_arm_102.urdf and meshes/ (default: bundled model)")
    parser.add_argument("--output", type=Path, default=BUILD)
    args = parser.parse_args()
    path = prepare(args.assets, args.output)
    if args.view:
        import mujoco.viewer
        mujoco.viewer.launch(mujoco.MjModel.from_xml_path(str(path)))
