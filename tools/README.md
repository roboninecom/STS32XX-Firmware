# Tools

Utilities for working with STS servos. Each guide includes setup instructions,
commands and hardware requirements. For application development, use the
[Node.js servo driver](../host/servo-driver/README.md), available as a standalone
npm package built from this repository.

| Tool | Purpose |
| --- | --- |
| [Discovery and settings](settings/README.md) | Find motors and back up or restore their persistent settings. |
| [Hardware comparison tests](hw-diff-tests/README.md) | Compare factory and custom firmware behaviour on a dedicated servo bench. |
| [Bus benchmark and telemetry](diagnostics/README.md) | Measure communication latency and check stationary readings for unusual values. |
| [Firmware flashing](flash/README.md) | Upload published encoded firmware images and recover interrupted uploads. |
| [Settings recovery](flash/FACTORY_RECOVERY.md) | Back up, verify and restore servo settings when returning to factory firmware. |

Discovery, settings, comparison and diagnostics tools require Node.js 20 or newer. Flashing and
settings recovery require Python 3.10 or newer. Run commands from the repository
root and follow the relevant guide before connecting hardware: comparison tests
can move motors and overwrite settings, and flashing can damage a servo.
