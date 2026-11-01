<!-- translation-navigation -->
[English](../../../../en/tools/simulation/urdf/README.md) · [Русский](../../../../ru/tools/simulation/urdf/README.md) · [Español](../../../../es/tools/simulation/urdf/README.md) · [Français](../../../../fr/tools/simulation/urdf/README.md) · [Deutsch](../../../../de/tools/simulation/urdf/README.md) · [Português (Brasil)](../../../../pt-BR/tools/simulation/urdf/README.md) · [简体中文](README.md) · [日本語](../../../../ja/tools/simulation/urdf/README.md) · [हिन्दी](../../../../hi/tools/simulation/urdf/README.md) · [العربية](../../../../ar/tools/simulation/urdf/README.md)

[英文原文](../../../../../../tools/simulation/urdf/README.md)

> 完整机器翻译，尚未经母语人士审校。所有语言共用图片和视频，其中的文字保留原文。
<!-- /translation-navigation -->

<!-- translated-content -->
<a id="so-arm-102-model"></a>
# SO-ARM 102 模型

URDF 和 8 STL 从 [机器人的 SO-ARM-102](https://github.com/roboninecom/SO-ARM-102/tree/0f0dd95526638042a3213598ee0ae7f167c40efe/simulation/urdf),实施 `0f0dd95526638042a3213598ee0ae7f167c40efe`。文件的复制未变。 `source.json` Xacro 和 ROS 自动装入自动卸载软件包辅助工具已不需要 URDF.

版权(c) 2026 机器人 归宿: SO-ARM 102, https://github.com/roboninecom/SO-ARM-102, CC BY 4.0。 见 [LICENSE. txt . txt 和](../../../../../../tools/simulation/urdf/LICENSE.txt) 上游和上游 [许可证许可证地图](https://github.com/roboninecom/SO-ARM-102/blob/0f0dd95526638042a3213598ee0ae7f167c40efe/LICENSING.md).

<a id="model-assumptions"></a>
## 示范假设

上游质量估计值是 **0.889 公斤**它假定: PLA 和印刷和印刷 70 g/ ervos. 见上游 [出口外出口设置](https://github.com/roboninecom/SO-ARM-102/blob/0f0dd95526638042a3213598ee0ae7f167c40efe/simulation/urdf/export_settings.json) 和 [质量属性](https://github.com/roboninecom/SO-ARM-102/blob/0f0dd95526638042a3213598ee0ae7f167c40efe/simulation/urdf/mass_properties.json)这些是估计数;测量的硬件重力模型仍然分开。

URDF 零 是导出 CAD 设置。 [编码器映射](../../../../../../tools/simulation/encoder-angle-map.json) 套套套套套套套套 M1–M4 计数时的角度 2048 至 0°, −3°, 1°和 1o, 分别为°。 M5 固定的下巴显示功能 +0.016 m和 −0.016 m, 匹配 URDF数的 opposite-sign 结合。

源保留其相撞框。 模型准备从生成的预览中省略了它们, 因为这些工具禁用了接触模拟。 它保存视觉、 惯性及联合连接。 模拟结果不会校准真正的运动动态或建立硬件调制收益 。
<!-- /translated-content -->
