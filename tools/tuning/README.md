# Automated tuning

Run a bounded batch of candidate settings, compare repeated moves and longer
holds, and get a machine-readable recommendation. Uses the same v9 driver,
controller and calibrated gravity model as replay and teleoperation. No settings
are written to EEPROM and no winning candidate is automatically installed.

## Start

From the repository root, install Node.js 20+ dependencies with `npm install`.
Copy `controller.example.json` and `example.json`, then edit the port, motor IDs,
profiles, safe joint travel pairs and limits for your mechanism. Example gains and poses
are illustrative. Include every supporting motor in the controller configuration.
Complete [calibration](../settings/README.md#choose-the-reference-pose) before
choosing test positions. Positions use corrected encoder counts; a new offset
changes their physical meaning. Update test pairs, recordings and the gravity
model after recalibration.
For gravity, add `gravityModel` exactly as described in the
[shared controller guide](../../host/arm-control/README.md).

The plan's `config` path is relative to the plan. The controller's `gravityModel`
path is relative to that controller file. The same controller configuration can
be used for pose replay. Omit `durationMs` for tuning: the plan owns the batch
budget. Secure the mechanism for startup and profile changes. Changing a profile
briefly releases that motor; fresh setup can release all configured followers.

```sh
npm run tune -- inspect tools/tuning/example.json
npm run tune -- preflight tools/tuning/example.json
npm run tune -- run tools/tuning/example.json
```

The tool keeps supporting joints at their existing firmware hold targets. Only
`probeId` moves through its declared test pairs. There is no automatic whole-arm
repositioning. Current targets and measured positions are logged for comparison
between runs. Use reviewed joint paths for the current arm configuration.

Use the same command for the first batch and every subsequent batch:

```sh
npm run tune -- run NEXT_PLAN.json
```

Startup automatically prepares unpowered motors or continues an existing session.
Changed baseline settings are applied before the batch; unchanged motors retain
their powered hold. Do not run another controller on the same bus.

`inspect` does not connect. `preflight` reads firmware, calibration, saved limits,
health and profiles without changing the motors. `run` moves them.
Targets are capped to saved position limits; preflight reports the effective
path. A pair collapsed to one position cannot be used as a tuning exercise.

## Tuning order

1. **Baseline:** verify calibration, safe movement, temperatures and repeatability
   with the existing settings. Use `stage: "baseline"` and no candidates.
2. **Gravity:** keep modest feedback gains and compare slow motion in both
   directions at several poses and at least two speeds. Start with a calibrated
   model. `stage: "gravity"` collects identification data without changing gains.
3. **Velocity feedforward:** after gravity is checked, compare directional
   velocity gains using steady motion at more than one speed.
4. **P/D and velocity filtering:** screen a small explicit set of candidates.
   Include poses with both high and low gravity load, then use longer holds to
   expose oscillations. A small factorial batch can compare P, D and filtering
   together; verify the best combination on the held-out pairs.
5. **Integral:** only if a persistent error remains; compare moving accuracy as
   well as long holds. Include small reversals: long sweeps alone can miss an
   integral limit that prevents a stationary joint from overcoming friction.
   Keep integral zero unless the result supports enabling it.
6. **Acceleration and ramp time:** with gains fixed, use `stage: "motion"` to
   compare acceleration and smoothing at the required speeds.
7. **Combined motion:** replay a recorded path that exercises every joint and
   includes both folded and extended configurations. A gain that works with
   supporting joints stationary can oscillate when the whole mechanism moves.
   Recheck the changed joints on this same path before accepting their settings.
8. **Validation:** freeze the selected configuration, repeat the path at every
   required speed and acceleration, then hold representative poses for longer.
   Record accuracy, overshoot, settling, temperature and output saturation for
   each motor. Recheck after changing payload or calibration.

`stage` restricts candidate fields: `velocity` allows `velocityFeedforward`;
`pid` allows `kpQ8`, `kdQ8`, `velocityFilterQ8`; `integral` allows `kiQ8` and
`integralLimit`; `motion` allows `accelerationLimit` and `rampTimeMs`. Baseline, gravity and validation stages collect data without
candidate changes. P/D/I and velocity gains use the firmware's Q8 units: divide
by 256 for the corresponding gain. Output limits remain the explicitly supplied
controller limits throughout the batch.

Keep acceleration and ramp time fixed while comparing gains. Then compare motion settings at the required speeds. The maximum configurable acceleration is 30,000 counts/s²; the usable value depends on load and effort limits. Check actual reference and measured speeds: short strokes may never reach the requested speed.

Integral gain and its limit need testing together. A large accumulated correction
can continue driving a joint after friction releases, causing overshoot. The
integral limit bounds only that correction; the total motor output is controlled
separately by `effortLimit`. Prefer a stable residual error to repeated hunting,
and report any accuracy criterion the selected settings do not meet.

## Reuse settings

A controller profile can be a separate JSON file, for example `"profiles": {"1": "motor-1.json"}`. Paths are relative to the controller file. Motor files contain the same fields as inline profiles; optional `accelerationLimit` and `rampTimeMs` override the shared defaults. Replay, teleoperation and tuning load these files through the same loader. Settings are applied to RAM during extension setup, not saved in EEPROM.

Export a controller into a new directory containing one file per motor, `controller.json`, an optional `gravity.json`, and a manifest:

```sh
npm run tune -- export CONFIG.json NEW_DIRECTORY
```

Export does not connect to motors or certify the settings. Use the exported `controller.json` with replay, teleoperation or a tuning plan.

To apply accepted settings and hold the current position:

```sh
npm run tune -- apply NEW_DIRECTORY/controller.json
```

Startup handles powered and unpowered motors automatically. In an existing session,
only changed motors are briefly disabled and reconfigured, one at a time.
Supporting motors stay powered and existing targets are retained. Omitting the
gravity model clears retained gravity effort. Replay applies its configuration
automatically, so this command is only needed to apply settings without replaying.

Keep accepted settings, the gravity model, calibration, payload/mounting description
and validation evidence together. Another arm needs its own calibration and
validation. Do not restore another arm's encoder offsets.

## How a batch works

For screening, the tool runs baseline → all candidates → baseline. Each block
exercises every pair and speed in both directions, alternating the first
approach across repeats. If the two baselines drift beyond `driftRatio`, the
batch ends as inconclusive and keeps its powered hold. Position drift allows one
encoder count of quantization. Eligible candidates are ranked, and up to
`finalists` repeat the comparison between shared baselines on different validation
pairs with longer holds. A recommendation
requires passing validation and beating its baseline.

Metrics include moving tracking RMS, steady position error and span, overshoot,
settling time, total response time and saturation fraction. Settling requires a
final continuous period inside the band; an early crossing does not count.
If screening holds are shorter than the allowed settling time plus dwell,
holding and settling metrics are reported as deferred. Screening then ranks
moving error, overshoot and saturation. The longer validation must pass all
metrics before a recommendation is made. Use validation holds long enough to
cover the allowed settling time and a steady observation interval.
Acceptance limits are supplied in the plan. An unsuccessful but valid response
can be scored; stale samples, alarms, control overruns, excessive following
error, support motion, temperature/voltage limits or logging failures stop the
batch and attempt verified torque-off on all prepared motors. A missed gravity deadline during an established stationary hold instead preserves torque only after two fresh, healthy, stationary feedback passes confirm session ownership; the batch still fails and supplies no recommendation.

At startup, detailed C2 feedback records the existing hold targets and checks following error on every joint. During tests, one C2 read replaces the probe's C1 read. Supporting motors retain C1;
all measurements also serve gravity updates. The plan estimates wire usage and
rejects requests at or above 50% nominal capacity. Actual gaps are checked during
the run. There is no separate polling process for tuning or visualization.

**Changing a profile briefly removes torque from the motor being tuned.** v9
requires this. Supporting motors stay controlled and gravity updates continue.
Use a supported or mechanically safe pose; a loaded joint can move during this
interval. Before changing a profile, the controller waits for the planners to
stop and measured positions to stay within one encoder count for 200 ms. Gravity
updates continue during this wait; failure to settle within 30 seconds stops the
batch. Firmware retains its last target if commands stop.

An already completed endpoint hold is reused before reversing direction; the
tool does not send a duplicate setup target or add another setup delay.

Normal completion restores the configured baseline and retains powered hold
with final gravity compensation. Ctrl+C interrupts the tuning batch and attempts
torque-off; support the mechanism before interrupting. A disconnected or killed
process may leave the firmware holding its last target. The tool does not return
to a rest pose automatically.

## Results and agent workflow

Runs are saved under ignored `tools/tuning/logs/<run>/` directories:

- `events.ndjson`: exact plan/configuration, implementation hashes, gravity model,
  calibration, profile changes, commands, measurements and trial results.
- `summary.json`: completion status, comparisons, validation and recommendation.

Submit one plan containing several explicit candidates, let the whole batch
finish, then inspect the summary. Use the raw events for failed criteria or
ambiguous results. This avoids one process and analysis round per parameter.
A duration budget always bounds the work. An incomplete batch has no recommendation.

Recompute results or extract steady-motion identification windows:

```sh
npm run tune -- analyse tools/tuning/logs/RUN/events.ndjson
node tools/tuning/cli.js extract tools/tuning/logs/RUN/events.ndjson > tools/tuning/logs/dataset.json
node tools/tuning/cli.js fit tools/tuning/logs/dataset.json
```

Extraction requires completed gravity/velocity runs, both directions and multiple
speeds in both screening and validation. It rejects accelerating, saturated,
poorly measured and moving-support windows. Fits keep whole trajectories apart
between training and validation, and use the runtime gravity basis. They return
unreviewed effort-space coefficients, not measured joint torque or a deployable
model. Update the model and repeat independent hardware checks deliberately.

Use the [simulation viewer](../simulation/README.md) on the same event file to
inspect the arm during or after a run. It adds no bus traffic.

## Tests

Run `npm run test:tuning`, or `npm test` for all Node.js tools. Tests do not connect to motors.
