# Firmware tests

Run commands from the repository root. These commands do not connect to hardware.

| Command | Coverage |
| --- | --- |
| `make verify` | Firmware build, sanitized C tests, register contract, storage fixtures, module boundaries and image layout. |
| `npm test` or `make host-verify` | Driver, shared controller and Node.js tools. |
| `npm run test:driver-package` | Isolated installation of the driver package using cached npm dependencies. |
| `make flash-verify` | Flashing and settings recovery with simulated serial devices; activate the flash Python environment first. |
| `PYTHONPATH=tools/simulation tools/simulation/.venv/bin/python -m unittest discover -s tools/simulation/test` | Model import, recording readers and viewer behaviour. |

`fixtures/` contains required regression inputs. Keep them with the tests.
Install the firmware toolchain as described in the [root guide](../../README.md),
and each Python tool's requirements before running its checks.

## Hardware tests

The [comparison suite](../../tools/hw-diff-tests/README.md) requires a dedicated
bench. List scenarios with `npm run diff -- --list`. Motion and persistent
writes require explicit options. The full suite installs a test configuration
and finishes at saved reset-template defaults; it does not restore the initial
settings and is not suitable as an assembled-arm smoke test.

The [diagnostics tools](../../tools/diagnostics/README.md) measure bus latency and
stationary telemetry on ordinary firmware.
