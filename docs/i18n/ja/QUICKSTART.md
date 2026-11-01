<!-- translation-navigation -->
[English](../en/QUICKSTART.md) · [Русский](../ru/QUICKSTART.md) · [Español](../es/QUICKSTART.md) · [Français](../fr/QUICKSTART.md) · [Deutsch](../de/QUICKSTART.md) · [Português (Brasil)](../pt-BR/QUICKSTART.md) · [简体中文](../zh-CN/QUICKSTART.md) · [日本語](QUICKSTART.md) · [हिन्दी](../hi/QUICKSTART.md) · [العربية](../ar/QUICKSTART.md)

[英語原文](../../../QUICKSTART.md)

> 全文の機械翻訳です。母語話者による校閲は未実施です。画像と動画は各言語で共用し、その中の文字は原文のままです。
<!-- /translation-navigation -->

<!-- translated-content -->
<a id="quick-start"></a>
# クイックスタート

GD32F130-based STS TTL サーボ用。以下のコマンドは macOS/Linux シェル構文を使用し、リポジトリ ルートから実行します。拡張モーション ツールにはファームウェア v9 が必要です。レガシー リプレイは工場出荷時のファームウェアもサポートしています。

<a id="1-install"></a>
## 1。インストール

Node.js 20+ と Python 3.10+ をインストールします。オプションのシミュレーション ビューアには Python 3.12 が必要です。

```sh
npm ci
python3 -m venv tools/flash/.venv
tools/flash/.venv/bin/python -m pip install -r tools/flash/requirements.txt
export SERVO_PORT=/dev/cu.usbmodemYOUR_ADAPTER
```

ポートを実際のポート (Linux の `/dev/ttyUSB0` など) に置き換えます。例では、モーター ID **1** およびボー **1000000** を使用します。サーボに合わせてこれらを調整してください。

<a id="2-back-up-and-flash"></a>
## 2。バックアップとフラッシュ

**ファームウェアの書き込みにより、サーボが損傷したり校正値が消去されたりする可能性があります。** 機構を固定し、安定した電源を使用し、トルクを無効にして、シリアルポートを使う他のプログラムを閉じてください。書き込み前に設定をロックし、アラームを解除する必要があります。通常のカスタムファームウェア書き込みでは、ID が重複していないモーターは接続したままにできます。ID を一つずつ書き込み、バスの power-cycle（電源の入れ直し）は行わないでください。復旧時は、復旧対象のサーボだけを接続してください。

```sh
npm run settings -- discover --port "$SERVO_PORT"
npm run settings -- backup --port "$SERVO_PORT" --id 1
```

