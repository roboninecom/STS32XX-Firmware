<!-- translation-navigation -->
[English](../../../../en/host/arm-control/models/README.md) · [Русский](../../../../ru/host/arm-control/models/README.md) · [Español](../../../../es/host/arm-control/models/README.md) · [Français](../../../../fr/host/arm-control/models/README.md) · [Deutsch](../../../../de/host/arm-control/models/README.md) · [Português (Brasil)](../../../../pt-BR/host/arm-control/models/README.md) · [简体中文](../../../../zh-CN/host/arm-control/models/README.md) · [日本語](README.md) · [हिन्दी](../../../../hi/host/arm-control/models/README.md) · [العربية](../../../../ar/host/arm-control/models/README.md)

[英語原文](../../../../../../host/arm-control/models/README.md)

> 全文の機械翻訳です。母語話者による校閲は未実施です。画像と動画は各言語で共用し、その中の文字は原文のままです。
<!-- /translation-navigation -->

<!-- translated-content -->
<a id="gravity-models"></a>
# 重力モデル

2 つの直立 empty-gripper モデルが含まれています。

- `arm-upright-empty.json`: SO-102.
- `so101-upright-empty.json`: SO-101.

どちらもエンコーダキャリブレーションとモーターの結合項を含む 2–4モーター 1, 5 そして 6 明示的なゼロ補償がある。元のマウント、エンコーダオフセット、リンクジオメトリを仮定する。異なる設定を使用する前にハードウェアを再チェックする。 [コントローラプロファイル](../profiles/README.md) 動作設定と残りの制限を説明します。

ファイルには署名付きPWMの動作係数と、それらに適合したエンコーダ設定が含まれている。`encoderCalibration`は、署名付き位置補正、ユニット解像度、および各モーターのエンコーダ反転をリストする。プリフライトでは、接続されたアームに一致する必要がある。制限とゲインは別設定である。

キャリブレーションによって捕らえられた肉体的ポーズは 2048; これらのモデルで使用される関節角を識別しません。これらの角度は、すでに重みとオフセットという用語に埋め込まれています。別のアームで同じポーズを再現すると、異なるモーターオフセットを生成することができます。そのアームにモデルを適合または適応し、その出力を検証します。供給されたモデルからモーターにオフセットをコピーしないでください。 `encoderCalibration` 重力計算を更新しません。 [参照ポーズを選択すること](../../../tools/settings/README.md#choose-the-reference-pose).

各モーターには `maxEffort`説明書 `note` リストには `terms`ある用語が貢献する `coefficient * sin(angle)` それとも `coefficient * cos(angle)`どこ `angle = offsetRad + sum(measuredEncoderCounts[id] * weights[id])`角はラジアンです。 `constant` 空リストは、明示的に補償をゼロに要求します。

すべての重み付きモーターIDは、制御されたフォロワのうちでなければならない。すべてのフォロワーは、明示的なモデルを必要とする。評価は、欠落した入力、非有限値、およびモデルキャップまたは構成されたモーターの労力制限よりも上の労力を拒否する。黙って過剰な結果をクリップすることはない。
<!-- /translated-content -->
