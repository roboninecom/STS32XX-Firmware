# Hardware comparison tests

Compare factory and custom firmware on STS servos. The suite covers the legacy
protocol, settings, motion, calibration and protection. It does not test extension
protocol v9 control. Tests use the repository's [shared driver](../../host/servo-driver/README.md).

**Use a dedicated bench with secured servos and free shafts.** Some tests make
long or continuous moves and replace saved settings or calibration. Back up each
servo first. Keep a way to disconnect motor power immediately.

## Setup

Install Node.js **20 or newer**, then run from the repository root:

```sh
npm ci
npm run test:diff
npm run diff -- --list
```

These commands run offline. `--list` shows each scenario's stage, motion
classification and exact name. Use `--help` for all command options.

Connect only the test servos: some cases use broadcasts. Close other programs
using the adapter and provide a suitable motor supply. Default connections are:

| Setting | Default |
|---|---|
| Factory servo ID | `1` |
| Custom firmware servo ID | `2` |
| Baud rate | `1000000` |

Set different values with `--factory-id`, `--candidate-id` and `--baud`. IDs must
be distinct; leave IDs **250 and 251** unused because tests use them temporarily.
Start with torque off, settings writes locked and no active alarms. Use comparable
motors, power supplies and loads when comparing motion.

```sh
export SERVO_PORT=/dev/cu.usbmodemYOUR_ADAPTER
```

Replace the port with your own. Linux commonly uses `/dev/ttyUSB0`; on Windows,
pass a port directly, such as `--port COM3`.

## Run tests

Start with a communication check:

```sh
npm run diff -- --port "$SERVO_PORT" --case test_ping
```

Run the default group:

```sh
npm run diff -- --port "$SERVO_PORT" --stage safe
```

The `safe` group checks PING, register reads and rejection of a write to a
read-only register. It does not drive the motors, but it does send a WRITE packet.

Select a group with `--stage`, or one exact scenario with `--case`:

```sh
npm run diff -- --port "$SERVO_PORT" \
  --case test_motion_write_order_gap_matrix --allow-motion
```

`--case` overrides `--stage`. Focused runs use the existing servo settings;
they do not install the full suite's test configuration. Check a case's reported
prerequisites if it cannot start.

| Permission | Allows |
|---|---|
| `--allow-motion` | Enabling drive or issuing motion commands |
| `--allow-persistence-write` | Saved settings writes, calibration and restore-defaults |
| `--allow-template-write` | Replacing the saved reset template |
| `--allow-current-protection` | Driven current-protection tests; also needs motion permission |

The full suite requires all four permissions and an initial baud rate of 1000000:

```sh
npm run diff -- --port "$SERVO_PORT" --stage all \
  --allow-motion --allow-persistence-write \
  --allow-template-write --allow-current-protection
```

Add `--fail-fast` to stop after the first non-passing case. Otherwise, independent
cases continue after ordinary failures. Failed prerequisites, cleanup failures
and lost communication stop further tests.

## Settings and cleanup

**The full suite does not restore your original settings.** It installs a saved
test configuration and finishes by loading the servo's reset template. The
template test replaces that template with the suite settings.

These focused tests also have lasting effects:

- `prerequisites` includes restore-defaults and calibration. Its offset test
  saves a new offset that places the displayed position at 2048.
- `restore-defaults` loads the saved reset template (`0x06`), which may differ
  from the manufacturer's original settings.
- `template` replaces the reset template (`0x09`) with the pre-test active
  settings. The old template cannot be read back or restored by this suite.

Other persistence cases attempt to restore the settings they changed. Always
inspect cleanup errors before another run. See the [settings backup and recovery
guide](../flash/README.md#restore-factory-settings) for backup commands and factory recovery.

**Ctrl+C does not guarantee cleanup or a saved report.** The runner has no graceful
interruption handler. If motion must stop immediately, disconnect motor power;
then verify communication, settings and torque state before continuing.

## Compare against a saved factory run

Use the same cases, suite revision, baud rate and comparable bench conditions:

```sh
npm run diff -- --port "$SERVO_PORT" --mode factory --case test_ping

npm run diff -- --port "$SERVO_PORT" --mode candidate --case test_ping \
  --reference tools/hw-diff-tests/results/FACTORY_TIMESTAMP/report.json
```

Replace the reference path with the first run's report. Keep the original factory
ID in `--factory-id`; the candidate must have a different ID, even when testing
the same physical servo after flashing. The suite does not change that ID for you.
Pair-only cases are skipped in single-device mode. Without `--reference`, a
single-device pass checks only that scenario's assertions, not factory equivalence.

## Results

Reports are saved under `tools/hw-diff-tests/results/`, or the directory supplied
with `--results`. Results and logs are ignored by Git.

Open `report.json` for each device's observations, comparisons, transmitted
packets, received responses and timing. Inspect `fatal`, `cleanupError` and
`closeError` as well as the case results.

| Result | Meaning |
|---|---|
| `passed` | Assertions and any available comparison passed |
| `mismatch` | Factory and candidate observations differed |
| `failed` | An assertion, communication or recovery check failed |
| `inconclusive` | The factory did not produce the effect needed for comparison |
| `skipped` | The case was not run |

Exit code **0** means no reported failures; skipped cases may remain. **1** means
an argument/setup error or an unhandled exception. **2** means the report contains
a failure, mismatch, inconclusive result or cleanup/connection-close error.

Timing includes host scheduling, USB and serial delays; it is not a direct
measurement of firmware execution time. Preserve the report and reproduce a
focused case before attributing a motion difference to firmware.
