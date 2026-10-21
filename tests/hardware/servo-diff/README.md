# Hardware differential tests

Compare the same operation on a servo running factory firmware and a servo
running the firmware under test. The suite records what each device did, compares
the results and saves the requests, responses and timing in a JSON report.

There are **188 scenarios in 39 case files**, covering the legacy STS protocol:
communication, register behavior, motion, limits, protection, calibration and
saved settings. Extension protocol v9 control is not exercised by these scenarios.
The suite uses the [shared servo driver](../../../host/servo-driver/README.md) in
this repository. It needs neither another checkout nor private flashing tools.

**Use a dedicated test bench, not an assembled arm, for the full suite.** Some
tests make long or continuous moves, change motor direction or operating mode,
trigger protection, recalibrate positions, or replace saved settings. Full-suite
cleanup loads the saved reset-template defaults; it does **not** restore the
settings that were active before the run. Read [Settings and cleanup](#settings-and-cleanup)
before selecting anything beyond the initial checks.

## Contents

- [Installation and offline checks](#installation-and-offline-checks)
- [Prepare the bench](#prepare-the-bench)
- [First comparison](#first-comparison)
- [Select tests](#select-tests)
- [Settings and cleanup](#settings-and-cleanup)
- [Stage reference](#stage-reference)
- [Important regression cases](#important-regression-cases)
- [One-device runs and saved references](#one-device-runs-and-saved-references)
- [Reports and verdicts](#reports-and-verdicts)
- [Troubleshooting and interruption](#troubleshooting-and-interruption)
- [Command reference](#command-reference)
- [Maintain and extend the suite](#maintain-and-extend-the-suite)

## Installation and offline checks

Install Node.js **20 or newer** and use a terminal in the repository root. The
only runtime package dependency is `serialport`, installed by the root package.

```sh
npm ci
npm run test:diff
npm run diff -- --help
npm run diff -- --list
```

These commands do not open a serial port. `test:diff` runs fake-device tests of
selection, comparison, packet handling, fixture setup, regressions and cleanup.
`--list` prints each scenario's stages, motion classification and exact name.
The complete offline host suite is `npm test` or `make host-verify`; neither
starts the hardware scenarios. A successful offline check is not a hardware pass.

The examples below use POSIX shell syntax. Set `SERVO_PORT` to your adapter:

```sh
# macOS example; replace the device name with your own.
export SERVO_PORT=/dev/cu.usbmodemYOUR_ADAPTER
# A Linux adapter may instead be /dev/ttyUSB0 or /dev/ttyACM0.
```

On Windows, supply the port directly, for example `--port COM3`. Installation
and serial-adapter behavior should be checked on each intended platform; this
suite's existing hardware workflow was developed on macOS. The CLI does not
discover the port or configure the servos' IDs for you.

## Prepare the bench

1. Connect only the intended test devices to a compatible STS serial-bus adapter.
   Use a suitable external motor supply and common ground. A generic USB UART
   is not necessarily an appropriate half-duplex servo-bus interface.
2. Assign distinct IDs beforehand. Examples use **factory ID 1** and
   **candidate ID 2**, both at **1,000,000 baud**. Supply different IDs explicitly
   when needed. Avoid 250 and 251 for the full suite: a communication case uses
   those as temporary addresses and requires them to be free.
3. Close other serial programs, including teleoperation, dashboards and flashing
   tools. One process should own the adapter.
4. Start with motor power disabled through torque-enable register **40 = 0**,
   persistent writes locked through register **55 = 1**, and no active alarm.
   Use ordinary position mode for cases that require it. Do not change settings
   just to bypass a failed prerequisite without understanding the failure.
5. Secure the servo bodies and leave the shafts free for the selected motion.
   Remove links, loads or mechanisms that cannot tolerate the requested travel.
   Have a way to remove motor supply independently of the host program.
6. Save your settings using your normal backup tool before configuration-changing
   tests. A register snapshot in a report is evidence, not an automatically
   restorable backup and not a copy of the hidden reset template.

Some scenarios send broadcasts, change baud, or apply staged writes. Extra
devices on the bus can receive those commands even if their IDs were not selected.

Use comparable motors, supply conditions and mechanical loading when interpreting
motion differences. A comparison between unlike motors can still reveal protocol
differences, but it does not isolate firmware as the cause of different motion.
Record model, firmware release/image identity, adapter, supply and load alongside
the report. This suite does not read back or prove a firmware-image hash.

## First comparison

Begin with a single PING case. This checks communication without writing settings:

```sh
npm run diff -- --port "$SERVO_PORT" \
  --factory-id 1 --candidate-id 2 --case test_ping
```

Then compare register-table read lengths and retain both raw tables:

```sh
npm run diff -- --port "$SERVO_PORT" \
  --factory-id 1 --candidate-id 2 --case test_register_read_map
```

These checks do not compare every register value for equality: serial identity,
calibration and live sensor values may legitimately differ.

The default `safe` stage runs these two cases and a read-only permission check:

```sh
npm run diff -- --port "$SERVO_PORT" --stage safe
```

That third case attempts to write a model-identification byte and checks that it
did not change. **`safe` means no driven motion in the suite's classification;
it does not mean that no WRITE packet is sent.** Other non-motion stages can
reset a servo or change durable settings when explicitly enabled.

Successful output resembles:

```text
V [1/3] test_ping (passed)
V [2/3] test_register_read_map (passed)
V [3/3] test_read_only_permission (passed)
Report: .../tests/hardware/servo-diff/results/TIMESTAMP/report.json
```

## Select tests

Use `--case` for one exact scenario or `--stage` for a related group. `--case`
overrides stage selection and does not install the full-suite fixture, even if
`--stage all` is also present. It still requires the selected case's opt-ins.
Focused runs do not automatically run the prerequisites or establish the full
suite's known gains and settings.

For example, the write-order regression moves the motors and requires permission
to do so:

```sh
npm run diff -- --port "$SERVO_PORT" \
  --case test_motion_write_order_gap_matrix --allow-motion
```

The following flags authorize different effects. They are checked before the
serial connection opens; they do not configure the bench or make a scenario
appropriate for an attached mechanism.

| Flag | Allows |
|---|---|
| `--allow-motion` | Cases that enable drive or issue motion commands, including the zero-output torque-limit regression |
| `--allow-persistence-write` | Durable settings writes, offset calibration and restore-defaults cases |
| `--allow-template-write` | Saving a replacement reset template, including the durable restoration performed by that case |
| `--allow-current-protection` | Driven current-protection experiments; also needs `--allow-motion` |

The full suite requires all four flags and an initial 1 Mbaud connection:

```sh
# Dedicated free-running bench only; replaces settings and the reset template.
npm run diff -- --port "$SERVO_PORT" --stage all \
  --allow-motion --allow-persistence-write \
  --allow-template-write --allow-current-protection
```

It includes long/high-speed motion and intentional protection faults. There is
no overall duration limit. Use focused stages first; `--fail-fast` stops after
the first non-passing case. Without it, ordinary failures and mismatches are
recorded while independent cases continue. Cleanup failure, failed prerequisites,
selected safety-case failures and lost communication stop further cases.

## Settings and cleanup

Three distinct operations are easy to confuse:

- **System reset** restarts the application and reloads saved settings, clearing
  temporary state.
- **Restore defaults, instruction `0x06`**, loads the device's saved reset
  template. It does not necessarily recreate the manufacturer's original settings.
- **Save reset template, instruction `0x09`**, replaces that template with current
  settings. The previous unknown template cannot be recovered by this protocol.

| Run type | Setting effects and final state |
|---|---|
| PING/read cases | No intentional setting changes |
| Most focused RAM cases | Temporarily change settings, then restore directly or reset and verify; see the case's checks |
| Focused persistence cases | Commit test values and restore original persistent bytes; real flash/EEPROM writes occur |
| `test_prerequisite_set_offset` | Sets the displayed position to 2048 and verifies it after reset; **the new offset remains saved** |
| `restore-defaults` | Ends with the saved template loaded, not the original live settings |
| `template` | Restores the pre-test active settings and saves them as the new template; **the old template is replaced** |
| `all` | Restores defaults first, installs a known persistent test configuration, then finishes by loading the saved template and checking identity, baud, torque off and lock |

In a successful full run, the template case saves the suite settings as the new
template. Final cleanup therefore loads those settings. If the run stops before
that case, the available template may be different. Do not interpret either
outcome as restoration of the settings that existed before the run.

The full fixture sets known gains, output limits, operating mode, units and
protection timings. It retains device-specific identity, direction/topology,
offset and sensor-limit fields when building that fixture. Reports include
snapshots, but fixture cleanup deliberately uses `0x06` rather than restoring
the original snapshot. The [fixture source](src/suite-fixture.js) contains the
exact values.

The `prerequisites` stage itself includes restore-defaults and saved-offset
calibration. It is **not** a read-only startup check:

```sh
# Changes saved settings and calibration.
npm run diff -- --port "$SERVO_PORT" --stage prerequisites \
  --allow-persistence-write
```

Instruction `0x0B` can commit a position offset even when the ordinary write lock
is set. Selecting `test_prerequisite_set_offset` directly therefore also requires
`--allow-persistence-write`.

## Stage reference

Flags below are required for the entire stage. A dash means no additional flag,
not necessarily no writes. Some scenarios belong to multiple stages, so counts
must not be added to calculate the total. `--list` is the current case inventory.

| Stage | Cases | Required flags | Purpose and notable effects |
|---|---:|---|---|
| `safe` | 3 | — | PING, table read and attempted write to a read-only byte |
| `prerequisites` | 6 | persistence | Basic commands, reset, defaults and saved offset alignment |
| `commands` | 8 | persistence | Broadcast/staged commands, response level, argument handling and restore-defaults |
| `communication` | 3 | — | Home-command behavior, temporary IDs 250/251, invalid baud selector; reset/recovery |
| `baud` | 8 | — | Coordinated baud changes on both devices and sync response ordering; pair mode, initial 1 Mbaud |
| `sync-timing` | 1 | — | Sync responses at all non-default baud rates; pair mode, initial 1 Mbaud |
| `registers` | 6 | — | Byte reads, permissions, bounds and undocumented RAM behavior |
| `register-writes` | 35 | — | Locked persistent-register and RAM write/readback checks |
| `value-matrix` | 7 | — | Multiple values for gains, acceleration and runtime output cap |
| `register-behavior` | 22 | motion | Driven effects of gains, polarity, limits, scaling, offset and motion settings |
| `malformed` | 7 | — | Checksum, embedded header, truncation and parser recovery |
| `sync` | 12 | — | Sync read/write ordering, lengths, duplicates and isolation |
| `staged` | 3 | — | Deferred writes, replacement and discard on reset |
| `timing` | 1 | — | Host-observed request/response latency |
| `eeprom-timing` | 2 | persistence | Durable-write latency and acquisition under bus traffic |
| `persistence-traffic` | 1 | persistence | Durable commits while requests continue |
| `persistence` | 5 | motion, persistence | Saved motion/gain settings and their effects after restart |
| `persistence-matrix` | 8 | persistence | Durable readback/restoration for additional configuration bytes |
| `restore-defaults` | 1 | persistence | Tests `0x06`; leaves saved defaults active |
| `template` | 1 | template | Tests `0x09`; replaces the previous reset template |
| `calibration` | 2 | motion, persistence | Offset restoration alarms and explicit signed calibration targets |
| `lerobot` | 2 | persistence | Immediate homing coordinates and sensors during repeated durable writes |
| `protection` | 4 | — | Temporary voltage/temperature thresholds and hysteresis, without driven motion |
| `drive-protection` | 4 | motion | Voltage/temperature shutdown masks and profile behavior while driven |
| `current-protection` | 2 | motion, current protection | Current/stall shutdown and duration during long swipes |
| `modes` | 1 | — | Mode changes with torque off |
| `mode-motion` | 5 | motion | Position, velocity, PWM, relative mode and driven transitions |
| `motion-requests` | 1 | motion | Replacing goals and zero-speed behavior |
| `profiles` | 15 | motion | Long forward/reverse swipes across speed/acceleration/output settings |
| `motion-matrix` | 4 | motion | Speed 900/3000 with acceleration 10/80, legacy units |
| `extended-motion` | 6 | motion | Repeated full-range goals, wrap boundaries and long constant-speed motion |
| `extended-motion-fast` | 1 | motion | Full-range bursts with faster telemetry |
| `fixed-rate-motion` | 7 | motion | Command streams at 20, 40, 60, 80, 100, 150 and 200 Hz |
| `telemetry` | 2 | motion | Live motion fields and snapshot coherence under reversals |
| `rapid` | 3 | motion | Burst versus paced writes and goal ordering/gap matrix |
| `torque` | 1 | motion | Runtime output cap and torque gate |
| `torque-enable-limits` | 1 | motion | Enable outside limits with verified zero output; explicit-goal positive control |

In this table, `motion`, `persistence`, `template` and `current protection` mean
their corresponding `--allow-...` flags above. “Extended motion” is a longer
legacy test workload, not extension-protocol control. Raw settings and motion
units belong to the legacy protocol; they are not v9 gain or acceleration values.

## Important regression cases

### LeRobot calibration and sensor integrity

```sh
npm run diff -- --port "$SERVO_PORT" --stage lerobot \
  --allow-persistence-write
```

The shaft must stay stationary, with torque off, persistence locked and position
mode selected. Keep the raw encoder away from endpoint 4095, where the tested
LeRobot half-turn offset exceeds its sign-bit-11 magnitude range.

- `test_lerobot_persistent_write_sensor_integrity` alternates 100 durable offset
  writes, with 30 full telemetry reads immediately after each. It checks alarms,
  voltage/current consistency and zero PWM without resetting between trials.
- `test_lerobot_immediate_offset_homing` runs 20 clear-offset → immediate read →
  calculated centre offset → immediate read sequences. It alternates individual
  READ and single-ID SYNC_READ. No sleep, retry or unrelated transaction hides
  the critical write/read ordering. The expected centre is 2047 ±2 counts.

Both restore the original offset, reset and verify persistent bytes, lock, torque
and status. These reproduce relevant wire sequences in Node.js; they do not run
the full Python LeRobot application or require it as a dependency.

Temperature is raw diagnostic data in this suite. These LeRobot cases fail after
three consecutive temperature readings more than 8°C from entry, while retaining
isolated outliers in the evidence. Voltage tolerance is 10 raw units (1 V), and
current tolerance is 50 raw units. These are stationary regression bounds, not
operating limits or an operational temperature filter. Alarm flags fail immediately.

### Torque enable outside saved limits

```sh
npm run diff -- --port "$SERVO_PORT" --stage torque-enable-limits --allow-motion
```

This tests measured position below the minimum, above the maximum, inside the
range, and equal limits with an old goal present. Expected factory behavior is
to retain the measured position as the active target when torque alone is enabled.
A later explicit goal must still advance the profile and cap to configured limits.

Before enabling, the case verifies zero output cap and zero P/D/I/punch. It checks
zero PWM and a stationary shaft throughout. It requires torque off at entry,
position mode, divisor 1 and a displayed position of 240–3855. RAM-only setup is
followed by reset and persistent-image/lock/torque/status verification. The motion
gate remains required because the case writes torque enable.

### Motion write ordering

`test_motion_write_order_gap_matrix` compares goal-first and goal-last acknowledged
writes with 0 and 10 ms added gaps. The broader `rapid` stage also compares burst
and paced register writes. Inspect per-device observations and the case comparator
when diagnosing a mismatch; identical final registers do not prove identical
profile activation or shaft motion.

## One-device runs and saved references

Pair mode executes each device-scoped scenario against factory then candidate.
Pair-scoped scenarios exercise both devices together.

You can instead record a factory observation and compare a later candidate run:

```sh
npm run diff -- --port "$SERVO_PORT" --mode factory \
  --factory-id 1 --candidate-id 2 --case test_staged_multiregister_ram_write

npm run diff -- --port "$SERVO_PORT" --mode candidate \
  --factory-id 1 --candidate-id 2 --case test_staged_multiregister_ram_write \
  --reference tests/hardware/servo-diff/results/FACTORY_TIMESTAMP/report.json
```

Replace the reference path with the first run's output. The second command runs
device-scoped cases against the candidate; the factory ID remains metadata that
must match the saved reference. Both ID options must remain distinct even in
single-device mode. Testing the same physical servo before and after flashing
therefore currently requires assigning it a different candidate ID before the
candidate run. Retain the original factory ID in the reference comparison; the
suite does not make that ID change for you.

Reference validation happens before the port is opened. The file must contain a
passing factory observation for every selected device case and use the same
factory ID and baud. Pair-only cases are skipped in single-device mode.

A single-device run without `--reference` checks the scenario's own assertions;
its `passed` status is **not** a differential match. Saved references describe a
particular image, settings, test revision and bench condition. The current runner
does not enforce all those identities automatically. Keep the same suite revision
and comparable conditions, and store that provenance with your reports.

## Reports and verdicts

Each run creates a timestamped directory under `tests/hardware/servo-diff/results/`
unless `--results DIRECTORY` is supplied. The main artifact is `report.json`.
Generated results and logs are excluded by the repository's wildcard ignore rules;
use an ignored results directory for custom output as well.

| Field | Meaning |
|---|---|
| `runId`, `startedAt`, `finishedAt` | Run identity and wall-clock bounds |
| `config`, `selection` | Port, IDs, baud, selected case/stage and fixture policy |
| `cases[]` | Scenario, outcome, coverage, observations and comparison |
| `observations[].result.exact` | Fields compared exactly unless the case provides its own comparison |
| `observations[].result.evidence` | Measurements, snapshots and explanatory detail |
| `observations[].eventRange` | Start-inclusive/end-exclusive indexes into `events` |
| `comparison` | Case-specific comparison and tolerances, where provided |
| `events[]` | Transmitted hex, received frames/status bytes, timing and errors |
| `fatal`, `cleanupError`, `closeError` | Setup/run, fixture restoration or connection-close failures |

| Verdict | Interpretation |
|---|---|
| `passed` | Assertions and any available comparison passed |
| `mismatch` | Both devices produced observations but the comparison differed |
| `failed` | A device assertion, exchange, health or recovery check failed |
| `inconclusive` | The required factory response, such as measurable motion, was not produced; equivalence is not established |
| `skipped` | Not executed, for example after a hard stop or because pair mode is required |

Terminal marks are `V` for passed, `X` for failed/mismatch/inconclusive and `-`
for skipped. Read the verdict text, not just the mark. Default behavior continues
after ordinary failures; use `--fail-fast` when you want to stop sooner.

Timing is measured on the host. It includes scheduling, USB buffering, serial
transfer and firmware response. `writeDrain` is the transport's drain completion,
not a wire-level transmit-end measurement. Timing does not establish the duration
of a firmware interrupt or control tick. Device clocks and motion samples also
should not be treated as synchronized across the two motors.

Status/error bytes and raw sensor values are retained deliberately. Not every
case treats a nonzero status as unexpected: protection tests intentionally cause
alarms. Inspect the scenario assertions before interpreting raw status or a
temperature anomaly as a suite-wide protection verdict.

Exit codes:

- **0:** no failed, mismatched or inconclusive case and no reported fatal/cleanup/
  close error. Pair-only skips may still be present; zero does not mean all cases ran.
- **1:** argument/permission-gate failure or an exception outside normal report
  handling. A report may not exist.
- **2:** a reported failed/mismatched/inconclusive case, fatal error, cleanup error
  or connection-close error.

## Troubleshooting and interruption

| Symptom | What to inspect |
|---|---|
| Port cannot open | Device path, permissions, cable/adapter and another process holding the port |
| No PING response | Motor supply, common ground, correct ID and current baud; start with one known device |
| A gate refuses the run | Read the selected stage's effects; add only the applicable opt-ins for a prepared bench |
| Focused motion case fails immediately | Its required mode, limits, torque/lock/status and configuration; focused runs do not install the full fixture |
| Motion mismatch | Factory stimulus validity, supply/load differences, directions, timing and the recorded comparison tolerances |
| Cleanup or recovery failure | Stop further tests and inspect the recorded operation and cleanup errors; do not assume reset restored settings |
| Reference rejected | Candidate mode, factory ID, baud and passing factory observations for every selected device case |
| Report missing after interruption | The runner normally writes the report at completion; forced exit can interrupt both saving and cleanup |

The CLI currently has **no graceful SIGINT/SIGTERM recovery handler**. Ctrl+C,
forced termination, adapter loss or power loss can interrupt cleanup and leave
an incomplete or missing report. `--fail-fast` provides orderly stopping after a
case result; it is not an emergency stop. Host software cannot guarantee delivery
of torque-off over a failed connection. Use the bench's independent power control
when motion must stop immediately, then reconnect and verify ID, baud, settings,
torque, lock and alarms before another run.

Do not flash firmware as an automatic response to a mismatch. Preserve the report,
identify the failed expectation and reproduce a focused case under known conditions.

## Command reference

All commands below run from the repository root. `npm run diff --` forwards the
remaining arguments to `tests/hardware/servo-diff/src/cli.js`.

| Option | Default / behavior |
|---|---|
| `--help` | Usage without serial access |
| `--list` | List all scenarios without serial access; does not filter by stage |
| `--port PORT` | Required for a hardware run |
| `--baud RATE` | `1000000`; configures host connection, not initial servo baud |
| `--factory-id ID` | `1`; integer 0–253 |
| `--candidate-id ID` | `2`; integer 0–253, different from factory ID |
| `--mode pair\|factory\|candidate` | `pair` |
| `--stage NAME` | `safe`; valid names are in the stage table and `--list` |
| `--case NAME` | Exact case selection overrides stage selection and automatic full-fixture setup |
| `--reference FILE` | Factory report, only with candidate mode |
| `--results DIRECTORY` | Parent for timestamped output directories |
| `--fail-fast` | Stop after first non-passing case; normal cleanup still attempted |
| `--allow-motion` | Opt in to drive/motion cases |
| `--allow-persistence-write` | Opt in to durable settings/calibration/defaults cases |
| `--allow-template-write` | Opt in to replacement of saved reset template |
| `--allow-current-protection` | Opt in to driven current-protection cases |

## Maintain and extend the suite

The imported scenarios retain their legacy comparisons and tolerances. Packaging
them with the current driver does not requalify their physical behavior on a new
motor, adapter or firmware image. Run the offline suite first, then record bounded
hardware evidence for any changed behavior.

```text
src/cli.js                 argument parsing and terminal progress
src/runner.js              selection, permission gates, comparison and reports
src/rig.js                 serialized wire exchanges and host timing
src/suite-fixture.js       full-run persistent configuration and defaults cleanup
src/motion.js              bounded motion helpers and drive-readiness checks
src/persistence.js         persistent-write restoration helper
src/register-image.js      persistent register-image selection
src/position.js            position arithmetic and calibration expectations
src/calibration-classify.js calibration observation classification
src/cases/*.js             scenario declarations and assertions
test/*.test.js             offline fake-device and regression tests
```

Each case module exports an array. Each entry needs a unique `test_...` ID,
`scope` (`device` or `pair`), `risk` (`safe` or `motion`), `stages`, `covers` and
an asynchronous `run` function. Add `requiresPersistenceWrite`,
`requiresTemplateWrite` or `requiresCurrentProtection` for the corresponding
effects. A non-motion calibration can still require persistence permission.

Return `{ exact, evidence }`; add `compare(factory, candidate)` when exact
equality is inappropriate. Return a `matched` boolean and useful comparison
details. Motion cases that need observable factory drive should declare
`requiresFactoryEffect` and, where needed, `validateFactoryStimulus` so a stalled
or inactive reference cannot make a candidate look correct.

Restore state in case-local error paths and verify the result. Raise `CleanupError`
when restoration fails so the runner stops later hardware actions. Include offline
fault-injection tests for recovery and cases that could falsely pass without their
intended stimulus. Raw logs and hardware reports belong in ignored output
directories, not in source control.
