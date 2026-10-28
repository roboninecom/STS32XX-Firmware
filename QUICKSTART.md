# Quick start

For GD32F130-based STS TTL servos. Commands below use macOS/Linux shell syntax
and run from the repository root. Motion tools require extension firmware v9.

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

**Flashing can damage the servo or erase calibration. Connect only one servo to
the adapter.** Secure it, use stable power, disable torque and close other serial
programs. Settings must be locked and alarms cleared before flashing.

```sh
npm run settings -- discover --port "$SERVO_PORT"
npm run settings -- backup --port "$SERVO_PORT" --id 1
```

Obtain a compatible firmware image and its matching `release.json` from
the publisher. Keep both files together in `tools/flash/releases/`.

```sh
tools/flash/.venv/bin/python tools/flash/flash.py inspect \
  --manifest tools/flash/releases/release.json
tools/flash/.venv/bin/python tools/flash/flash.py flash \
  --manifest tools/flash/releases/release.json --port "$SERVO_PORT" --id 1
```

Type `FLASH` when prompted and keep power connected until verification finishes.
Repeat separately for each motor. See [flashing and recovery](tools/flash/README.md)
if verification fails.

## 3. Check communication

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

## 4. Record and replay poses

Support the mechanism before releasing torque. Move it by hand, enter a name to
save each pose, then type `done`. Use all required motor IDs for an arm.

```sh
npm run record-poses -- --port "$SERVO_PORT" --ids 1
cp tools/pose-recorder/replay.example.json controller.json
```

Edit `controller.json`: set `followerPort`, provide a `profiles` entry for every
motor, and choose suitable gains, effort limits, speed and acceleration. Example
values are illustrative. Check saved calibration and position limits first.
The follower bus must contain exactly the configured motors, initially torque-off.

Replace `POSES.json` with the recorder's saved path:

```sh
npm run replay -- controller.json POSES.json
npm run replay -- controller.json POSES.json --run
```

The first command previews; `--run` enables motion. **Normal completion leaves
motors powered, holding the final target. Ctrl+C is not an emergency stop.**
See [replay settings](tools/pose-recorder/README.md#replay-poses).

## 5. Enable gravity compensation

For `controller.json` in the repository root, add this top-level field:

```json
"gravityModel": "host/arm-control/models/arm-upright-empty.json"
```

The included model is for the calibrated, upright **SO-ARM-102 with an empty
gripper**. Include motors 1–6 and all six profiles. Motors 2–4 receive compensation;
the others receive zero. Encoder calibration must match; changed mounting,
geometry or payload needs a validated model. Do not change calibration merely
to bypass a mismatch.

Replay, teleoperation and tuning use this same field. Gravity follows measured
positions while the tool runs; after exit, only the final effort is retained.
See the [gravity guide](host/arm-control/README.md) for model requirements.

## 6. Tune and view motion

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
baseline → gravity → velocity feedforward → P/D → integral if needed → validation.

For visualization, install the [simulation viewer](tools/simulation/README.md),
then use the event-log path printed by replay or tuning:

```sh
tools/simulation/.venv/bin/python tools/simulation/viewer.py live EVENTS.ndjson
tools/simulation/.venv/bin/python tools/simulation/viewer.py play EVENTS.ndjson
```

On macOS, use `mjpython` instead of `python` for viewer windows. The viewer
displays measured motion; it does not predict tuning results. For hand-operated
control using separate leader and follower adapters, see [teleoperation](tools/teleoperation/README.md).
