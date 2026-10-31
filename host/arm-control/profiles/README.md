# Arm profiles

Reference settings from upright, empty-gripper arms. Each directory contains a
controller file and one profile per motor, including PID and directional velocity
feedforward. Both controllers use the gravity models for motors 2–4; motors 1, 5
and 6 receive zero gravity effort.

| Profile | Replay speed | Acceleration | Scope |
| --- | ---: | ---: | --- |
| [SO-101](so101/controller.json) | 1,000 counts/s; profile ceiling 1,500 | 10,000 counts/s² | Retained tuning settings. M1 motion oscillation and slower M2 excursions remain unresolved. |
| [SO-102](so102/controller.json) | 2,000 counts/s | 15,000 counts/s² | Current fixed-profile comparison settings. This fast configuration still needs hardware validation. |

These are starting points, not universal defaults or a claim of completed tuning.
The SO-102 profile uses fixed M1 D=0.0625, M6 P=4 and a 100 ms ramp. The older
replay used M1 D=0.75 while moving, M6 P=16 and a 180 ms ramp, so this file does
not reproduce that older run.

## Use

Set `followerPort` in the chosen controller file. Keep the relative profile and
gravity paths intact. From the repository root:

```sh
npm run replay -- host/arm-control/profiles/so102/controller.json POSES.json
npm run replay -- host/arm-control/profiles/so102/controller.json POSES.json --run
```

Use `so101` for the other profile. The first command previews; the second moves
the arm and leaves it holding the final pose. Replay applies the profiles to RAM.
For teleoperation, also set `leaderPort` and add `leaderId`, `mapping` and any
direction/center overrides to each joint; see the
[mapping guide](../../../tools/teleoperation/README.md#mapping-and-control).

Gravity models include the encoder calibration used during fitting. Preflight
requires it to match the connected arm. **Do not copy another arm's encoder
offsets to satisfy this check.** Calibrate your arm, fit or adapt its model, and
validate the result at modest speed before full-speed use. Changes to mounting,
link geometry or payload also require validation. See the [gravity model
format](../models/README.md) and [tuning procedure](../../../tools/tuning/README.md).

These files do not define a universal physical calibration pose. Follow the
[reference-pose guide](../../../tools/settings/README.md#choose-the-reference-pose)
before creating a new calibration. Setting all motors to 2048 reproduces the
pose captured on that arm, subject to its saved limits and tracking error; it
does not automatically reproduce either bundled model's zero pose.
