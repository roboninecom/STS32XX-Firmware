<!-- translation-navigation -->
[English](../../../../en/host/arm-control/profiles/README.md) · [Русский](../../../../ru/host/arm-control/profiles/README.md) · [Español](../../../../es/host/arm-control/profiles/README.md) · [Français](../../../../fr/host/arm-control/profiles/README.md) · [Deutsch](../../../../de/host/arm-control/profiles/README.md) · [Português (Brasil)](../../../../pt-BR/host/arm-control/profiles/README.md) · [简体中文](../../../../zh-CN/host/arm-control/profiles/README.md) · [日本語](README.md) · [हिन्दी](../../../../hi/host/arm-control/profiles/README.md) · [العربية](../../../../ar/host/arm-control/profiles/README.md)

[英語原文](../../../../../../host/arm-control/profiles/README.md)

> 全文の機械翻訳です。母語話者による校閲は未実施です。画像と動画は各言語で共用し、その中の文字は原文のままです。
<!-- /translation-navigation -->

<!-- translated-content -->
<a id="arm-profiles"></a>
# 腕のプロフィール

直立設定からの参照設定。 empty-gripper 各ディレクトリには、コントローラファイルとモーターごとに1つのプロファイルが含まれています。 PID 方向速度のフィードフォワードです どちらのコントローラもモーターに重力モデルを使います 2–4モーター 1, 5 そして 6 重力はゼロです

| プロフィール | 再生速度 | 加速 | スコープ |
| --- | ---: | ---: | --- |
| [SO-101](../../../../../../host/arm-control/profiles/so101/controller.json) | 1,000 counts/sプロファイル天井。 1,500 | 10,000 counts/s² | 継続チューニング設定. M1モーション振動と遅いM2エクスカーションは未解決のままです。 |
| [SO-102](../../../../../../host/arm-control/profiles/so102/controller.json) | 2,000 counts/s | 15,000 counts/s² | 現在のfixed-profileの比較設定. この速い構成はハードウェア検証を必要とします。 |

これらは、ユニバーサルデフォルトやチューニング完了の主張ではなく、開始点です。 SO-102 プロフィールは固定で M1 D =0.0625, M6 P =4 そして 100 ミス・ランプ 古いリプレイでは M1 D =0.75 移動しながら M6 P =16 そして 180 したがって、このファイルは古い実行を再現しません。

<a id="use"></a>
## 利用

選択したコントローラファイルに`followerPort`を設定し、相対プロファイルと重力パスをそのままにします。

```sh
npm run replay -- host/arm-control/profiles/so102/controller.json POSES.json
npm run replay -- host/arm-control/profiles/so102/controller.json POSES.json --run
```

もう一方のプロファイルには `so101` を使用します。最初のコマンドはプレビューで、次のコマンドはアームを動かして最終姿勢を保持します。再生はプロファイルを RAM に適用します。遠隔操作では `leaderPort` も設定し、各関節に `leaderId`、`mapping`、必要な direction/center の上書きを追加します。[マッピングガイド](../../../tools/teleoperation/README.md#mapping-and-control)を参照してください。

重力モデルはフィッティング中に使用するエンコーダキャリブレーションを含み、プリフライトでは接続されたアームにマッチする必要があります。 **このチェックを満たすために、他のアームのエンコーダーオフセットをコピーしないでください。** 腕を校正し、そのモデルを適合または適応させ、結果を控えめな速度で検証します。 full-speed use. マウント、リンクジオメトリ、ペイロードの変更も検証が必要です。 [重力モデル形式](../models/README.md) そして [チューニング手順](../../../tools/tuning/README.md).

これらのファイルは、普遍的な物理キャリブレーションのポーズを定義していません。 [reference-pose ガイド](../../../tools/settings/README.md#choose-the-reference-pose) 全てのモーターを 2048 そのアームでキャプチャされたポーズを、保存された制限と追跡エラーに従って再現する。
<!-- /translated-content -->
