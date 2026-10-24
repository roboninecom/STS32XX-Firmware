"""Check the coupled gravity basis against the provisional MuJoCo geometry.

This validates algebra and frame signs, never hardware masses or PWM-to-torque conversion.
"""
import argparse
import json
from pathlib import Path

import mujoco
import numpy as np

from model import build_model, JOINTS, HERE


def potential_basis(q):
    a = np.array([q[0], q[0] + q[1], q[0] + q[1] - q[2]])
    return np.column_stack((np.sin(a), np.cos(a))).reshape(-1)


def holding_basis(q):
    a = np.array([q[0], q[0] + q[1], q[0] + q[1] - q[2]])
    pairs = np.column_stack((np.cos(a), -np.sin(a))).reshape(-1)
    return np.array([pairs, np.r_[0., 0., pairs[2:]], np.r_[0., 0., 0., 0., -pairs[4:]]])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--model', type=Path, required=True)
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    model, data = build_model(args.model)
    model.opt.gravity[:] = [0, 0, -9.81]
    model.body_gravcomp[:] = 0
    ids = [mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_JOINT, name) for name in JOINTS]
    qadr, dadr = model.jnt_qposadr[ids], model.jnt_dofadr[ids]
    rng = np.random.default_rng(20261004)
    poses = rng.uniform(np.deg2rad([5, -170, -90]), np.deg2rad([185, 5, 20]), (160, 3))
    x, y, finite_difference_error, base_torque = [], [], [], []
    def set_q(q):
        data.qpos[qadr] = [0.3, *q, 0., 0.016, -0.016]
        data.qvel[:] = 0
        mujoco.mj_forward(model, data)
    def energy(q):
        set_q(q)
        return float(np.sum(model.body_mass * 9.81 * data.xipos[:, 2]))
    for q in poses:
        set_q(q)
        torque = data.qfrc_bias[dadr[1:4]].copy()
        x.extend(holding_basis(q))
        y.extend(torque)
        base_torque.append(abs(data.qfrc_bias[dadr[0]]))
        for j in range(3):
            delta = np.zeros(3); delta[j] = 1e-6
            finite_difference_error.append(abs((energy(q + delta) - energy(q - delta)) / 2e-6 - torque[j]))
    x, y = np.array(x), np.array(y)
    # Whole poses are held out; each pose contributes three coupled joint torques.
    coefficients, _, rank, singular = np.linalg.lstsq(x[:300], y[:300], rcond=None)
    error = x @ coefficients - y
    assert rank == 6 and np.max(np.abs(error)) < 1e-9
    assert max(finite_difference_error) < 1e-8 and max(base_torque) < 1e-10
    report = {"status": "geometry-algebra-verified-only", "poses": len(poses), "rank": int(rank),
              "basis": ["sin(q2)", "cos(q2)", "sin(q2+q3)", "cos(q2+q3)",
                        "sin(q2+q3-q4)", "cos(q2+q3-q4)"],
              "potential_coefficients_joule_provisional": coefficients.tolist(),
              "train_max_torque_residual_nm": float(np.max(np.abs(error[:300]))),
              "held_out_max_torque_residual_nm": float(np.max(np.abs(error[300:]))),
              "finite_difference_max_error_nm": max(finite_difference_error),
              "vertical_base_gravity_max_nm": max(base_torque),
              "matrix_condition": float(singular[0] / singular[-1]),
              "mass_com_and_inertia_validated": False, "hardware_effort_conversion_validated": False,
              "hardware_model_accepted": False, "hardware_connected": False,
              "m5_fixed_angle_rad": 0, "jaw_opening_placeholder_m": 0.016,
              "note": "Validate angle coupling/frame signs only. Learn or verify effective mass/COM and actuator scales from independent hardware data before applying a model."}
    if args.output:
        args.output.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
