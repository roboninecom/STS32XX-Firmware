# Shared arm controller and gravity compensation

Live teleoperation, named-pose replay and timed-session replay use one follower
controller. It handles setup, targets, measured feedback, gravity and cleanup.
The [servo driver](../servo-driver/README.md) owns packet encoding and transport.

## Enable gravity

Use extension mode and add `gravityModel` to your existing configuration. Paths
are relative to the **configuration file**, not the working directory. For a
configuration saved in the repository root:

```json
"gravityModel": "host/arm-control/models/arm-upright-empty.json"
```

This line is an addition to a complete configuration, not a standalone file.
Provide tested `profiles` for every follower; `effortLimit` caps the total motor
output and `gravitySlewEffortPerS` limits how quickly gravity effort changes.
Setting the slew alone does not enable gravity. Without `gravityModel`, the tool
sends no gravity compensation. Legacy mode does not support this model.

The supplied [arm model](models/README.md) preserves the existing upright,
empty-gripper arm calibration. Its coefficients for motors 2–4 use their measured
encoder counts, including coupled joints; motors 1, 5 and 6 explicitly use zero.
Every controlled follower needs a model, and all joints used by its terms must
be controlled and measured. For the six-motor arm, include IDs 1–6 and all six
profiles. Do not reuse the model after changing encoder offsets, mounting,
geometry or payload without checking the calibration.

Use the same configuration field for each command:

```sh
npm run teleoperate -- CONFIG.json
npm run replay-poses -- CONFIG.json POSES.json
npm run teleoperate -- CONFIG.json --replay SESSION.ndjson
```

These commands only preview. Add `--run` to start control. Current configuration
and measured follower positions determine gravity; recorded gravity values and
historical gains are never replayed. The model is validated before use and its
path and SHA-256 hash are included in the session log.

## Control behaviour

1. Preflight checks firmware, saved limits, health, profiles and model inputs.
2. With torque off, the controller configures and selects each motor with the
   new session ID. One group torque-enable packet starts all prepared motors;
   individual feedback confirms ready output. This avoids leaving later joints
   unpowered during earlier motors' readiness and gravity checks.
3. Gravity is measured, sent and confirmed before the first motion target.
4. During movement and pauses, one feedback pass supplies both health checks
   and gravity calculations. Gravity is refreshed approximately every 50 ms.
   There is no second telemetry reader or host velocity feedforward loop.
5. On a normal exit, gravity continues through the final movement and remaining
   firmware gravity slew. The controller waits for 200 ms of rest, with a 30 s
   completion timeout, then confirms the final gravity update. Torque stays on;
   firmware retains the last target and gravity effort.

Ctrl+C stops new targets and follows the same completion sequence. It is not an
emergency stop. Rest means the planner has stopped, measured speed is at most
10 counts/s and position changes by no more than one count per observation.
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

Health checks run with gravity updates, or approximately every 250 ms without
gravity. Model errors, rejected updates, missing/stale feedback, lost ownership,
alarms and temperatures at or above 60 °C attempt verified torque-off on every
prepared follower. Cleanup failures are reported.

Telemetry log records include measured feedback and the latest requested
gravity effort/sequence. Firmware feedback confirms that request on a subsequent
sample; a recorded request alone is not proof of acceptance. `settledAt` is a
conservative host estimate of when the requested gravity slew can finish.

## Development and verification

`ArmController` accepts a follower driver, config, input source and optional
`GravityModel` instance. Load models with `await GravityModel.load(filename)`;
the CLI resolves the configuration-relative path. Input sources provide
`joints`, `preflight`, `describe`, `sample` and `play`; live input additionally
checks that its leader is unpowered. Sources submit positions through the
controller and use its serviced waits, so long pauses continue feedback updates.

Run `npm run test:arm` for model tests and `npm run test:teleoperation` for live,
replay and failure-path tests. The reference fixture covers 24 historical arm
poses. The integration tests use simulated serial responses; hardware verification
of this refactoring is pending.

For the next hardware check: preview with the actual model and tested profiles,
verify low-speed motion and gravity direction, check startup and normal exit,
then compare live input, pose holds and session gaps. Inspect update spacing,
feedback freshness and arrival error before increasing speed or payload.
