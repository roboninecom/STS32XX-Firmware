# Gravity models

`arm-upright-empty.json` preserves the existing October 4 arm model, including
its encoder calibration and coupled terms for motors 2–4. Motors 1, 5 and 6
have explicit zero compensation. It assumes the original upright mounting,
unchanged encoder offsets and an empty gripper. It is not a universal servo
model. Recheck it on hardware before using it with a different setup.

The file contains signed PWM effort coefficients, not gains or motion settings.
Its source hash records the original model; offline reference tests cover 24
poses. Verification with the shared v9 controller is still pending.

Each motor has a `maxEffort`, an explanatory `note` and a list of `terms`.
A term contributes `coefficient * sin(angle)` or `coefficient * cos(angle)`,
where `angle = offsetRad + sum(measuredEncoderCounts[id] * weights[id])`.
Angles are radians. A `constant` term contributes its coefficient and has no
weights. An empty list explicitly requests zero compensation.

All weighted motor IDs must be among the controlled followers. Every follower
requires an explicit model. Evaluation rejects missing inputs, nonfinite values
and effort above either the model cap or the configured motor effort limit;
it never silently clips an excessive result.
