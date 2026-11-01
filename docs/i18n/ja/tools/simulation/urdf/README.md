<!-- translation-navigation -->
[English](../../../../en/tools/simulation/urdf/README.md) · [Русский](../../../../ru/tools/simulation/urdf/README.md) · [Español](../../../../es/tools/simulation/urdf/README.md) · [Français](../../../../fr/tools/simulation/urdf/README.md) · [Deutsch](../../../../de/tools/simulation/urdf/README.md) · [Português (Brasil)](../../../../pt-BR/tools/simulation/urdf/README.md) · [简体中文](../../../../zh-CN/tools/simulation/urdf/README.md) · [日本語](README.md) · [हिन्दी](../../../../hi/tools/simulation/urdf/README.md) · [العربية](../../../../ar/tools/simulation/urdf/README.md)

[英語原文](../../../../../../tools/simulation/urdf/README.md)

> 全文の機械翻訳です。母語話者による校閲は未実施です。画像と動画は各言語で共用し、その中の文字は原文のままです。
<!-- /translation-navigation -->

<!-- translated-content -->
<a id="so-arm-102-model"></a>
# SO-ARM 102 モデル

URDF 8人は STL メッシュ [ロボ9's SO-ARM-102](https://github.com/roboninecom/SO-ARM-102/tree/0f0dd95526638042a3213598ee0ae7f167c40efe/simulation/urdf)コミット `0f0dd95526638042a3213598ee0ae7f167c40efe`ファイルは変更なくコピーされる。 `source.json` チェックを記録 ザクロと ROS パッケージの足場はスタンドアロンのロードには不要です。 URDF.

著作権(c) 2026 ロボナインですロボナインです SO-ARM 102, https://github.com/roboninecom/SO-ARM-102, CC BY 4.0見て [LICENSE.txt](../../../../../../tools/simulation/urdf/LICENSE.txt) 上流では [ライセンスマップ](https://github.com/roboninecom/SO-ARM-102/blob/0f0dd95526638042a3213598ee0ae7f167c40efe/LICENSING.md).

<a id="model-assumptions"></a>
## モデル仮定

上流の推定質量は **0.889 kg**想定される PLA 印刷して 70 g per servo. 上流を参照してください。 [エクスポート設定](https://github.com/roboninecom/SO-ARM-102/blob/0f0dd95526638042a3213598ee0ae7f167c40efe/simulation/urdf/export_settings.json) そして [質量特性](https://github.com/roboninecom/SO-ARM-102/blob/0f0dd95526638042a3213598ee0ae7f167c40efe/simulation/urdf/mass_properties.json)測定されたハードウェア重力モデルは分離されている。

URDF のゼロ姿勢は、書き出された CAD の姿勢です。[エンコーダーマップ](../../../../../../tools/simulation/encoder-angle-map.json)は、カウント 2048 における M1–M4 の角度を、それぞれ 0°、−3°、1°、1° に設定します。M5 とグリッパーの校正は未検証です。固定したジョーの表示には +0.016 m と −0.016 m を使用し、URDF の opposite-sign の連動に合わせています。

ソースは衝突ボックスを保持する。これらのツールは接触シミュレーションを無効にするため、生成されたプレビューからモデルの準備を省略する。視覚、慣性、結合結合を維持する。シミュレーション結果は実際のモーターダイナミクスをキャリブレーションしたり、ハードウェアチューニングのゲインを確立したりしない。
<!-- /translated-content -->
