"""Shared URDF import and calibrated pose display. Never access a device."""
from pathlib import Path
import json
import math
import shutil
import tempfile
import struct
import zlib
import xml.etree.ElementTree as ET

import mujoco
import numpy as np

HERE = Path(__file__).resolve().parent
MODELS = {
    "so102": {"urdf": HERE / "urdf/so_arm_102.urdf", "mapping": HERE / "encoder-angle-map.json",
              "lookat": [0.24, 0.08, 0.16], "distance": 1.0},
    "so101": {"urdf": HERE / "urdf/so101/so101_new_calib.urdf", "mapping": HERE / "so101-encoder-map.json",
              "lookat": [0.30, 0.15, 0.16], "distance": 1.05},
}


def load_mapping(model_name, filename=None):
    mapping = json.loads(Path(filename or MODELS[model_name]["mapping"]).read_text())
    if mapping.get("version") != 2 or mapping.get("model") != model_name:
        raise ValueError(f"Expected a version 2 {model_name} mapping")
    joints = mapping.get("joints")
    if not isinstance(joints, dict) or not joints:
        raise ValueError("Mapping requires motor-to-joint entries")
    for motor, entry in joints.items():
        if motor not in {str(i) for i in range(1, 254)} or not isinstance(entry, dict):
            raise ValueError("Invalid mapping motor ID")
        if not isinstance(entry.get("joint"), str) or not entry["joint"]:
            raise ValueError(f"Motor {motor}: joint name required")
        for key in ("referenceCount", "referenceRadians", "radiansPerCount"):
            value = entry.get(key)
            if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
                raise ValueError(f"Motor {motor}: invalid {key}")
        if entry["radiansPerCount"] == 0:
            raise ValueError(f"Motor {motor}: radiansPerCount cannot be zero")
    fixed = mapping.get("fixedJoints", {})
    if not isinstance(fixed, dict) or any(isinstance(v, bool) or not isinstance(v, (int, float))
                                         or not math.isfinite(v) for v in fixed.values()):
        raise ValueError("Invalid fixed joint positions")
    names = [e["joint"] for e in joints.values()] + list(fixed)
    if len(set(names)) != len(names):
        raise ValueError("A joint must appear exactly once in the mapping")
    calibration = mapping.get("encoderCalibration", {})
    if not isinstance(calibration, dict):
        raise ValueError("Invalid encoderCalibration")
    return mapping


def prepare(build, model_name="so102"):
    """Import referenced visuals only; leave the pinned upstream files unchanged."""
    source = MODELS[model_name]["urdf"]
    build = Path(build).resolve()
    meshes = build / "meshes"
    meshes.mkdir(parents=True, exist_ok=True)
    robot = ET.parse(source).getroot()
    for link in robot.findall("link"):
        for collision in link.findall("collision"):
            link.remove(collision)
    copied = {}
    for mesh in robot.findall(".//mesh"):
        original = (source.parent / mesh.get("filename")).resolve()
        name = original.name
        if name in copied and copied[name] != original:
            raise ValueError(f"Conflicting mesh filenames: {name}")
        if name not in copied:
            shutil.copyfile(original, meshes / name)
            copied[name] = original
        mesh.set("filename", name)
    extension = ET.SubElement(robot, "mujoco")
    ET.SubElement(extension, "compiler", meshdir="meshes", discardvisual="false",
                  fusestatic="false", inertiafromgeom="false")
    imported = build / "resolved.urdf"
    ET.ElementTree(robot).write(imported, encoding="utf-8", xml_declaration=True)
    model = mujoco.MjModel.from_xml_path(str(imported))
    output = build / "preview.xml"
    mujoco.mj_saveLastXML(str(output), model)
    tree = ET.parse(output)
    root = tree.getroot()
    option = root.find("option")
    if option is None:
        option = ET.SubElement(root, "option")
    option.set("gravity", "0 0 0")
    option.set("timestep", "0.001")
    for geom in root.findall(".//geom"):
        geom.set("contype", "0")
        geom.set("conaffinity", "0")
    # The URDF describes the robot only. Keep display surroundings shared by
    # both models, with no contacts or mass added to the imported mechanism.
    assets = root.find("asset")
    ET.SubElement(assets, "texture", name="display_background", type="skybox",
                  builtin="gradient", rgb1="0.12 0.15 0.19", rgb2="0.24 0.27 0.31",
                  width="512", height="512")
    ET.SubElement(assets, "texture", name="display_grid", type="2d", builtin="checker",
                  rgb1="0.25 0.28 0.32", rgb2="0.36 0.39 0.43", width="512", height="512")
    ET.SubElement(assets, "material", name="display_floor", texture="display_grid",
                  texrepeat="5 5", texuniform="true", rgba="1 1 1 0.45", reflectance="0")
    # A solid floor would conceal valid telemetry below the mounting surface.
    ET.SubElement(root.find("worldbody"), "geom", name="display_floor", type="plane",
                  size="1 1 0.01", pos="0 0 -0.005", material="display_floor",
                  group="0", contype="0", conaffinity="0")
    # Normalize imported mimic constraints to the source multiplier and offset.
    mimics = [(j, j.find("mimic")) for j in robot.findall("joint") if j.find("mimic") is not None]
    if mimics:
        equality = root.find("equality")
        if equality is None:
            equality = ET.SubElement(root, "equality")
        for joint, mimic in mimics:
            for existing in list(equality):
                if existing.get("joint1") == joint.get("name"):
                    equality.remove(existing)
            ET.SubElement(equality, "joint", name=f"{joint.get('name')}_mimic",
                          joint1=joint.get("name"), joint2=mimic.get("joint"),
                          polycoef=f"{mimic.get('offset', '0')} {mimic.get('multiplier', '1')} 0 0 0")
    tree.write(output, encoding="utf-8", xml_declaration=True)
    return output


