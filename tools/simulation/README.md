# Simulation viewer

View live telemetry or replay a controller recording in MuJoCo. The viewer reads
log files; it never connects to motors or sends commands. Both models use the
same viewer, charts and reference overlay.

## Install

From the repository root, using Python 3.12:

```sh
python3.12 -m venv tools/simulation/.venv
tools/simulation/.venv/bin/python -m pip install -r tools/simulation/requirements.txt
```

## Live and recorded playback

Launch once to watch the newest session and automatically switch when another
replay or teleoperation run creates a log:

```sh
mkdir -p logs/motion
tools/simulation/.venv/bin/python tools/simulation/viewer.py live logs/motion --model so101
```

The directory must exist. An empty directory waits for its first log. The window,
camera and display preferences stay unchanged between runs; charts reset for each
new session. Start hardware replay separately in another terminal.

To follow one particular log, or play a saved log from the beginning:

```sh
tools/simulation/.venv/bin/python tools/simulation/viewer.py live /path/to/events.ndjson --model so101

tools/simulation/.venv/bin/python tools/simulation/viewer.py play /path/to/events.ndjson --model so101
```

The command selects the native window launcher automatically on macOS, including
repository paths containing spaces.
Select `--model so102` for SO-102; this is also the default when omitted.
Models and meshes are bundled, so viewing requires no download or import step.

For a PNG preview, use ordinary Python on all platforms:

```sh
tools/simulation/.venv/bin/python tools/simulation/viewer.py play /path/to/events.ndjson --model so101 --render preview.png
```

The viewer accepts controller event logs, not named pose JSON files. Send pose
files through [hardware replay](../pose-recorder/README.md#replay-poses), then
view the resulting log. Playback preserves recording time and holds the final
frame. Live display updates only after a complete motor feedback pass. Delayed
measurements are labelled stale; commands alone cannot refresh them. A replaced
or truncated log must be reopened. Closing the viewer leaves hardware control running.

## Models and calibration

| Model | Source | Display mapping |
| --- | --- | --- |
| `so101` | [Official SO-101 follower](urdf/so101/README.md), Apache 2.0 | All six motors, including wrist roll and the revolute gripper jaw. |
| `so102` | [SO-ARM-102](urdf/README.md), CC BY 4.0 | Existing calibrated M1–M4 mapping; wrist roll and jaws remain fixed. |

SO-101 uses the upstream `so101_new_calib.urdf`. Its default map assumes standard
assembly and each URDF joint zero at encoder count 2048. Positive counts
increase each URDF joint angle by 2π/4096 radians per
count. This convention must match your arm's reference pose and joint directions;
the display labels it **reference pose assumed**, not hardware-verified alignment.
The gripper uses encoder angle directly, not LeRobot's normalized 0–100 opening.
Its URDF zero must be matched to the jaw angle at your calibration reference;
it is not inferred from the saved travel limits.

SO-102 keeps its existing encoder-calibration checks and fixed jaw coupling.
Changing the model does not change the hardware controller or its gravity model.

### Match the calibration reference

The [calibration tool](../settings/README.md#choose-the-reference-pose) sets 2048
at the pose you capture. The viewer separately converts those counts to angles:

```text
angle = referenceRadians + (counts − referenceCount) × radiansPerCount
```

| Bundled map | Displayed joint angles when counts are 2048 |
| --- | --- |
| SO-101 | 0° for all six URDF joints; this is an assumption, not a detected physical pose. |
| SO-102 | M1 0°, M2 −3°, M3 1°, M4 1°; M5 and jaws use fixed display positions. |

A mid-travel calibration pose, including the one shown in LeRobot's guide,
does not by itself establish that every URDF angle is zero. At your captured
reference, set each map entry's `referenceRadians` to that joint's angle in the
URDF. Check a small hand movement to confirm the sign of `radiansPerCount`,
including wrist roll and the gripper. Check a second pose as well; matching one
pose cannot confirm direction or scale. The tool does not derive these angles
from the minimum and maximum counts.

SO-101's default map has no exact offset binding. SO-102's map is bound to the
original arm's saved offsets. After recalibration, update the physical angle
mapping as well as its calibration fields; changing only those fields bypasses
the check without correcting the display. Calibration reports are not imported
automatically. The cyan overlay shows the firmware's planned pose, or the
destination with compact feedback; it is separate from the calibration pose.

To adjust or bind a map to a particular arm, copy `so101-encoder-map.json` or
`encoder-angle-map.json`, edit it, and pass `--mapping YOUR_MAP.json` with either
command. Version 2 maps contain:

- `model`: must match the selected model.
- `joints`: motor IDs mapped to URDF joint names, `referenceCount`,
  `referenceRadians` and signed `radiansPerCount`.
- `fixedJoints`: positions of model joints without a measured mapping, in radians
  for revolute joints or metres for sliding joints.
- `encoderCalibration`: optional exact per-motor `positionCorrection`,
  `resolution` and `reverse` settings, checked against the recording preflight.

Every model joint must be mapped or explicitly fixed. Counts in the log already
include the servo's position correction; do not subtract it again. Unit encoder
resolution is required. A reversed encoder requires an explicit calibration entry
and a matching signed angle mapping. For custom maps made with the previous
format, copy the version 2 map and transfer your reference angles and directions.

## Display

Both models have a neutral background and translucent grid plane at the base.
The grid is a visual reference, with no collision response; poses below it remain
visible. Playback holds its final frame and does not loop or restart. Live mode
with a file follows that file only. With a directory, it follows new `.ndjson`
files in that directory, without searching subdirectories or switching back when
an older log is updated.

`1`–`6` select a motor; `G` toggles the reference overlay; `C` charts; `J` joint
markers; `M`/`R` measured/reference pose; `F` rendering quality; `H` help.
The selected joint carries the error label. Missing readings display `--`.

Compact C1 feedback has measured positions but no planner reference; its
comparison uses the commanded destination. Detailed C2 feedback supplies the
planner reference. Destination error during movement is not tracking error.
New replay logs use detailed feedback: the cyan shadow follows the firmware's
intermediate planned positions. Older compact-feedback logs still show jumps
between destinations; the viewer cannot recover missing intermediate references.
Charts retain up to 20 seconds and do not fabricate new measurement timestamps.

The viewer reproduces geometry with contacts and gravity disabled. It does not
simulate motor dynamics or predict PID tuning. Joint positions are displayed
without clamping to nominal CAD limits.

## Tests

```sh
PYTHONPATH=tools/simulation tools/simulation/.venv/bin/python -m unittest discover -s tools/simulation/test -v
```
