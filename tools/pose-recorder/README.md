# Pose recorder

Record named positions by moving an unpowered mechanism by hand. Works with
factory firmware and custom firmware, using 1–6 selected motors on one bus.
The recorder saves encoder counts without moving motors. The separate replay
command below can move a follower through those poses.

## Run

Install Node.js 20 or newer, then run from the repository root:

```sh
npm install
npm run record-poses -- --port /dev/ttyUSB0 --ids 1,2,3
```

Replace the port and IDs for your setup. Optional flags are `--baud` (default
1000000), `--output DIR`, and `--timeout-ms` (default 1000).

Finish [offset and limit calibration](../settings/README.md#calibrate-joint-offsets-and-limits)
first. Recorded poses are movement waypoints; capturing a pose named `home` or
`reference` does not change motor calibration.

1. Support the mechanism so it cannot fall when torque is released.
2. Press Enter at the confirmation prompt. The recorder disables torque on the
   selected motors and verifies it is off. Other motors are not changed.
3. Move the mechanism, hold it still, then press Enter to capture a pose. You can
   type a unique name instead; unnamed poses become `position-1`, `position-2`, etc.
4. Repeat as needed. Type `done` to finish or press Ctrl+C to interrupt.

Torque remains off after recording. Reads are sequential, so each pose is a
snapshot of a stationary mechanism, not a synchronized motion measurement.
A missing reading, alarm or enabled motor stops the session. On exit, the tool
attempts to disable torque again and reports any failed verification.

## Saved files

A new JSON file is created in `tools/pose-recorder/recordings/` for each session.
Each successful capture replaces that file atomically; earlier saved poses
remain available if a later capture fails. Recordings are ignored by Git.

The `sts-poses` version 1 format identifies positions by motor ID, not array order:

```json
{
  "format": "sts-poses",
  "version": 1,
  "units": "encoder-counts",
  "ids": [1, 3],
  "readMode": "sequential",
  "poses": [
    {
      "name": "home",
      "capturedAt": "2026-10-24T12:00:00.000Z",
      "durationMs": 4.2,
      "positions": {"1": 2048, "3": 3100}
    }
  ]
}
```

Files also include session time, serial port and baud rate. Pose timestamps mark
when reading starts; `durationMs` measures the full acquisition. Counts are signed
reported positions, already including the motor's offset and direction setting,
without conversion to angles. The file has no speed, acceleration or playback
timing settings, and no calibration snapshot. Re-record poses after changing
encoder calibration; replay cannot detect that an old pose file uses different
offsets.

## Replay poses

For replay using saved legacy PID settings, without a controller configuration
or compensation, use the separate [legacy replay tool](../legacy-replay/README.md):

```sh
npm run replay-legacy -- POSES.json --port /dev/ttyUSB0 --run
```

The extension replay described below adds explicit tuning and optional gravity compensation.

Replay requires a follower running this repository's v9 firmware. Copy
[replay.example.json](replay.example.json) to your own configuration file and
set `followerPort`. IDs come from the recording. Provide a
`profiles` entry for every recorded ID using gains and effort limits tested on
your mechanism; the example values only illustrate the format.

First preview without changing motor settings:

```sh
npm run replay -- CONFIG.json POSES.json
```

Files up to 64 MiB are supported. The preview checks every pose against the follower's saved limits, reports how
many targets will be capped, and shows the first target. Support the mechanism,
check the path is clear, and start playback explicitly:

```sh
npm run replay -- CONFIG.json POSES.json --run
```

Only the follower port is opened. The first pose is a real movement from the
current position. The same command handles powered and unpowered motors and
applies the configuration automatically. Matching settings keep torque on;
changed profiles are applied one motor at a time. Omitting `gravityModel` clears
retained gravity effort. No separate setup command is needed.
Motor health, locked settings and firmware session readiness are still checked.

Each pose is sent once. Playback waits for movement to finish and for every
motor to be within `toleranceCounts`, then starts the hold period. Targets outside
saved limits are capped. A motor that cannot arrive before `moveTimeoutMs` stops
the run with an error. Manually recorded timestamps do not set playback speed.

| `replay` setting | Default | Meaning |
| --- | --- | --- |
| `speed` | 1000 | Maximum replay speed in encoder counts/s, 1–65535. Shorter joint moves use proportionally lower speeds. |
| `holdMs` | 1000 | Pause after each pose, 0–600000 ms. |
| `repeat` | 1 | Number of passes through the list, 1–1000. Each new pass returns to the first pose. |
| `moveTimeoutMs` | 30000 | Maximum wait for each arrival, 1–600000 ms. |
| `toleranceCounts` | 10 | Allowed measured position error, 0–32767 counts. |

The controller uses S-curves and explicit gains. Top-level
`acceleration` and `rampTimeMs` provide defaults for acceleration smoothing.
A motor's `accelerationLimit` and `rampTimeMs` profile fields override them;
`profiles[ID].velocityLimit` also caps speed. Replay automatically scales joint
speeds by their travel distances, accounting for each motor's speed limit, and
sends one group command per pose. The first move starts from the current hold
reference (or measured position); later moves use the previous capped targets.
Arrival timing is approximate: acceleration, ramp time and integer speed limits
still differ between joints. This does not blend motion through waypoints.
To enable gravity compensation, add
`gravityModel` to the configuration as described in the
[shared controller guide](../../host/arm-control/README.md). Models for both
bundled arm types are included. Compensation uses measured follower positions and continues
through movement, holds and normal completion. After exit, firmware retains the
final effort, but it no longer adapts to position or load changes.

Playback ends after the last hold. Ctrl+C or optional top-level `durationMs`
ends it early. **A normal exit keeps torque on** and retains the last target.
Errors attempt torque-off on all prepared motors and report failed cleanup.
A lost connection can prevent torque-off, and firmware retains the last target
if the process is killed.

Logs go to ignored `logs/motion/`, including the source file's hash,
requested positions, capped targets and feedback. For timed teleoperation
recordings, use [session replay](../teleoperation/README.md#replay-a-recorded-session).
