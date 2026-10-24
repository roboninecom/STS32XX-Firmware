# Simulation viewer

View live arm telemetry or play a saved recording in MuJoCo. The viewer shows
measured positions, target/reference overlays and effort charts. It reads the
controller's event log, adding no bus traffic and issuing no motor commands.

## Install

From the repository root, using Python 3.12:

```sh
python3.12 -m venv tools/simulation/.venv
tools/simulation/.venv/bin/python -m pip install -r tools/simulation/requirements.txt
```

The [SO-ARM-102 URDF and meshes](urdf/README.md) are bundled under CC BY 4.0.
The viewer prepares the model automatically; no separate import command is needed.

## Live telemetry

Start replay, teleoperation or tuning, then open its reported event-log path:

```sh
tools/simulation/.venv/bin/python tools/simulation/viewer.py live /path/to/events.ndjson
```

New complete feedback passes update the arm. Delayed measurements are labelled
stale even when commands continue arriving. Closing the window does not stop the
controller. A replaced, truncated or invalid log stops the viewer; open the new
run's file to resume.

## Recording playback

```sh
tools/simulation/.venv/bin/python tools/simulation/viewer.py play /path/to/events.ndjson
```

Playback preserves recorded timing and holds the final frame. To save a PNG
preview instead of opening a window, add `--render preview.png`.

**On macOS**, replace `tools/simulation/.venv/bin/python` in window commands with
`tools/simulation/.venv/bin/mjpython`, for example:

```sh
tools/simulation/.venv/bin/mjpython tools/simulation/viewer.py live /path/to/events.ndjson
```

Supported inputs are the event logs from replay, teleoperation and tuning.
Named pose files are inputs to [hardware replay](../pose-recorder/README.md#replay-poses);
this viewer needs measured telemetry and its calibration preflight.

## Display and calibration

Keys: `1`–`6` select a motor, `G` toggles the reference overlay, `C` charts,
`J` joint labels, `M`/`R` measured/reference pose, `F` rendering quality, and `H` help.
Charts retain up to 20 seconds. Missing readings display `--`.

Compact C1 feedback contains measured positions but no planner reference, so its
comparison uses the commanded destination. Detailed C2 feedback supplies the
planner reference for the tuning motor. Destination error during movement is
not controller tracking error.

Recorded encoder calibration must match `encoder-angle-map.json`. Use
`--mapping FILE.json` with either command for another validated map. M1–M4 drive
the model; M5 and jaw geometry remain fixed because their mapping is not validated.
All available motor readings remain visible numerically.

The viewer reproduces poses with contacts and gravity disabled. It does not
simulate motor dynamics or predict tuning results. The gravity algebra check
remains an offline test, alongside model import, mapping and telemetry checks:

```sh
PYTHONPATH=tools/simulation tools/simulation/.venv/bin/python \
  -m unittest discover -s tools/simulation/test -v
```
