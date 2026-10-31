# Shared arm controller and gravity compensation

Live teleoperation, tuning, named-pose replay and timed-session replay use one follower
controller. It handles setup, targets, measured feedback, gravity and cleanup.
The [servo driver](../servo-driver/README.md) owns packet encoding and transport.

## Motor settings files

See the [SO-101 and SO-102 profiles](profiles/README.md) for reference settings
and their operating limits.

`profiles` may contain inline settings or paths relative to the controller file:

```json
"profiles": {"1": "motor-1.json", "2": "motor-2.json"}
```

The [example profile](profile.example.json) is shared by the tool examples.
Copy it for your own settings and update the reference, or inline the profile.
If you move a controller file, adjust its profile and gravity paths. Files named
`*.local.json` are ignored by Git.

Set `acceleration` in counts/s² (1–30000) and `rampTimeMs` in milliseconds (1–255)
on the controller. Each motor may override these with `accelerationLimit` and
`rampTimeMs` in its profile. Profiles are extension RAM settings; saved encoder
offsets and travel limits remain separate.

| Profile field | Meaning |
| --- | --- |
| `kpQ8`, `kdQ8`, `kiQ8` | Controller gains multiplied by 256. |
| `integralLimit`, `effortLimit` | Integral and total output limits in PWM effort units. |
| `velocityLimit` | Maximum speed in counts/s; defaults to 65535. |
| `velocityFilterQ8` | Measured velocity filter setting, 1–255. |
| `gravitySlewEffortPerS` | Rate limit for gravity effort changes. |
| `velocityFeedforward` | `positiveGainQ8`, `negativeGainQ8`, `effortLimit`; zero all three to disable. |

