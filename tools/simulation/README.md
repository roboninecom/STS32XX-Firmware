# Simulation and recorded-motion viewer

Display current replay, teleoperation and automated-tuning logs in MuJoCo,
including measured positions, target/reference overlays and effort charts.
The viewer only reads files. It never opens the servo bus or controls the arm.
An illustrative physics demo and a gravity-geometry check are also included.

## Install and prepare the model

Use Python 3.12 and a local SO-102 model package containing `urdf/so-arm.urdf`
and `meshes/`. CAD assets are not bundled: their redistribution license is not
yet resolved. Supply your own authorized copy.

```sh
python3.12 -m venv tools/simulation/.venv
tools/simulation/.venv/bin/python -m pip install -r tools/simulation/requirements.txt
tools/simulation/.venv/bin/python tools/simulation/prepare_so102.py --assets /path/to/so-arm_description
```

The importer preserves the URDF inertials and jaw coupling and produces
`tools/simulation/logs/model/so102-preview.xml`. Generated models, logs and
renders are excluded from Git. `--output DIRECTORY` selects another destination.

## Display a recording

```sh
tools/simulation/.venv/bin/python tools/simulation/viewer.py \
  --model tools/simulation/logs/model/so102-preview.xml \
  --recording /path/to/events.ndjson --check
```

Remove `--check` to open a window. On macOS, use MuJoCo's launcher:

```sh
tools/simulation/.venv/bin/python tools/simulation/.venv/bin/mjpython \
  tools/simulation/viewer.py \
  --model tools/simulation/logs/model/so102-preview.xml \
  --recording /path/to/events.ndjson
```

Add `--follow` to watch a growing log while another tool controls the arm. The
viewer reads only newly appended complete lines and retains original motor
sample timestamps. Stale data is labelled even if new commands arrive. Closing
the viewer leaves the controlling tool unaffected. `--render PATH.png` saves a
recorded frame, and `--duration SECONDS` limits a window smoke check.

Keys: `1`–`6` select a motor, `G` toggles the reference overlay, `C` charts,
`J` joint labels, `M`/`R` measured/reference pose, `F` rendering quality, and
`H` help. Charts retain up to 20 seconds. Missing telemetry displays `--`.

C2 contains the planner reference; C1 does not. The display labels C1 comparisons
as the commanded destination, while preserving C2's actual reference for the
tuning probe. Destination error during motion is not controller tracking error.

The supplied encoder-angle map describes the original upright arm calibration.
Recorded calibration must match it. Use `--mapping FILE.json` for another
validated map. M1–M4 are mapped; M5 and jaw geometry remain explicitly fixed
placeholders because their mapping has not been validated. All available motor
readings remain visible numerically. Recorded visualization calls `mj_forward`,
not physics steps, and does not predict the real controller's performance.

## Physics and geometry checks

```sh
tools/simulation/.venv/bin/python tools/simulation/run_demo.py \
  --assets /path/to/so-arm_description --check
tools/simulation/.venv/bin/python tools/simulation/check_gravity_geometry.py \
  --model tools/simulation/logs/model/so102-preview.xml
```

The demo uses illustrative position servos and ideal gravity compensation.
Remove `--check` and use `mjpython` on macOS to view it. Contacts are disabled.
The geometry check compares a coupled gravity basis with inverse holding torque
and finite differences at 160 poses. It checks signs and algebra, not the actual
mass distribution, friction, motor dynamics or effort-to-torque conversion.
Neither check qualifies hardware tuning. Hardware identification is available
through the [automated tuning tool](../tuning/README.md).

## Tests and migration

```sh
PYTHONPATH=tools/simulation tools/simulation/.venv/bin/python \
  -m unittest discover -s tools/simulation/test -v
```

Tests use original primitive geometry and require no CAD assets or hardware.
The reusable viewer, model preparation, demo and geometry checks replace the
older workspace entry points. Current controller events replace private v4
campaign formats. Historical analysis scripts for individual experiments remain
in the old workspace; they are not a second supported controller or viewer.

## Verification

On October 24, 2026, the migrated importer and 20-second physics demo passed
without warnings using the existing local SO-102 assets. The gravity-geometry
check passed at 160 poses. Fifteen offline tests cover data freshness, recording
adaptation, calibration rejection, partial log writes, overlays and charts.

Current six-motor replay and tuning recordings passed headless playback and
image rendering. The native viewer followed the M3 hardware batch for ten
seconds without opening the serial port or disrupting control. Its observed
update-loop rate was about 14 Hz on this machine, with variable GUI latency;
that is not a claim of 60 Hz rendering or measured GPU frame rate. Complete
feedback passes are grouped for display, and the history retains a bounded
20-second window.
