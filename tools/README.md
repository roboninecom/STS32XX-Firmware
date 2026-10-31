# Tools

Utilities for working with STS servos. Each guide includes setup instructions,
commands and hardware requirements. For application development, use the
[Node.js servo driver](../host/servo-driver/README.md), available as a standalone
npm package built from this repository. Replay and teleoperation share the
[arm controller and gravity model](../host/arm-control/README.md).

For a new mechanism: [calibrate offsets and limits](settings/README.md#choose-the-reference-pose),
record poses, then tune and validate compensation. Keep verified calibration when
reusing existing poses and gravity models.

| Tool | Purpose |
| --- | --- |
| [Automated tuning](tuning/README.md) | Compare bounded batches of settings with repeated moves and longer validation holds. |
| [Telemetry viewer](simulation/README.md) | View live telemetry and play recordings with bundled SO-101 and SO-102 models; no bus access. |
| [Teleoperation](teleoperation/README.md) | Control a follower from a hand-operated leader. |
| [Recording and replay](poses/README.md) | Record named poses; replay with legacy or extension settings, or play a recorded teleoperation session. |
| [Discovery, calibration and settings](settings/README.md) | Find motors, calibrate joint offsets and limits, and back up or restore persistent settings. |
| [Hardware comparison tests](hw-diff-tests/README.md) | Compare factory and custom firmware behaviour on a dedicated servo bench. |
| [Bus benchmark and telemetry](diagnostics/README.md) | Measure communication latency and check stationary readings for unusual values. |
| [Firmware flashing and recovery](flash/README.md) | Flash custom or bundled factory firmware, recover interrupted uploads and repair factory settings. |

Node.js tools require Node.js 20 or newer. Flashing and
settings recovery require Python 3.10 or newer. Simulation uses Python 3.12. Run commands from the repository
root and follow the relevant guide before connecting hardware: comparison tests
can move motors and overwrite settings, and flashing can damage a servo.

## Offline checks

Run from the repository root. Install Node dependencies and each Python tool's
requirements first. None of these commands opens a serial port or moves hardware.

| Command | Coverage |
| --- | --- |
| `make verify` | Firmware build, C regression tests, register/storage contracts and image layout. See [toolchain setup](../firmware/README.md). |
| `npm test` | Driver, shared controller and all Node.js tools. |
| `npm run test:driver-package` | Driver packaging and isolated installation using cached npm dependencies. |
| `make flash-verify PYTHON=tools/flash/.venv/bin/python` | Flashing and factory settings recovery with simulated serial devices. |
| `PYTHONPATH=tools/simulation tools/simulation/.venv/bin/python -m unittest discover -s tools/simulation/test` | Models, recording readers and viewer behaviour. |

Hardware comparison uses the [dedicated bench suite](hw-diff-tests/README.md);
it can replace settings and reset templates. Use [diagnostics](diagnostics/README.md)
for communication and stationary telemetry on an assembled mechanism.
