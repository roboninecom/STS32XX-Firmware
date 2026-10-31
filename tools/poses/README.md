# Record and replay poses

Record named positions with torque off, then replay them with either saved legacy
settings or tuned extension settings. Commands run from the repository root.

| Command | Input | Firmware |
| --- | --- | --- |
| `npm run record-poses` | Manual positioning | Factory or custom |
| `npm run replay` | Named poses or a teleoperation session | Extension v9 |
| `npm run replay-legacy` | Named poses | Factory or custom v9 |

## Record poses

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

A new JSON file is created in `tools/poses/recordings/` for each session.
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

Copy [replay.example.json](replay.example.json) beside the original, for example
as `tools/poses/controller.local.json`. Set `followerPort` and provide one
`profiles` entry per recorded motor. IDs come from the recording; no leader or
joint mapping is needed. The example references the shared
[motor profile](../../host/arm-control/profile.example.json). Copy that profile
for your own settings and update its path, or put the settings inline.
All profile and gravity paths are relative to the controller file.
Example gains illustrate the format; use settings tested on your mechanism.

```sh
npm run replay -- CONFIG.json POSES.json
npm run replay -- CONFIG.json POSES.json --run
```

The first command previews the full path without changing settings and reports
targets capped to saved limits. `--run` starts motion, including the approach
from the current position to the first pose. Only the follower port is opened.
Files up to 64 MiB are accepted and validated before a port opens.

The [shared controller](../../host/arm-control/README.md) applies profiles,
handles existing powered sessions, and supplies gravity compensation when
`gravityModel` is configured. **Normal completion and Ctrl+C retain a powered
hold.** Faults use the controller's cleanup; Ctrl+C is not an emergency stop.
Optional top-level `durationMs` ends playback early; omit it to replay the whole file.

Each pose is sent in one group command. Joint speeds scale with travel distance,
subject to replay speed and each motor's speed limit. Each motor generates its
own S-curve, so arrival is approximate and waypoints are not blended.
Playback waits for the planners to finish and all measured positions to enter
`toleranceCounts`, then starts the hold. A move exceeding `moveTimeoutMs` fails.
Manually recorded timestamps do not set playback speed.

| `replay` setting | Default | Meaning |
| --- | --- | --- |
| `speed` | 1000 | Maximum speed, 1–65535 encoder counts/s. |
| `holdMs` | 1000 | Pause after arrival, 0–600000 ms. |
| `repeat` | 1 | Number of passes, 1–1000; each pass returns to the first pose. |
| `moveTimeoutMs` | 30000 | Arrival timeout, 1–600000 ms. |
| `toleranceCounts` | 10 | Allowed measured position error, 0–32767 counts. |

## Replay a recorded session

Replay a teleoperation log without connecting the leader:

```sh
npm run replay -- CONFIG.json SESSION.ndjson
npm run replay -- CONFIG.json SESSION.ndjson --run
```

The recording must contain a `preflight` with leader limits and joint mapping,
followed by `command` events with monotonic timestamps and all leader positions.
Use the same joint mapping in the current configuration. Recorded leader positions
are mapped through the recorded leader limits and the follower's current limits.
Current profiles and gravity are applied; historical settings and efforts are
not reused. An intended command in a failed log may never have reached the motors.

Playback preserves recorded gaps; processing delays stretch timing instead of
sending catch-up bursts. Feedback and gravity updates continue during pauses.
`replay.repeat`, `moveTimeoutMs` and `toleranceCounts` apply; `speed` and `holdMs`
apply only to named poses. The last frame must arrive before completion.

## Legacy replay

Use the motors' saved PID settings without extension velocity feedforward or
gravity compensation. No controller file is needed and persistent settings are
unchanged. Motors need absolute position mode and unit encoder resolution.

```sh
npm run replay-legacy -- POSES.json --port /dev/ttyUSB0
npm run replay-legacy -- POSES.json --port /dev/ttyUSB0 --run
```

The first command previews; `--run` moves. IDs come from the pose file; other
motors on the adapter are left alone. Custom firmware switches to legacy mode.
Setup briefly disables and re-enables each selected motor, seeding its current
position first.

| Option | Default | Meaning |
| --- | --- | --- |
| `--speed` | 1000 | Maximum speed, 1–32767 encoder counts/s. |
| `--acceleration` | 5000 | Counts/s², 100–25400 in multiples of 100. Saved limits apply. |
| `--hold-ms` | 1000 | Hold after each planned move, 0–600000 ms. |
| `--baud` | 1000000 | Adapter baud rate. |

Each pose uses a group command and distance-scaled speeds for approximately
simultaneous arrival. Targets are capped to saved position limits. Playback
waits for internal motion profiles to finish, then holds; it does not require
zero measured position error. A move lasting over 30 seconds fails.

Completion retains torque at the final pose. Unlike extension replay, **Ctrl+C
attempts torque-off**, as do failures. Cleanup failures are reported.

## Logs and visualization

Both replay commands save logs in ignored `logs/motion/`, including calibration,
source identity, commands and feedback. Start the [telemetry viewer](../simulation/README.md)
once, then run replays in another terminal:

```sh
mkdir -p logs/motion
tools/simulation/.venv/bin/python tools/simulation/viewer.py live logs/motion --model so102
```

Use `--model so101` for the other bundled model and a matching encoder mapping.
Extension replay reads detailed feedback for the moving reference shown by the
viewer. To reduce traffic, append `--compact`; measured motion and compensation
remain active, but the shadow shows destinations instead of intermediate planner
positions. PID terms and applied compensation contributions are also omitted.
See [feedback and timing](../../host/arm-control/README.md#checks-and-timing).

Run offline recording, extension replay and legacy replay tests with `npm run test:poses`.
