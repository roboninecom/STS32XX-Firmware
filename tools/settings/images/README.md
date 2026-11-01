# Calibration illustrations

<!-- documentation-languages -->
[English](../../../docs/i18n/en/tools/settings/images/README.md) · [Русский](../../../docs/i18n/ru/tools/settings/images/README.md) · [Español](../../../docs/i18n/es/tools/settings/images/README.md) · [Français](../../../docs/i18n/fr/tools/settings/images/README.md) · [Deutsch](../../../docs/i18n/de/tools/settings/images/README.md) · [Português (Brasil)](../../../docs/i18n/pt-BR/tools/settings/images/README.md) · [简体中文](../../../docs/i18n/zh-CN/tools/settings/images/README.md) · [日本語](../../../docs/i18n/ja/tools/settings/images/README.md) · [हिन्दी](../../../docs/i18n/hi/tools/settings/images/README.md) · [العربية](../../../docs/i18n/ar/tools/settings/images/README.md)
<!-- /documentation-languages -->

Side and top views rendered from the bundled robot models, with joint labels
and placement instructions added. These are guides for a **new manual
calibration**, not photographs or measurements of the tuned arms.

- `so101-reference-pose.png`: The Robot Studio's SO-101 geometry, distributed
  under Apache-2.0. [Pinned source and license](../../simulation/urdf/so101/README.md).
- `so102-reference-pose.png`: Robonine's SO-ARM-102 geometry, CC BY 4.0.
  [Pinned source and license](../../simulation/urdf/README.md). This illustration
  is an adaptation with the pose, camera, background and labels set for this guide;
  it is also available under CC BY 4.0.

## Poses used in the images

M1–M4 use the bundled viewer mappings at count 2048. Wrist roll and gripper
positions are set separately to the midpoints of the model's travel limits.
The physical stops on the actual mechanism determine those midpoints during
manual placement.

| Model | M1–M4 joint angles | Wrist roll | Gripper |
| --- | --- | --- | --- |
| SO-101 | 0°, 0°, 0°, 0° | 2.789° | Moving jaw 45° |
| SO-102 | 0°, −3°, 1°, 1° | −1° | Sliding jaw positions +0.02075 m and −0.02075 m |

Angles are relative to each URDF joint frame, not angles measured against the
table. These wrist/gripper positions differ from the default viewer maps;
neither the maps nor the published gravity models were changed for these images.
To match a new calibration, update the viewer's reference angles and calibration
binding as described in the [viewer guide](../../simulation/README.md#match-the-calibration-reference).
