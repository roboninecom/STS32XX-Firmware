<!-- translation-navigation -->
[English](README.md) · [Русский](../../../../ru/tools/simulation/urdf/README.md) · [Español](../../../../es/tools/simulation/urdf/README.md) · [Français](../../../../fr/tools/simulation/urdf/README.md) · [Deutsch](../../../../de/tools/simulation/urdf/README.md) · [Português (Brasil)](../../../../pt-BR/tools/simulation/urdf/README.md) · [简体中文](../../../../zh-CN/tools/simulation/urdf/README.md) · [日本語](../../../../ja/tools/simulation/urdf/README.md) · [हिन्दी](../../../../hi/tools/simulation/urdf/README.md) · [العربية](../../../../ar/tools/simulation/urdf/README.md)

[English original](../../../../../../tools/simulation/urdf/README.md)

> English source copy. Images and videos are shared across languages.
<!-- /translation-navigation -->

<!-- translated-content -->
<a id="so-arm-102-model"></a>
# SO-ARM 102 model

URDF and eight STL meshes from [Robonine's SO-ARM-102](https://github.com/roboninecom/SO-ARM-102/tree/0f0dd95526638042a3213598ee0ae7f167c40efe/simulation/urdf), commit `0f0dd95526638042a3213598ee0ae7f167c40efe`. The files are copied unchanged. `source.json` records their checksums. Xacro and ROS package scaffolding are not needed to load the standalone URDF.

Copyright (c) 2026 Robonine. Attribution: Robonine, SO-ARM 102, https://github.com/roboninecom/SO-ARM-102, CC BY 4.0. See [LICENSE.txt](../../../../../../tools/simulation/urdf/LICENSE.txt) and the upstream [license map](https://github.com/roboninecom/SO-ARM-102/blob/0f0dd95526638042a3213598ee0ae7f167c40efe/LICENSING.md).

<a id="model-assumptions"></a>
## Model assumptions

The upstream mass estimate is **0.889 kg**. It assumes PLA printing and 70 g per servo. See the upstream [export settings](https://github.com/roboninecom/SO-ARM-102/blob/0f0dd95526638042a3213598ee0ae7f167c40efe/simulation/urdf/export_settings.json) and [mass properties](https://github.com/roboninecom/SO-ARM-102/blob/0f0dd95526638042a3213598ee0ae7f167c40efe/simulation/urdf/mass_properties.json). These are estimates; the measured hardware gravity model remains separate.

URDF zero is the exported CAD pose. The [encoder map](../../../../../../tools/simulation/encoder-angle-map.json) sets M1–M4 angles at count 2048 to 0°, −3°, 1° and 1°, respectively. M5 and gripper calibration remain unverified. The fixed jaw display uses +0.016 m and −0.016 m, matching the URDF's opposite-sign coupling.

The source retains its collision boxes. Model preparation omits them from the generated preview because these tools disable contact simulation. It preserves visuals, inertials and joint coupling. Simulation results do not calibrate real motor dynamics or establish hardware tuning gains.
<!-- /translated-content -->
