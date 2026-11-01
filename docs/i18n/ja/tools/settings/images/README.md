<!-- translation-navigation -->
[English](../../../../en/tools/settings/images/README.md) · [Русский](../../../../ru/tools/settings/images/README.md) · [Español](../../../../es/tools/settings/images/README.md) · [Français](../../../../fr/tools/settings/images/README.md) · [Deutsch](../../../../de/tools/settings/images/README.md) · [Português (Brasil)](../../../../pt-BR/tools/settings/images/README.md) · [简体中文](../../../../zh-CN/tools/settings/images/README.md) · [日本語](README.md) · [हिन्दी](../../../../hi/tools/settings/images/README.md) · [العربية](../../../../ar/tools/settings/images/README.md)

[英語原文](../../../../../../tools/settings/images/README.md)

> 全文の機械翻訳です。母語話者による校閲は未実施です。画像と動画は各言語で共用し、その中の文字は原文のままです。
<!-- /translation-navigation -->

<!-- translated-content -->
<a id="calibration-illustrations"></a>
# 校正図

セットされたロボットモデルのサイドビューとトップビュー、ジョイントラベルと配置手順を追加し、調整されたアームの写真や測定ではなく、***新しいマニュアルキャリブレーション**のためのガイドです。

- `so101-reference-pose.png`:ロボットスタジオ SO-101 幾何学は Apache-2.0. [ライセンスとライセンス](../../simulation/urdf/so101/README.md).
- `so102-reference-pose.png`ロボナイン SO-ARM-102 幾何学 CC BY 4.0. [ライセンスとライセンス](../../simulation/urdf/README.md)このイラストは、このガイドのために設定されたポーズ、カメラ、背景、ラベル付きの適応です。 CC BY 4.0.

<a id="poses-used-in-the-images"></a>
## 画像で使用されるポーズ

M1 – M4 は、カウント 2048 にバンドルされたビューアマッピングを使用します。リストロールとグリッパーの位置は、モデルの移動限界の中間点に別々に設定されています。

| モデル | M1 - M4 関節角度。 | 巻物 | グリッパー |
| --- | --- | --- | --- |
| SO-101 | 0°, 0°, 0°, 0° | 2.789° | 移動顎 45° |
| SO-102 | 0°, −3°, 1°, 1° | −1° | 顎のすべり +0.02075 と −0.02075 私は |

角度はそれぞれに相対的です URDF テーブルに対して計測される角度ではなく wrist/gripper 位置はデフォルトのビューアマップとは異なり、これらの画像に対してマップも公開重力モデルも変更されない。新しいキャリブレーションに一致するように、ビューアの参照角度とキャリブレーションバインドを更新する。 [ビューアガイド](../../simulation/README.md#match-the-calibration-reference).
<!-- /translated-content -->
