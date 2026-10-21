# Verification

Run `make verify` from the repository root. It builds the selected target
profile, runs sanitized C regressions, and checks the register contract,
storage fixture, module boundaries, profile manifest, and image layout.

`fixtures/` contains required, pinned regression inputs. The synthetic plant
tests cover controller regressions; they do not qualify a physical arm.
Coverage includes a full minute of motion and holding without host updates,
persistent gravity compensation, position correction after a disturbance,
sensor and motor protection, rejection of removed extension commands, sequence gaps and half-range boundaries,
and repeated counter wraparound without rearming. Legacy travel-limit coverage
checks target capping, inclusive boundaries, out-of-range startup rejection,
disabled/invalid limits, and session invalidation after either limit changes.
Runtime tests also cover setup without power, position capture on enable,
repeated enable during motion, consumed setup after a failed start, protection
shutdown/restart, and rejection of the retired ARM selector.
Legacy command-order regressions verify that an explicit torque write cancels
automatic enable queued by an earlier goal before the next sensor pair. A new
goal received afterward can still enable torque normally.

The three October 10 fixes ported from the separate `rewrite` repository retain
their regressions here:

- `82e5c12`: ADC cancellation before DMA shutdown, late interrupts, and clean scan
  configuration after restart (`sensor_driver_test.c`).
- `7bb7de2`: immediate corrected-position publication after offset writes,
  including the clear/read/home calibration sequence across acquisition restart
  without treating cached readings as fresh (`sensor_service_test.c`).
- `1661003`: legacy torque enable holds the measured position, including outside
  saved limits; new absolute/relative goals still move and clamp
  (`control_pipeline_test.c`).

`make host-verify` runs the host tests without opening serial ports. These check
v9 packet layouts, selection/session encoding and startup ordering,
failed-enable cleanup, normal-exit target retention, and torque-off cleanup on errors.

`hardware/` contains stationary telemetry and bus/stack timing diagnostics.
These tools require explicit device selection and, for timing measurements,
a firmware build with `TIMING_PROBE=1` or `TIMING_PROBE=arm`.
They are not invoked by offline verification.

## Hardware differential tests

The [servo comparison suite](hardware/servo-diff/README.md) compares factory
firmware with a candidate on a dedicated bench. It includes communication,
registers, motion, protection, persistence, calibration and LeRobot regressions.
It uses this repository's shared host driver; no sibling checkout is required.

Run `npm run test:diff` for its offline tests, or `npm run diff -- --list` to list
hardware scenarios without opening a serial port. `npm test` includes the offline
suite. Hardware execution requires an explicit port and separate opt-ins for
motion, persistent writes, template writes and driven current protection.

Read the suite manual before connecting hardware: the full run replaces live
settings with a test configuration and finishes at saved reset-template defaults,
not the user's starting settings. It is not an assembled-arm smoke test.