def build_model(filename=None, model_name="so102"):
    if filename is None:
        # Compiled models own their meshes; import files need not persist.
        with tempfile.TemporaryDirectory(prefix="sts-model-") as directory:
            return build_model(prepare(directory, model_name), model_name)
    model = mujoco.MjModel.from_xml_path(str(Path(filename).resolve()))
    model.vis.headlight.active = 1
    model.vis.headlight.ambient[:] = 0.5
    model.vis.headlight.diffuse[:] = 0.8
    # Display actual telemetry even beyond nominal CAD limits; never clamp it.
    model.jnt_limited[:] = False
    model.opt.gravity[:] = 0
    model.geom_contype[:] = 0
    model.geom_conaffinity[:] = 0
    for i in range(model.ngeom):
        if model.geom_group[i] != 1 and model.geom_bodyid[i] > 0:
            model.geom_rgba[i, 3] = 0
    return model, mujoco.MjData(model)


class PoseMap:
    """Bind joint addresses once, shared by the solid pose, ghost and markers."""
    def __init__(self, model, mapping):
        self.model = model
        self.motors = list(mapping["joints"])
        entries = list(mapping["joints"].values())
        self.joint_ids = self._ids([e["joint"] for e in entries])
        self.addresses = model.jnt_qposadr[self.joint_ids]
        self.zero = np.array([e["referenceCount"] for e in entries])
        self.anchor = np.array([e["referenceRadians"] for e in entries])
        self.scale = np.array([e["radiansPerCount"] for e in entries])
        fixed = mapping.get("fixedJoints", {})
        fixed_ids = self._ids(list(fixed))
        if sorted([*self.joint_ids, *fixed_ids]) != list(range(model.njnt)):
            raise ValueError("Every model joint needs one motor mapping or fixed position")
        if any(model.jnt_type[j] != mujoco.mjtJoint.mjJNT_HINGE for j in self.joint_ids):
            raise ValueError("Encoder angle mappings require revolute joints")
        self.fixed_addresses = model.jnt_qposadr[fixed_ids]
        self.fixed_values = list(fixed.values())

    def _ids(self, names):
        ids = [mujoco.mj_name2id(self.model, mujoco.mjtObj.mjOBJ_JOINT, name) for name in names]
        if any(j < 0 for j in ids):
            raise ValueError("Mapping names a joint missing from the selected model")
        return np.array(ids, dtype=int)

    def apply(self, data, counts):
        values = np.array([counts[motor] for motor in self.motors], dtype=float)
        if not np.isfinite(values).all():
            raise ValueError("Invalid encoder positions")
        data.qpos[self.addresses] = self.anchor + (values - self.zero) * self.scale
        data.qpos[self.fixed_addresses] = self.fixed_values
        data.qvel[:] = 0
        mujoco.mj_forward(self.model, data)


def camera(model_name="so102"):
    cam = mujoco.MjvCamera()
    cam.lookat[:] = MODELS[model_name]["lookat"]
    cam.distance, cam.azimuth, cam.elevation = MODELS[model_name]["distance"], 135, -22
    return cam


def write_png(path, rgb):
    height, width, _ = rgb.shape
    def chunk(kind, payload):
        return struct.pack(">I", len(payload)) + kind + payload + struct.pack(">I", zlib.crc32(kind + payload))
    scanlines = b"".join(b"\x00" + row.tobytes() for row in rgb)
    Path(path).write_bytes(b"\x89PNG\r\n\x1a\n" +
                          chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)) +
                          chunk(b"IDAT", zlib.compress(scanlines)) + chunk(b"IEND", b""))
