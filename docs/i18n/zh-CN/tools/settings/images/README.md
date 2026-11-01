<!-- translation-navigation -->
[English](../../../../en/tools/settings/images/README.md) · [Русский](../../../../ru/tools/settings/images/README.md) · [Español](../../../../es/tools/settings/images/README.md) · [Français](../../../../fr/tools/settings/images/README.md) · [Deutsch](../../../../de/tools/settings/images/README.md) · [Português (Brasil)](../../../../pt-BR/tools/settings/images/README.md) · [简体中文](README.md) · [日本語](../../../../ja/tools/settings/images/README.md) · [हिन्दी](../../../../hi/tools/settings/images/README.md) · [العربية](../../../../ar/tools/settings/images/README.md)

[英文原文](../../../../../../tools/settings/images/README.md)

> 完整机器翻译，尚未经母语人士审校。所有语言共用图片和视频，其中的文字保留原文。
<!-- /translation-navigation -->

<!-- translated-content -->
<a id="calibration-illustrations"></a>
# 校准插图

由捆绑的机器人模型提供的侧面和顶面视图,加上联合标签和安置说明。这些是**新的手工校准** 的指南,而不是调整手臂的照片或测量。

- `so101-reference-pose.png`机器人工作室 SO-101 分布于 Apache-2.0. [来源和许可证](../../simulation/urdf/so101/README.md).
- `so102-reference-pose.png`: 机器人的 SO-ARM-102 几何学, CC BY 4.0. [来源和许可证](../../simulation/urdf/README.md)本插图是对本指南的面容、相机、背景和标签的调整,该插图还载于 CC BY 4.0.

<a id="poses-used-in-the-images"></a>
## 图像中使用的 Poses

M1–M4 计算时使用捆绑的查看器映射 2048与模型旅行限额的中点分开设置手动放置和抓抓位置,实际机制的实际停留点决定人工安置期间的中点。

| 型 型 | M1–M4 联合角度 | 墙壁卷 | Gripper 渐流器 |
| --- | --- | --- | --- |
| SO-101 | 0°, 0°, 0°, 0° | 2.789° | 下下下下动动 45° |
| SO-102 | 0°, −3°, 1°, 1° | −1° | +0.02075 m和−0.02075m 倾斜的下巴位置 |

角度是相对每个 URDF 联合框架,而不是对照表格测量的角度。 wrist/gripper 与默认查看器地图不同的位置;这些图像的地图和公布的重力模型都没有被修改。要匹配新的校准,更新查看器的参考角度和校准绑定,如以下所示: [查看器向导](../../simulation/README.md#match-the-calibration-reference).
<!-- /translated-content -->
