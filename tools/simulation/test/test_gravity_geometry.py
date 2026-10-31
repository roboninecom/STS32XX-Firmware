"""Gravity algebra and frame signs; not motor dynamics or PWM conversion."""
import unittest
import mujoco
import numpy as np
from model import build_model, load_mapping


def holding_basis(q):
    a = np.array([q[0], q[0] + q[1], q[0] + q[1] - q[2]])
    pairs = np.column_stack((np.cos(a), -np.sin(a))).reshape(-1)
    return np.array([pairs, np.r_[0., 0., pairs[2:]], np.r_[0., 0., 0., 0., -pairs[4:]]])


class GravityGeometryTests(unittest.TestCase):
    def test_coupled_basis_matches_inverse_torque_and_potential_derivative(self):
        model, data = build_model()
        model.opt.gravity[:] = [0, 0, -9.81]
        model.body_gravcomp[:] = 0
        mapping = load_mapping("so102")
        names = [e["joint"] for e in mapping["joints"].values()] + list(mapping["fixedJoints"])
        ids = [mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_JOINT, name) for name in names]
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
        coefficients, _, rank, _ = np.linalg.lstsq(x[:300], y[:300], rcond=None)
        error = x @ coefficients - y
        assert rank == 6 and np.max(np.abs(error)) < 1e-9
        assert max(finite_difference_error) < 1e-8 and max(base_torque) < 1e-10
