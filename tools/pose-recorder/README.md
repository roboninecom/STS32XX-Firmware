# Pose recorder

Record named positions by moving an unpowered mechanism by hand. Works with
factory firmware and custom firmware, using 1–6 selected motors on one bus.
It saves encoder counts; it does not move motors or replay recordings.

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

Run offline tests with `npm run test:poses`.
