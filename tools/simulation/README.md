# Simulation and recorded-motion viewer

Display current replay, teleoperation and automated-tuning logs in MuJoCo,
including measured positions, target/reference overlays and effort charts.
The viewer only reads files. It never opens the servo bus or controls the arm.
An illustrative physics demo and a gravity-geometry check are also included.

## Install and prepare the model

Use Python 3.12. The standalone [URDF and meshes](urdf/README.md) are bundled
from Robonine's SO-ARM-102 repository under CC BY 4.0. The layout is simply
`urdf/so_arm_102.urdf` with `urdf/meshes/` beside it. No ROS package or sibling
workspace is needed.

```sh
python3.12 -m venv tools/simulation/.venv
tools/simulation/.venv/bin/python -m pip install -r tools/simulation/requirements.txt
tools/simulation/.venv/bin/python tools/simulation/prepare_so102.py
```

The importer preserves the URDF inertials and jaw coupling, omits collision
boxes for contact-free display, and produces
`tools/simulation/logs/model/so102-preview.xml`. Generated models, logs and
renders are excluded from Git. `--output DIRECTORY` selects another destination. `--assets DIRECTORY` optionally
selects another SO-102 export containing `so_arm_102.urdf` and `meshes/`.

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

The supplied encoder-angle map describes the original upright arm calibration,
translated to the new URDF zero angles. Motor encoder settings are unchanged.
Recorded calibration must match it. Use `--mapping FILE.json` for another
validated map. M1–M4 are mapped; M5 and jaw geometry remain explicitly fixed
placeholders because their mapping has not been validated. All available motor
readings remain visible numerically. Recorded visualization calls `mj_forward`,
not physics steps, and does not predict the real controller's performance.

## Physics and geometry checks

```sh
tools/simulation/.venv/bin/python tools/simulation/run_demo.py --check
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

## Tests

```sh
PYTHONPATH=tools/simulation tools/simulation/.venv/bin/python \
  -m unittest discover -s tools/simulation/test -v
```

Display unit tests use original primitive geometry. The bundled-model tests also
verify source hashes, mesh resolution, import and the 20-second demo. No hardware
is required.
