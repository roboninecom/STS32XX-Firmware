"""SO-102 pose display helpers. No device access or hardware controller simulation."""
from pathlib import Path
import shutil
import tempfile
import struct
import zlib
import xml.etree.ElementTree as ET
import mujoco
import numpy as np

HERE = Path(__file__).resolve().parent
JOINTS = ["base_to_link1", "link1_to_link2", "link2_to_link3",
          "link3_to_link4", "link4_to_link5", "clamp1", "clamp2"]


def prepare(build, source=HERE / "urdf"):
    source, build = Path(source).resolve(), Path(build).resolve()
    build.mkdir(parents=True, exist_ok=True)
    shutil.copytree(source / "meshes", build / "meshes", dirs_exist_ok=True)
    tree = ET.parse(source / "so_arm_102.urdf")
    robot = tree.getroot()
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
    return output


def build_model(filename=None):
    if filename is None:
        # Compiled models own their mesh data; temporary import files can be removed.
        with tempfile.TemporaryDirectory(prefix="sts-model-") as directory:
            return build_model(prepare(directory))
    # Load from its original directory so relative mesh paths remain valid.
    model = mujoco.MjModel.from_xml_path(str(Path(filename).resolve()))
    for name in JOINTS:
        if mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_JOINT, name) < 0:
            raise ValueError(f"Model is missing SO-102 joint {name}")
    model.vis.headlight.active = 1
    model.vis.headlight.ambient[:] = 0.5
    model.vis.headlight.diffuse[:] = 0.8
    model.jnt_limited[:] = False
    model.opt.gravity[:] = 0
    model.geom_contype[:] = 0
    model.geom_conaffinity[:] = 0
    for i in range(model.ngeom):
        if model.geom_group[i] != 1 and model.geom_bodyid[i] > 0:
            model.geom_rgba[i, 3] = 0
    return model, mujoco.MjData(model)


def apply_pose(model, data, counts, mapping):
    for motor, name in enumerate(JOINTS[:4], 1):
        key = str(motor)
        angle = mapping["jointAnchorsDeg"][key] + mapping["encoderToUrdfDirection"][key] * (
            counts[key] - mapping["middleCount"]) * mapping["nominalDegreesPerCount"]
        joint = mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_JOINT, name)
        data.qpos[model.jnt_qposadr[joint]] = np.deg2rad(angle)
    # M5/M6 calibration is deferred. These are explicitly fixed visual placeholders.
    for name, value in [(JOINTS[4], 0.0), (JOINTS[5], 0.016), (JOINTS[6], -0.016)]:
        joint = mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_JOINT, name)
        data.qpos[model.jnt_qposadr[joint]] = value
    data.qvel[:] = 0
    mujoco.mj_forward(model, data)


def camera():
    cam = mujoco.MjvCamera()
    cam.lookat[:] = [0.14, 0.0, 0.16]
    cam.distance, cam.azimuth, cam.elevation = 0.95, 135, -22
    return cam


def write_png(path, rgb):
    height, width, _ = rgb.shape
    def chunk(kind, payload):
        return struct.pack(">I", len(payload)) + kind + payload + struct.pack(">I", zlib.crc32(kind + payload))
    scanlines = b"".join(b"\x00" + row.tobytes() for row in rgb)
    Path(path).write_bytes(b"\x89PNG\r\n\x1a\n" +
                          chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)) +
                          chunk(b"IDAT", zlib.compress(scanlines)) + chunk(b"IEND", b""))
