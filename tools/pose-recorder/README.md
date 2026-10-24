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
when reading starts; `durationMs` measures the full acquisition. Counts are raw
signed encoder values, without conversion to angles. The file deliberately has
no speed, acceleration or playback timing settings.

## Replay poses

Replay requires a follower running this repository's v9 firmware. Copy
[replay.example.json](replay.example.json) to your own configuration file and
set `followerPort`. IDs come from the recording. In extension mode, provide a
`profiles` entry for every recorded ID using gains and effort limits tested on
your mechanism; the example values only illustrate the format.

First preview without changing motor settings:

```sh
npm run replay-poses -- CONFIG.json POSES.json
```

Files up to 64 MiB are supported. The preview checks every pose against the follower's saved limits, reports how
many targets will be capped, and shows the first target. Support the mechanism,
check the path is clear, and start playback explicitly:

```sh
npm run replay-poses -- CONFIG.json POSES.json --run
```

Only the follower port is opened. The first pose is a real movement from the
current position. All configured motors must start with torque off, healthy
feedback, locked settings, and no deferred command pending. Extension startup
also requires current positions inside the saved limits.

Each pose is sent once. Playback waits for movement to finish and for every
motor to be within `toleranceCounts`, then starts the hold period. Targets outside
saved limits are capped. A motor that cannot arrive before `moveTimeoutMs` stops
the run with an error. Manually recorded timestamps do not set playback speed.

| `replay` setting | Default | Meaning |
| --- | --- | --- |
| `speed` | 1000 | Requested speed in encoder counts/s, 1–65535. |
| `holdMs` | 1000 | Pause after each pose, 0–600000 ms. |
| `repeat` | 1 | Number of passes through the list, 1–1000. Each new pass returns to the first pose. |
| `moveTimeoutMs` | 30000 | Maximum wait for each arrival, 1–600000 ms. |
| `toleranceCounts` | 10 | Allowed measured position error, 0–32767 counts. |

Use `protocol: "extension"` for S-curves and explicit gains. Top-level
`acceleration` and `rampTimeMs` control acceleration smoothing;
`profiles[ID].velocityLimit` also caps speed. Motors receive one group command
but can arrive at different times. Playback does not calculate gravity
compensation; use a mechanically supported setup if your arm requires it.

`protocol: "legacy"` uses the existing position controller and does not need
profiles, `acceleration` or `rampTimeMs`. Optional `legacyAcceleration` uses the
legacy register's units (0–254). Requested speed is converted using each motor's
saved speed scale; firmware minimum/maximum speed limits still apply.

Playback ends after the last hold. Ctrl+C or optional top-level `durationMs`
ends it early. **A normal exit keeps torque on**: extension control retains its
last target, while legacy control requests a hold at the measured position.
Errors attempt torque-off on all prepared motors and report failed cleanup.
A lost connection can prevent torque-off, and firmware retains the last target
if the process is killed.

Logs go to ignored `tools/teleoperation/logs/`, including the source file's hash,
requested positions, capped targets and feedback. For timed teleoperation
recordings, use [session replay](../teleoperation/README.md#replay-a-recorded-session).
Old private campaign plans are not pose files; use the documented `sts-poses`
format rather than copying historical tuning settings.

Run offline tests with `npm run test:poses` and `npm run test:teleoperation`.
