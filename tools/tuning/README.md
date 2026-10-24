# Automated tuning

Run a bounded batch of candidate settings, compare repeated moves and longer
holds, and get a machine-readable recommendation. Uses the same v9 driver,
controller and calibrated gravity model as replay and teleoperation. No settings
are written to EEPROM and no winning candidate is automatically installed.

## Start

From the repository root, install Node.js 20+ dependencies with `npm install`.
Copy `controller.example.json` and `example.json`, then edit the port, motor IDs,
profiles, safe pose pairs and limits for your mechanism. Example gains and poses
are illustrative. Include every supporting motor in the controller configuration.
For gravity, add `gravityModel` exactly as described in the
[shared controller guide](../../host/arm-control/README.md).

The plan's `config` path is relative to the plan. The controller's `gravityModel`
path is relative to that controller file. The same controller configuration can
be used for pose replay. Omit `durationMs` for tuning: the plan owns the batch
budget. Initial torque must be off unless the controller explicitly permits
rearming a powered follower.

```sh
npm run tune -- inspect tools/tuning/example.json
npm run tune -- preflight tools/tuning/example.json
npm run tune -- run tools/tuning/example.json --execute
```

`inspect` does not connect. `preflight` reads firmware, calibration, saved limits,
health and profiles without changing the motors. `run --execute` moves them.
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
   expose oscillations. Change one factor at a time when identifying its effect.
5. **Integral:** only if a persistent error remains; compare moving accuracy as
   well as long holds. Keep integral zero unless the result supports enabling it.
6. **Validation:** run the selected configuration on different pose pairs with
   more repeats and longer holds. Recheck after changing payload or calibration.

`stage` restricts candidate fields: `velocity` allows `velocityFeedforward`;
`pid` allows `kpQ8`, `kdQ8`, `velocityFilterQ8`; `integral` allows `kiQ8` and
`integralLimit`. Baseline, gravity and validation stages collect data without
candidate changes. P/D/I and velocity gains use the firmware's Q8 units: divide
by 256 for the corresponding gain. Output limits remain the explicitly supplied
controller limits throughout the batch.

## How a batch works

For each candidate, the tool runs baseline → candidate → baseline. Each block
exercises every pair and speed in both directions, alternating the first
approach across repeats. If the two baselines drift beyond `driftRatio`, the
batch stops. Eligible candidates are ranked, and up to `finalists` repeat the
comparison on different validation pairs with longer holds. A recommendation
requires passing validation and beating its baseline.

Metrics include moving tracking RMS, steady position error and span, overshoot,
settling time, total response time and saturation fraction. Settling requires a
final continuous period inside the band; an early crossing does not count.
Acceptance limits are supplied in the plan. An unsuccessful but valid response
can be scored; stale samples, alarms, control overruns, excessive following
error, support motion, temperature/voltage limits or logging failures stop the
batch and attempt verified torque-off on all prepared motors.

One detailed C2 read replaces the probe's C1 read. Supporting motors retain C1;
all measurements also serve gravity updates. The plan estimates wire usage and
rejects requests at or above 50% nominal capacity. Actual gaps are checked during
the run. There is no separate polling process for tuning or visualization.

**Changing a profile briefly removes torque from the motor being tuned.** v9
requires this. Supporting motors stay controlled and gravity updates continue.
Use a supported or mechanically safe pose; a loaded joint can move during this
interval. Profile changes require stationary feedback. There are no live profile
slots, heartbeat, STOP command or firmware command timeout.

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

## Migration and tests

This replaces the private v4 tuning runner and its separate hardware backend.
Old plans require explicit conversion to version 2; removed protocol fields are
not translated silently. Historical one-off campaigns and pose-dependent gain
switching remain outside this tool. Physics predictions are not used to qualify
settings; offline tests simulate communication and faults only.

Run `npm run test:tuning`, or `npm test` for all Node.js tools.
