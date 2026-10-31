# Gravity models

Two upright, empty-gripper models are included:

- `arm-upright-empty.json`: SO-102.
- `so101-upright-empty.json`: SO-101.

Both include encoder calibration and coupled terms for motors 2–4. Motors 1, 5
and 6 have explicit zero compensation. They assume the original mounting,
encoder offsets and link geometry. Recheck on hardware before using a different
setup. Matching [controller profiles](../profiles/README.md) describe their
operating settings and remaining limitations.

The file contains signed PWM effort coefficients and the encoder settings they
were fitted against. `encoderCalibration` lists signed position corrections,
unit resolution and encoder reversal for each motor. Preflight requires them to
match the connected arm. Limits and gains are separate settings.

Each motor has a `maxEffort`, an explanatory `note` and a list of `terms`.
A term contributes `coefficient * sin(angle)` or `coefficient * cos(angle)`,
where `angle = offsetRad + sum(measuredEncoderCounts[id] * weights[id])`.
Angles are radians. A `constant` term contributes its coefficient and has no
weights. An empty list explicitly requests zero compensation.

All weighted motor IDs must be among the controlled followers. Every follower
requires an explicit model. Evaluation rejects missing inputs, nonfinite values
and effort above either the model cap or the configured motor effort limit;
it never silently clips an excessive result.