**カスタム ファームウェア ZIP** を **Assets** の [v0.1-プレビュー リリース](https://github.com/roboninecom/STS32XX-Firmware/releases/tag/v0.1-preview) からダウンロードします。ファームウェア イメージと `release.json` を一緒に `tools/flash/releases/custom/` に抽出します。 GitHub の **ソース コード** アーカイブをフラッシュに使用しないでください。

```sh
tools/flash/.venv/bin/python tools/flash/flash.py inspect \
  --manifest tools/flash/releases/custom/release.json
tools/flash/.venv/bin/python tools/flash/flash.py flash \
  --manifest tools/flash/releases/custom/release.json --port "$SERVO_PORT" --id 1
```

プロンプトが表示されたら `FLASH` と入力し、検証が完了するまで電源を接続したままにしてください。各モーター ID に対してフラッシュ コマンドを繰り返し、毎回検証を待ちます。検証が失敗した場合は、[フラッシュと回復](tools/flash/README.md) を参照してください。

**工場出荷時のファームウェア ZIP** は、工場出荷時のファームウェアに戻すためのものであり、以下のモーション ツール用ではありません。それを別のフォルダーに解凍し、フラッシュ後に [工場出荷時設定の復元](tools/flash/README.md#restore-factory-settings) に従ってください。各ファームウェア イメージを独自の `release.json` で保持します。

<a id="3-calibrate-joint-offsets-and-limits"></a>
## 3。ジョイントのオフセットと制限を校正する

ジョイントの移動量が制限されている機構の場合、校正するモーター ID を選択します。

```sh
npm run settings -- calibrate --port "$SERVO_PORT" --ids 1,2,3 \
  --file tools/settings/calibrations/arm.json
```

サンプル ID を実際の ID に置き換えます。検出されたすべてのモーター (最大 6 つ) を使用するには、`--ids` を省略します。 SO-101とSO-102については[ラベル付き参考ポーズ画像](tools/settings/README.md#reference-pose-images)をご覧ください。このコマンドには 2 つのステップがあります。

1. リスト ロールやグリッパーを含む、選択したすべてのジョイントを機構の基準ポーズに配置します。ポーズを持たない新しいセットアップの場合は、各ジョイントの移動の中央付近で再現可能なポーズを選択します。静止した状態で **Enter** を押してオフセットを保存し、そのポーズで 2048 と読み取れるようにします。
2. 選択した各ジョイントを端から端まで移動し、端で少し停止します。ライブ テーブルを確認し、**Enter** を押して制限を保存します。

メカニズム全体をサポートします。無理に停止させないでください。トルクはオフのままです。ファイルは自動的に更新され、モーターのバックアップが保持されます。 2 番目のステップが失敗した場合、最初のステップのオフセットは保存されたままになります。モーションを有効にする前にキャリブレーションを終了してください。測定された中間点は、キャプチャされた基準を置き換えません。 2048 はエンコーダ参照のみです。シミュレーションや重力の物理的な角度を確立するものではありません。 [基準ポーズの選択](tools/settings/README.md#choose-the-reference-pose)を参照してください。これは、ポーズを記録したり、重力補正を調整したりする前に行ってください。校正が確認された既存のアームは、settings-preserving フラッシュ後に再校正する必要はありません。

<a id="4-check-communication"></a>
## 4。通信を確認する

トルクをオフにしてください。接続されているモーターに`--ids`を設定します。

```sh
npm test
npm run bus-benchmark -- --port "$SERVO_PORT" --ids 1 --repetitions 100
npm run telemetry -- --port "$SERVO_PORT" --ids 1 --samples 1000 --interval-ms 20 \
  --output tools/diagnostics/results/first-check
```

`npm test` はオフラインです。他のコマンドはハードウェアを読み取り、レポート パスを出力します。毎回、新しいテレメトリ出力ディレクトリを使用します。電源がデフォルトの8–16 V 範囲外の場合は、`--voltage-min` と `--voltage-max` を調整します。動作前に障害とフラグ付き読み取り値を検査します。 factory/custom の比較については、[ハードウェア テスト ガイド](tools/hw-diff-tests/README.md) に従ってください。その完全なスイートはモーターを動かし、保存された設定を置き換え、テンプレートをリセットします。

<a id="5-record-and-replay-poses"></a>
## 5。ポーズを記録して再生する

トルクを解放する前に機構をサポートしてください。手で動かし、名前を入力して各ポーズを保存し、「`done`」と入力します。アームに必要なすべてのモーター ID を使用します。

```sh
npm run record-poses -- --port "$SERVO_PORT" --ids 1
cp tools/poses/replay.example.json tools/poses/controller.local.json
```

`tools/poses/controller.local.json` を編集: `followerPort` を設定し、すべてのモーターに `profiles` エントリを提供し、適切なゲイン、努力制限、速度、加速度を選択します。値の例は例示的なものです。この例では共有プロファイルを参照しています。自分自身の利益のためにそのプロファイルをコピーし、そのパスを更新するか、設定をインラインに置きます。パスはコントローラー ファイルに対する相対パスです。まず、保存されたキャリブレーションと位置制限を確認してください。フォロワー バスには、構成されたモーターが正確に含まれている必要があります。 Replay は、電力が供給されているモーターと電力が供給されていないモーターを処理し、変更された設定を自動的に適用します。

`POSES.json` をレコーダーの保存されたパスに置き換えます。

```sh
npm run replay -- tools/poses/controller.local.json POSES.json
npm run replay -- tools/poses/controller.local.json POSES.json --run
```

最初のコマンドプレビュー。 `--run` 動かせるのです **Ctrl+Cは緊急停止ではありません。** ご覧あれ [リプレイ設定](tools/poses/README.md#replay-poses).

モーターの保存されたレガシーPID設定を使用して、補償なしで比較します。

```sh
npm run replay-legacy -- POSES.json --port "$SERVO_PORT" --run
```

コントローラーファイルは不要です。read-onlyプレビュー用の`--run`を省略します。[レガシー再生](tools/poses/README.md#legacy-replay)の速度と加速度設定を参照してください。

<a id="6-enable-gravity-compensation"></a>
## 6. 重力補償を有効にする

`tools/poses/controller.local.json` の場合、この top-level フィールドを追加します。

```json
"gravityModel": "../../host/arm-control/models/arm-upright-empty.json"
```

付属のモデルは、キャリブレーションされた直立した**SO-ARM-102と空のグリッパー**を含む。モーター1–6と6つのプロファイルすべてを含む。モーター2–4は補償を受け取り、他はゼロを受け取る。エンコーダキャリブレーションは一致しなければならない。マウント、ジオメトリ、ペイロードの変更は検証済みモデルが必要である。ミスマッチを回避するためだけにキャリブレーションを変更しないでください。異なるメカニズムやキャリブレーションのために、適合し、マッチングモデルを検証する。

[SO-101とSO-102コントローラプロファイル](host/arm-control/profiles/README.md)には、PID、速度フィードフォワード、重力モデルのマッチングが含まれます。

リプレイ、テレオペレーション、チューニングは、同じフィールドを使用します。重力は、ツールの実行中に測定された位置に従います。 [重力ガイド](host/arm-control/README.md) モデル要件に

<a id="7-tune-and-view-motion"></a>
## 7.トーンとビューモーション

コピーして編集します。 [チューニング計画](../../../tools/tuning/example.json) そして [コントローラの例](../../../tools/tuning/controller.example.json); プランを設定します。 `config` コントローラファイルへのパス 最初の実行には、小さな安全な動作を使用します。 `"stage": "baseline"` そして `"candidates": []`.

```sh
npm run tune -- inspect PLAN.json
npm run tune -- preflight PLAN.json
npm run tune -- run PLAN.json
```

のみ `run` ハードウェアを移動します [調整順序](tools/tuning/README.md#tuning-order):ベースライン→重力→速度フィードフォワード→ P/D フィルター → 必要なら整数 → acceleration/ramp time → 複合モーション → 検証。

視覚化するには、インストールします。 [シミュレーションビューア](tools/simulation/README.md)で、それを使って event-log リプレイまたはチューニングによって印刷されるパス:

```sh
tools/simulation/.venv/bin/python tools/simulation/viewer.py live EVENTS.ndjson --model so101
tools/simulation/.venv/bin/python tools/simulation/viewer.py play EVENTS.ndjson --model so101
```

利用 `--model so102` その他のバンドルアームモデルについては、こちらをご覧ください。 reference-pose コマンドはmacOSウィンドウランチャーを自動的に処理し、ビューアは測定された動作を表示します。 hand-operated 別個のリーダーとフォロワーアダプタを使用して制御します。 [遠隔操作](tools/teleoperation/README.md).
<!-- /translated-content -->