See the [firmware register guide](../../README.md#configuration--0xa0) for full
units and ranges. These are per-motor settings, not switchable firmware profiles.

Tuning and settings application use `joints: [{ "followerId": 1 }]`; add one
entry per controlled motor. Named-pose replay gets IDs from the recording and
needs no `joints` array. Only live teleoperation and recorded-leader replay need
`leaderId`, `mapping` and optional direction/centers; see
[teleoperation mapping](../../tools/teleoperation/README.md#mapping-and-control).

## Enable gravity

Add `gravityModel` to your existing configuration. Paths
are relative to the **configuration file**, not the working directory. For a
configuration saved in the repository root:

```json
"gravityModel": "host/arm-control/models/arm-upright-empty.json"
```

This line is an addition to a complete configuration, not a standalone file.
Provide tested `profiles` for every follower; `effortLimit` caps the total motor
output and `gravitySlewEffortPerS` limits how quickly gravity effort changes.
Setting the slew alone does not enable gravity. Without `gravityModel`, replay
clears any retained gravity effort and then runs without gravity compensation.

The supplied [arm models](models/README.md) preserve each upright,
empty-gripper arm's calibration. Their coefficients for motors 2–4 use measured
encoder counts, including coupled joints; motors 1, 5 and 6 explicitly use zero.
Every controlled follower needs a model, and all joints used by its terms must
be controlled and measured. Angle-dependent models also declare `encoderCalibration`
for each input: signed `positionCorrection`, `resolution: 1`, and `reverse`
(the encoder reversal flag). Preflight compares these with the motor registers
and rejects a mismatch before setup or torque enable. Restore a matching backup
from that same arm, or update and validate the model after recalibration. A
reference capture at 2048 does not itself establish the model's physical angles;
see the [calibration guide](../../tools/settings/README.md#choose-the-reference-pose).
For either supplied six-motor model, include IDs 1–6 and all six
profiles. Do not reuse the model after changing encoder offsets, mounting,
geometry or payload without checking the calibration.

Use the same configuration field for each command:

```sh
npm run teleoperate -- CONFIG.json
npm run replay -- CONFIG.json POSES.json
npm run replay -- CONFIG.json SESSION.ndjson
```

These commands only preview. Add `--run` to start control. Current configuration
and measured follower positions determine gravity; recorded gravity values and
historical gains are never replayed. The model is validated before use and its
path and SHA-256 hash are included in the session log.

## Control behaviour

1. Preflight checks firmware, saved limits, health, profiles and model inputs.
2. All controller tools continue a compatible powered session or
   prepare a new one automatically. Matching profiles keep torque on; changed
   profiles are applied one motor at a time. Fresh setup handles torque release,
   configuration and selection, then enables all prepared motors together.
3. Gravity is measured, sent and confirmed before the first motion target.
4. During movement and pauses, one feedback pass supplies both health checks
   and gravity calculations. Gravity is refreshed approximately every 50 ms.
   There is no second telemetry reader or host velocity feedforward loop.
5. On a normal exit, gravity continues through the final movement and remaining
   firmware gravity slew. The controller waits for 200 ms of rest, with a 30 s
   completion timeout, then confirms the final gravity update. Torque stays on;
   firmware retains the last target and gravity effort.

For replay and teleoperation, Ctrl+C stops new targets and follows the same
completion sequence. Tuning instead interrupts the batch and attempts torque-off.
Ctrl+C is not an emergency stop. Rest means the planners have stopped and each measured position
stays within a one-count range over the full 200 ms interval.
It does not prove zero tracking error; pose/session replay also applies its
configured arrival tolerance.

The process stops refreshing gravity after exit. If the arm is subsequently
moved or its load changes, the retained effort does not adapt. A killed process
or disconnected bus can also leave the last target and effort active.

## Checks and timing

Gravity uses measured follower positions, never requested targets. A feedback
sample must be healthy, fresh and belong to the current session. Every gravity
update has its own sequence; acceptance is checked in the next feedback pass.
All results are checked against model and motor effort caps before any write.
An excessive result is an error, not a clipped value.

Coupled measurements are sequential. Acquisition, queueing and subsequent
writes must stay within 100 ms of the start of their feedback pass. The next
update must also occur within that bound; a delayed reader, logger or bus causes
a failure instead of silently continuing with old gravity. These are host
checks, not firmware timeouts. Asynchronous I/O can delay detection; they do not
make the host a real-time controller.

Live health checks run approximately every 250 ms without gravity or every
50 ms with it. Replay uses detailed C2 feedback every 50 ms during holds and
timed playback; arrival checks may poll faster. `--compact` substitutes smaller
C1 packets, which omit intermediate planner positions and PID contributions.
Tuning reads detailed feedback for all motors at startup, then C2 for the probe
and C1 for supporting motors. Feedback always shares the gravity reader.

Model errors, rejected updates, missing/stale feedback, lost ownership,
alarms and temperatures at or above 60 °C attempt verified torque-off on every
prepared follower. Cleanup failures are reported.

One exception is a missed gravity-update deadline during an established hold:
the controller retains torque only if two fresh feedback passes confirm healthy,
stationary motors in the same session. The run still fails and reports
`holdRetained: true`; it does not resume automatically.

Telemetry log records include measured feedback and the latest requested
gravity effort/sequence. Firmware feedback confirms that request on a subsequent
sample; a recorded request alone is not proof of acceptance. `settledAt` is a
conservative host estimate of when the requested gravity slew can finish.

## API and tests

`session.run` manages serial connections, session logs and cleanup for an input
source. `ArmController` accepts a follower driver, config, input source and optional
`GravityModel` instance. Load models with `await GravityModel.load(filename)`;
the CLI resolves the configuration-relative path. Input sources provide
`joints`, `preflight`, `describe`, `sample` and `play`; live input additionally
checks that its leader is unpowered. Automated tuning can request detailed feedback for its probe motor through the
same reader. `changeProfile` verifies stationary control, releases only that
motor, configures and re-enables it, then confirms gravity again. Supporting
motors stay powered. The changed motor briefly loses torque and captures its
measured position on restart; use a supported or mechanically safe pose for
profile changes. Profile errors use the normal all-motor failure cleanup.

Sources submit positions through the
controller and use its serviced waits, so long pauses continue feedback updates.

Run `npm run test:arm` for the shared controller, `npm run test:poses` for
recording/replay and `npm run test:teleoperation` for live control. Tests use
simulated serial responses.
