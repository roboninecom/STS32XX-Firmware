<!-- translation-navigation -->
[English](../../../../en/host/arm-control/models/README.md) · [Русский](../../../../ru/host/arm-control/models/README.md) · [Español](../../../../es/host/arm-control/models/README.md) · [Français](../../../../fr/host/arm-control/models/README.md) · [Deutsch](../../../../de/host/arm-control/models/README.md) · [Português (Brasil)](../../../../pt-BR/host/arm-control/models/README.md) · [简体中文](README.md) · [日本語](../../../../ja/host/arm-control/models/README.md) · [हिन्दी](../../../../hi/host/arm-control/models/README.md) · [العربية](../../../../ar/host/arm-control/models/README.md)

[英文原文](../../../../../../host/arm-control/models/README.md)

> 完整机器翻译，尚未经母语人士审校。所有语言共用图片和视频，其中的文字保留原文。
<!-- /translation-navigation -->

<!-- translated-content -->
<a id="gravity-models"></a>
# 重力模型

包括两个直立的 empty-gripper 模型：

- `arm-upright-empty.json`: SO-102.
- `so101-upright-empty.json`: SO-101.

两者都包括编码器校准和电机 2–4 的耦合项。电机 1、5 和 6 具有明确的零补偿。它们采用原始安装、编码器偏移和链接几何形状。在使用不同的设置之前重新检查硬件。匹配的[控制器配置文件](../profiles/README.md)描述其操作设置和剩余限制。

该文件包含带符号的 PWM 努力系数以及它们所拟合的编码器设置。 `encoderCalibration` 列出了每个电机的有符号位置修正、单位分辨率和编码器反转。预检要求它们与连接的手臂相匹配。限制和增益是单独的设置。

标定使捕捉到的物理姿态读取2048；它不识别这些模型使用的关节角度。这些角度已经嵌入到术语权重和偏移中。在另一只手臂上复制相同的姿势可能会产生不同的电机偏移。将模型安装或调整到该手臂并验证其输出；请勿将所提供模型的偏移量复制到电机中。仅更改 `encoderCalibration` 不会更新重力计算。请参阅[选择参考姿势](../../../tools/settings/README.md#choose-the-reference-pose)。

每个电机都有一个 `maxEffort`、一个解释性 `note` 和一个 `terms` 列表。一项贡献`coefficient * sin(angle)`或`coefficient * cos(angle)`，其中`angle = offsetRad + sum(measuredEncoderCounts[id] * weights[id])`。角度是弧度。 `constant` 项贡献其系数并且没有权重。空列表明确要求零补偿。

所有加权电机 ID 必须位于受控跟随器之中。每个追随者都需要一个明确的模型。评估会拒绝缺失的输入、非有限值以及高于模型上限或配置的电机工作量限制的工作量；它永远不会默默地剪掉过多的结果。
<!-- /translated-content -->
