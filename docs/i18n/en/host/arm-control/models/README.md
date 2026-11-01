<!-- translation-navigation -->
[English](README.md) · [Русский](../../../../ru/host/arm-control/models/README.md) · [Español](../../../../es/host/arm-control/models/README.md) · [Français](../../../../fr/host/arm-control/models/README.md) · [Deutsch](../../../../de/host/arm-control/models/README.md) · [Português (Brasil)](../../../../pt-BR/host/arm-control/models/README.md) · [简体中文](../../../../zh-CN/host/arm-control/models/README.md) · [日本語](../../../../ja/host/arm-control/models/README.md) · [हिन्दी](../../../../hi/host/arm-control/models/README.md) · [العربية](../../../../ar/host/arm-control/models/README.md)

[English original](../../../../../../host/arm-control/models/README.md)

> English source copy. Images and videos are shared across languages.
<!-- /translation-navigation -->

<!-- translated-content -->
<a id="gravity-models"></a>
# Gravity models

Two upright, empty-gripper models are included:

- `arm-upright-empty.json`: SO-102.
- `so101-upright-empty.json`: SO-101.

Both include encoder calibration and coupled terms for motors 2–4. Motors 1, 5 and 6 have explicit zero compensation. They assume the original mounting, encoder offsets and link geometry. Recheck on hardware before using a different setup. Matching [controller profiles](../profiles/README.md) describe their operating settings and remaining limitations.

The file contains signed PWM effort coefficients and the encoder settings they were fitted against. `encoderCalibration` lists signed position corrections, unit resolution and encoder reversal for each motor. Preflight requires them to match the connected arm. Limits and gains are separate settings.

Calibration makes the captured physical pose read 2048; it does not identify the joint angles used by these models. Those angles are already embedded in the term weights and offsets. Reproducing the same pose on another arm can produce different motor offsets. Fit or adapt the model to that arm and verify its output; do not copy offsets from the supplied model into the motors. Changing only `encoderCalibration` does not update the gravity calculation. See [choosing a reference pose](../../../tools/settings/README.md#choose-the-reference-pose).

Each motor has a `maxEffort`, an explanatory `note` and a list of `terms`. A term contributes `coefficient * sin(angle)` or `coefficient * cos(angle)`, where `angle = offsetRad + sum(measuredEncoderCounts[id] * weights[id])`. Angles are radians. A `constant` term contributes its coefficient and has no weights. An empty list explicitly requests zero compensation.

All weighted motor IDs must be among the controlled followers. Every follower requires an explicit model. Evaluation rejects missing inputs, nonfinite values and effort above either the model cap or the configured motor effort limit; it never silently clips an excessive result.
<!-- /translated-content -->
