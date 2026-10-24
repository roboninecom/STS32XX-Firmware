# Tools

Utilities for working with STS servos. Each guide includes setup instructions,
commands and hardware requirements. For application development, use the
[Node.js servo driver](../host/servo-driver/README.md), available as a standalone
npm package built from this repository. Replay and teleoperation share the
[arm controller and gravity model](../host/arm-control/README.md).

| Tool | Purpose |
| --- | --- |
| [Automated tuning](tuning/README.md) | Compare bounded batches of settings with repeated moves and longer validation holds. |
| [Simulation and viewer](simulation/README.md) | Display current motion logs and view the bundled SO-ARM-102 model without bus access. |
| [Teleoperation](teleoperation/README.md) | Control a follower by hand or replay a recorded session. |
| [Pose recorder](pose-recorder/README.md) | Record named positions with torque off and replay them on a follower. |
| [Discovery and settings](settings/README.md) | Find motors and back up or restore their persistent settings. |
| [Hardware comparison tests](hw-diff-tests/README.md) | Compare factory and custom firmware behaviour on a dedicated servo bench. |
| [Bus benchmark and telemetry](diagnostics/README.md) | Measure communication latency and check stationary readings for unusual values. |
| [Firmware flashing](flash/README.md) | Upload published encoded firmware images and recover interrupted uploads. |
| [Settings recovery](flash/FACTORY_RECOVERY.md) | Back up, verify and restore servo settings when returning to factory firmware. |

Node.js tools require Node.js 20 or newer. Flashing and
settings recovery require Python 3.10 or newer. Simulation uses Python 3.12. Run commands from the repository
root and follow the relevant guide before connecting hardware: comparison tests
can move motors and overwrite settings, and flashing can damage a servo.
