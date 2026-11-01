<!-- translation-navigation -->
[English](../../../en/tools/simulation/README.md) · [Русский](../../../ru/tools/simulation/README.md) · [Español](../../../es/tools/simulation/README.md) · [Français](../../../fr/tools/simulation/README.md) · [Deutsch](../../../de/tools/simulation/README.md) · [Português (Brasil)](../../../pt-BR/tools/simulation/README.md) · [简体中文](../../../zh-CN/tools/simulation/README.md) · [日本語](README.md) · [हिन्दी](../../../hi/tools/simulation/README.md) · [العربية](../../../ar/tools/simulation/README.md)

[英語原文](../../../../../tools/simulation/README.md)

> 全文の機械翻訳です。母語話者による校閲は未実施です。画像と動画は各言語で共用し、その中の文字は原文のままです。
<!-- /translation-navigation -->

<!-- translated-content -->
<a id="telemetry-viewer"></a>
# テレメトリビューア

ライブテレメトリを見たり、MuJoCoで記録したコントローラを再生したりできる。ビューアはログファイルを読み込み、モーターに接続したり、コマンドを送ったりしない。どちらのモデルも、同じビューア、チャート、参照オーバーレイを使用している。記録されたモーションを表示する。モーターのダイナミクスやチューニング結果を予測しない。

<a id="install"></a>
## インストール

リポジトリルートから、Python 3.12を使用します。

```sh
python3.12 -m venv tools/simulation/.venv
tools/simulation/.venv/bin/python -m pip install -r tools/simulation/requirements.txt
```

<a id="live-and-recorded-playback"></a>
## ライブと録画再生

最新のセッションを一度起動し、別のリプレイまたは遠隔操作実行がログを作成すると自動的に切り替えます。

```sh
mkdir -p logs/motion
tools/simulation/.venv/bin/python tools/simulation/viewer.py live logs/motion --model so101
```

ディレクトリが存在する必要があります。空のディレクトリは最初のログを待ちます。ウィンドウ、カメラ、表示設定は実行間で変更されません。新しいセッションごとにリセットされるチャート。ハードウェアを別のターミナルで別々に再生します。

特定のログに従うか、最初から保存したログを再生します。

```sh
tools/simulation/.venv/bin/python tools/simulation/viewer.py live /path/to/events.ndjson --model so101

tools/simulation/.venv/bin/python tools/simulation/viewer.py play /path/to/events.ndjson --model so101
```

コマンドは、スペースを含むレポジトリパスを含む、macOS上のネイティブウィンドウランチャーを自動的に選択する。SO-102用の`--model so102`を選択する。これは省略した場合のデフォルトでもある。モデルとメッシュがバンドルされているため、表示にダウンロードやインポートのステップは必要ない。

PNGプレビューでは、すべてのプラットフォームで通常のPythonを使用します。

```sh
tools/simulation/.venv/bin/python tools/simulation/viewer.py play /path/to/events.ndjson --model so101 --render preview.png
```

