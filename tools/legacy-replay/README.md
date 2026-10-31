# Legacy pose replay

Replay files from the [pose recorder](../pose-recorder/README.md) using saved
legacy PID settings. Supports factory firmware and this repository's v9 firmware,
with absolute position mode and unit encoder resolution. No extension velocity
feedforward or gravity compensation is applied. Persistent settings are not changed.

From the repository root, install dependencies with `npm install`, then preview:

```sh
npm run replay-legacy -- POSES.json --port /dev/ttyUSB0
```

Check the path is clear and the mechanism is secured, then start:

```sh
npm run replay-legacy -- POSES.json --port /dev/ttyUSB0 --run
```

Motor IDs come from the pose file. Other motors on the adapter are left alone.
Custom firmware switches to legacy control automatically. Setup briefly disables
and re-enables each selected motor, seeding its current position first.

| Option | Default | Meaning |
| --- | --- | --- |
| `--speed` | 1000 | Maximum speed in encoder counts/s, 1–32767. |
| `--acceleration` | 5000 | Counts/s², 100–25400 in multiples of 100. Saved acceleration limits still apply. |
| `--hold-ms` | 1000 | Hold after each planned move, 0–600000 ms. |
| `--baud` | 1000000 | Adapter baud rate. |

Each pose is sent in one group command. Joint speeds scale with travel distance
for approximately simultaneous arrival. Saved speed limits and speed-unit
rounding still apply, so short moves may finish earlier. Targets are capped to
saved position limits. The tool waits for each motor's internal motion profile
to finish, then holds; it does not require zero measured position error.
A move that takes more than 30 seconds stops the run.

A completed replay leaves torque enabled at the final pose. Ctrl+C or a failure
attempts torque-off on every motor prepared by this run and reports cleanup
failures. Firmware motor protection remains active.

Logs are saved in `logs/motion/`. Start the simulator once to follow new replays:

```sh
tools/simulation/.venv/bin/python tools/simulation/viewer.py live logs/motion --model MODEL
```

Choose a model and encoder mapping matching your mechanism; see the
[simulation guide](../simulation/README.md). For tuned PID and compensation, use
[extension replay](../pose-recorder/README.md#replay-poses).
