# Quick start

For GD32F130-based STS TTL servos. Commands below use macOS/Linux shell syntax
and run from the repository root. Extension motion tools require firmware v9;
legacy replay also supports factory firmware.

## 1. Install

Install Node.js 20+ and Python 3.10+; the optional simulation viewer needs Python 3.12.

```sh
npm ci
python3 -m venv tools/flash/.venv
tools/flash/.venv/bin/python -m pip install -r tools/flash/requirements.txt
export SERVO_PORT=/dev/cu.usbmodemYOUR_ADAPTER
```

Replace the port with yours, such as `/dev/ttyUSB0` on Linux. Examples use motor
ID **1** and baud **1000000**; adjust these to match your servo.

## 2. Back up and flash

**Flashing can damage the servo or erase calibration.** Secure the mechanism,
use stable power, disable torque and close other serial programs. Settings must
be locked and alarms cleared before flashing. For normal custom flashing,
motors with unique IDs can stay connected: flash one ID at a time and do not
power-cycle the bus. Recovery requires only the intended servo connected.

```sh
npm run settings -- discover --port "$SERVO_PORT"
npm run settings -- backup --port "$SERVO_PORT" --id 1
```

Download the **custom firmware ZIP** from the
[v0.1-preview release](https://github.com/roboninecom/STS32XX-Firmware/releases/tag/v0.1-preview)
under **Assets**. Extract its firmware image and `release.json` together into
`tools/flash/releases/custom/`. Do not use GitHub's **Source code** archives for
flashing.

```sh
tools/flash/.venv/bin/python tools/flash/flash.py inspect \
  --manifest tools/flash/releases/custom/release.json
tools/flash/.venv/bin/python tools/flash/flash.py flash \
  --manifest tools/flash/releases/custom/release.json --port "$SERVO_PORT" --id 1
```

Type `FLASH` when prompted and keep power connected until verification finishes.
Repeat the flash command for each motor ID, waiting for verification each time.
See [flashing and recovery](tools/flash/README.md)
if verification fails.

The **factory firmware ZIP** is for returning to factory firmware, not for the
motion tools below. Extract it into a separate folder and follow
[factory settings restoration](tools/flash/README.md#restore-factory-settings)
after flashing. Keep each firmware image with its own `release.json`.

## 3. Calibrate joint offsets and limits

For a mechanism with bounded joint travel, select the motor IDs to calibrate:

```sh
npm run settings -- calibrate --port "$SERVO_PORT" --ids 1,2,3 \
  --file tools/settings/calibrations/arm.json
```

Replace the example IDs with yours; omit `--ids` to use all discovered motors
(up to six). For SO-101 and SO-102, see the
[labeled reference pose images](tools/settings/README.md#reference-pose-images).
The command has two steps:

1. Place every selected joint, including wrist roll and gripper, in the mechanism's
   reference pose. For a new setup without one, choose a repeatable pose near the
   middle of each joint's travel. Hold still and press **Enter** to save offsets
   so they read 2048 at that pose.
2. Move each selected joint end to end, pausing briefly at the ends.
   Review the live table and press **Enter** to save limits.

Support the mechanism throughout; do not force stops. Torque remains off. The file is
updated automatically and motor backups are retained. If the second step fails,
the first step's offsets remain saved: finish calibration before enabling motion.
The measured midpoint does not replace the captured reference. 2048 is only an
encoder reference; it does not establish a physical angle for simulation or gravity.
See [choosing the reference pose](tools/settings/README.md#choose-the-reference-pose).
Do this before recording poses or fitting gravity compensation. Existing arms
with verified calibration do not need recalibration after a settings-preserving flash.

## 4. Check communication

Keep torque off. Set `--ids` to the connected motors.

```sh
npm test
npm run bus-benchmark -- --port "$SERVO_PORT" --ids 1 --repetitions 100
npm run telemetry -- --port "$SERVO_PORT" --ids 1 --samples 1000 --interval-ms 20 \
  --output tools/diagnostics/results/first-check
```

`npm test` is offline. The other commands read hardware and print report paths.
Use a new telemetry output directory each time; adjust `--voltage-min` and
`--voltage-max` if your supply is outside the default 8–16 V range.
Inspect failures and flagged readings before motion. For factory/custom comparisons,
follow the [hardware test guide](tools/hw-diff-tests/README.md): its full suite
moves motors and replaces saved settings and reset templates.

## 5. Record and replay poses

Support the mechanism before releasing torque. Move it by hand, enter a name to
save each pose, then type `done`. Use all required motor IDs for an arm.

```sh
npm run record-poses -- --port "$SERVO_PORT" --ids 1
cp tools/pose-recorder/replay.example.json controller.json
```

Edit `controller.json`: set `followerPort`, provide a `profiles` entry for every
motor, and choose suitable gains, effort limits, speed and acceleration. Example
values are illustrative. Check saved calibration and position limits first.
The follower bus must contain exactly the configured motors. Replay handles
powered and unpowered motors and applies changed settings automatically.

Replace `POSES.json` with the recorder's saved path:

```sh
npm run replay -- controller.json POSES.json
npm run replay -- controller.json POSES.json --run
```

The first command previews; `--run` enables motion. **Normal completion leaves
motors powered, holding the final target. Ctrl+C is not an emergency stop.**
See [replay settings](tools/pose-recorder/README.md#replay-poses).

To compare using the motors' saved legacy PID settings, without compensation:

```sh
npm run replay-legacy -- POSES.json --port "$SERVO_PORT" --run
```

No controller file is needed. Omit `--run` for a read-only preview. See
[legacy replay](tools/legacy-replay/README.md) for speed and acceleration settings.

## 6. Enable gravity compensation

For `controller.json` in the repository root, add this top-level field:

```json
"gravityModel": "host/arm-control/models/arm-upright-empty.json"
```

The included model is for the calibrated, upright **SO-ARM-102 with an empty
gripper**. Include motors 1–6 and all six profiles. Motors 2–4 receive compensation;
the others receive zero. Encoder calibration must match; changed mounting,
geometry or payload needs a validated model. Do not change calibration merely
to bypass a mismatch.
For a different mechanism or calibration, fit and validate a matching model.

[SO-101 and SO-102 controller profiles](host/arm-control/profiles/README.md)
include PID, velocity feedforward and matching gravity models. Read their
limitations before use; they are tied to the fitted arms' calibration.

Replay, teleoperation and tuning use this same field. Gravity follows measured
positions while the tool runs; after exit, only the final effort is retained.
See the [gravity guide](host/arm-control/README.md) for model requirements.

## 7. Tune and view motion

Copy and edit the [tuning plan](tools/tuning/example.json) and
[controller example](tools/tuning/controller.example.json); set the plan's
`config` path to your controller file. For the first run, use small safe moves,
`"stage": "baseline"` and `"candidates": []`.

```sh
npm run tune -- inspect PLAN.json
npm run tune -- preflight PLAN.json
npm run tune -- run PLAN.json
```

Only `run` moves hardware. Follow the [tuning order](tools/tuning/README.md#tuning-order):
baseline → gravity → velocity feedforward → P/D and filtering → integral if needed
→ acceleration/ramp time → combined motion → validation.

For visualization, install the [simulation viewer](tools/simulation/README.md),
then use the event-log path printed by replay or tuning:

```sh
tools/simulation/.venv/bin/python tools/simulation/viewer.py live EVENTS.ndjson --model so101
tools/simulation/.venv/bin/python tools/simulation/viewer.py play EVENTS.ndjson --model so101
```

Use `--model so102` for the other bundled arm model. Check the reference-pose
convention in the viewer guide. The command handles the macOS window launcher
automatically. The viewer displays measured motion; it does not predict tuning results. For hand-operated
control using separate leader and follower adapters, see [teleoperation](tools/teleoperation/README.md).