ビューアはコントローラーのイベントログを受け付けます。 JSON file. ポーズファイルを送信します。 [ハードウェアリプレイ](../poses/README.md#replay-poses)再生は記録時間を維持し、最終フレームを保持する。ライブ表示の更新は、完全なモーターフィードバックパス後にのみ行われる。遅延測定は古いラベル付けされる。コマンドだけではリフレッシュできない。置き換えられたログまたは切り捨てられたログを再開しなければならない。ビューアを閉じるとハードウェア制御が動作している。

<a id="models-and-calibration"></a>
## モデルと校正

| モデル | 出典 | ディスプレイマッピング |
| --- | --- | --- |
| `so101` | [官 SO-101 従者](urdf/so101/README.md)Apache 2.0 | リストロールとリボリュートグリッパージョーを含む6つのモーターすべて。 |
| `so102` | [SO-ARM-102](urdf/README.md), CC BY 4.0 | 既存のキャリブレーションされたM1-M4マッピング。 |

SO-101 は上流の `so101_new_calib.urdf` を使用します。既定のマップは標準的な組み立てを仮定し、各 URDF 関節のゼロ位置をエンコーダーカウント 2048 に対応させます。カウントが増えると、各 URDF 関節角度はカウントあたり 2π/4096 ラジアン増加します。この規則は実機の基準姿勢と関節方向に一致させる必要があります。表示は **基準姿勢を仮定** とされ、hardware-verified による位置合わせを意味しません。グリッパーは LeRobot の正規化された 0–100 開度ではなく、エンコーダー角度を直接使用します。URDF のゼロ位置は校正基準でのジョー角度に合わせてください。保存された可動範囲から自動的に推定されるものではありません。

SO-102は、既存のencoder-calibrationチェックと固定ジョーカップリングを維持し、モデルの変更はハードウェアコントローラまたは重力モデルを変更しません。

<a id="match-the-calibration-reference"></a>
### キャリブレーション参照にマッチします。

...... [校正ツール](../settings/README.md#choose-the-reference-pose) セット 2048 捉えたポーズで、ビューアは別々に、これらのカウントを角度に変換します。

```text
angle = referenceRadians + (counts − referenceCount) × radiansPerCount
```

| バンドル地図 | カウントが2048の場合、関節角度を表示します。 |
| --- | --- |
| SO-101 | 0° すべての6つのURDF関節に対して、これは仮定であり、検出された物理的なポーズではない。 |
| SO-102 | M1 0°, M2 −3°, M3 1°, M4 1°; M5 顎は固定表示位置を使います |

LeRobot のガイドにある姿勢を含め、可動範囲の中央付近に置く mid-travel 校正姿勢だけでは、すべての URDF 関節角度がゼロになるとは限りません。記録した基準姿勢について、各マップ項目の `referenceRadians` を、その関節の URDF 上の角度に設定してください。手で少し動かし、手首の回転とグリッパーも含めて `radiansPerCount` の符号を確認します。別の姿勢でも確認してください。ある姿勢だけが一致しても、方向や倍率は確認できません。ツールは最小・最大カウントからこれらの角度を導出しません。

SO-101のデフォルトマップは、正確なオフセットバインドを持たない。SO-102のマップは、元のアームの保存されたオフセットにバインドされている。再校正の後、物理アングルマッピングとそのキャリブレーションフィールドを更新し、これらのフィールドのみをディスプレイを修正せずにチェックをバイパスする。キャリブレーションレポートは自動的にインポートされない。チャンオーバーレイは、ファームウェアの計画されたポーズ、またはコンパクトなフィードバックを持つ宛先を表示する。キャリブレーションポーズとは別である。

マップを特定のアームに調整またはバインドするには、コピーします。 `so101-encoder-map.json` それとも `encoder-angle-map.json`編集して 合格します `--mapping YOUR_MAP.json` バージョンです。 2 マップは次のとおりです。

- `model`:選択したモデルにマッチする必要があります。
- `joints`:URDFジョイント名、`referenceCount`、`referenceRadians`にマッピングされたモーターIDと署名された`radiansPerCount`。
- `fixedJoints`: リボリュートジョイント用のラジアンまたはスライドジョイント用のメートルにおいて、測定されたマッピングのないモデルジョイントの位置。
- `encoderCalibration`: オプションです。 per-motor `positionCorrection`, `resolution` そして `reverse` 設定 録画前飛行でチェック

すべてのモデルジョイントは、マッピングまたは明示的な修正が必要です。ログ内のカウントには、すでにサーボの位置補正が含まれています。再び減算しないでください。ユニットエンコーダの解像度が必要です。逆のエンコーダには、明示的な校正エントリと一致する符号付き角度マッピングが必要です。以前の形式で作成されたカスタムマップの場合、バージョン2マップをコピーし、参照角度と方向を転送します。

<a id="display"></a>
## 展示

どちらのモデルにも、中立的な背景と、その基盤にある半透明のグリッドプレーンがある。グリッドは、視覚的な参照であり、衝突応答はなく、その下のポーズは、見えるままである。Playbackは、最終フレームを保持し、ループまたは再起動しない。ファイル付きのライブモードは、そのファイルのみに従う。ディレクトリでは、サブディレクトリを検索したり、古いログが更新されたときにスイッチバックすることなく、そのディレクトリ内の新しい`.ndjson`ファイルに従う。

`1`–`6` モーターを選択する。 `G` 参照オーバレイを切り替えます。 `C` チャート `J` 関節マーカー。 `M`/`R` measured/reference ポーズ。 `F` レンダリングの品質。 `H` help. 選択した関節にエラーラベルが付きます。 `--`.

コンパクト C1 フィードバックは位置を測定したが、プランナー参照はない。 C2 フィードバックはプランナの参照を供給します。移動中の宛先エラーは追跡エラーではありません。新しいリプレイログは詳細なフィードバックを使用します。シアンの影はファームウェアの中間計画位置に従っています。 compact-feedback ログは未だに宛先間ジャンプを表示しており、ビューアは欠落している中間参照を復元できない。 20 秒と新しい測定タイムスタンプを作成しないでください。

視聴者は接触と重力を無効にした幾何学を再現します モーターのダイナミクスをシミュレートしたり PID チューニングを予測したりしません 関節の位置は CAD の限界にクランプせずに表示されます

<a id="tests"></a>
## テスト

```sh
PYTHONPATH=tools/simulation tools/simulation/.venv/bin/python -m unittest discover -s tools/simulation/test -v
```
<!-- /translated-content -->
