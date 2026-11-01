<!-- translation-navigation -->
[English](../../../en/tools/poses/README.md) · [Русский](../../../ru/tools/poses/README.md) · [Español](../../../es/tools/poses/README.md) · [Français](../../../fr/tools/poses/README.md) · [Deutsch](../../../de/tools/poses/README.md) · [Português (Brasil)](../../../pt-BR/tools/poses/README.md) · [简体中文](../../../zh-CN/tools/poses/README.md) · [日本語](README.md) · [हिन्दी](../../../hi/tools/poses/README.md) · [العربية](../../../ar/tools/poses/README.md)

[英語原文](../../../../../tools/poses/README.md)

> 全文の機械翻訳です。母語話者による校閲は未実施です。画像と動画は各言語で共用し、その中の文字は原文のままです。
<!-- /translation-navigation -->

<!-- translated-content -->
<a id="record-and-replay-poses"></a>
# 記録と再生のポーズ

名前付きのポジションをトルクオフで記録し、保存されたレガシー設定または調整された拡張設定のいずれかで再生します. コマンドはリポジトリルートから実行されます。

| コマンド | 入力 | ファームウェア |
| --- | --- | --- |
| `npm run record-poses` | 手動位置決め | 工場またはカスタム |
| `npm run replay` | 名前付きポーズまたは遠隔操作セッション | 拡張v9 |
| `npm run replay-legacy` | 名前付きポーズ | ファクトリまたはカスタム v9 |

<a id="record-poses"></a>
## レコードポーズ

Node.js 20以上をインストールし、リポジトリルートから実行します。

```sh
npm install
npm run record-poses -- --port /dev/ttyUSB0 --ids 1,2,3
```

オプションのフラグは、`--baud` (デフォルト 1000000)、`--output DIR`、`--timeout-ms` (デフォルト 1000) です。

仕上げ [オフセットとリミット校正](../settings/README.md#calibrate-joint-offsets-and-limits) 1.記録されたポーズは移動ウェイポイントであり、名前付きポーズをキャプチャする `home` それとも `reference` モーターのキャリブレーションを変更しません。

1. トルクが解放されると落ちないように機構を支えます。
2. 確認プロンプトでEnterを押して、レコーダーが選択したモーターのトルクを無効にし、オフになっていることを確認します。
3. 機構を動かして静止させ、Enter を押してポーズを記録します。一意の名前を入力することもできます。名前を付けないポーズは `position-1`、`position-2` などになります。
4. 必要に応じて繰り返し、Ctrl+Cを押して中断する`done`を入力します。

記録後もトルクは停止します。読み込みはシーケンシャルなので、各ポーズは静止機構のスナップショットです。動作の測定は同期ではありません。読み忘れ、アラーム、有効化されたモーターがセッションを停止します。出口で、ツールはトルクを再度無効にしようとし、失敗した検証を報告します。

<a id="saved-files"></a>
## 保存ファイル

新しいJSONファイルがセッションごとに`tools/poses/recordings/`で作成される。成功したキャプチャはそれぞれ、そのファイルをアトミックに置き換える。後でキャプチャに失敗した場合、保存された以前のポーズは引き続き利用可能である。記録はGitによって無視される。

`sts-poses` バージョン 1 フォーマットは、配列順序ではなく、モーター ID によって位置を識別します。

```json
{
  "format": "sts-poses",
  "version": 1,
  "units": "encoder-counts",
  "ids": [1, 3],
  "readMode": "sequential",
  "poses": [
    {
      "name": "home",
      "capturedAt": "2026-10-24T12:00:00.000Z",
      "durationMs": 4.2,
      "positions": {"1": 2048, "3": 3100}
    }
  ]
}
```

ファイルには、セッション時間、シリアルポート、ボーレートも含まれます。 `durationMs` 完全な取得を測定する. カウントは、すでにモーターのオフセットと方向設定を含め、角度への変換なしで報告された位置に署名されている. ファイルは、速度、加速または再生のタイミング設定、およびキャリブレーションスナップショットがありません。 Re-record リプレイでは、古いポーズファイルが異なるオフセットを使用していることを検出できない。

<a id="replay-poses"></a>
## リプレイポーズ

コピー [リプレイ。 例。 ジョンソン。](../../../../../tools/poses/replay.example.json) オリジナル以外には `tools/poses/controller.local.json`設定 `followerPort` 提供し `profiles` 記録されたモーターごとにエントリ。IDは記録から来ます。リーダーやジョイントマッピングは不要です。例は共有を参照します。 [モータープロファイル](../../../../../host/arm-control/profile.example.json)プロファイルを自身の設定にコピーし、パスを更新したり、設定をインラインに設定します。すべてのプロファイルと重力パスは、コントローラファイルと相対的です。例では、フォーマットを説明します。メカニズムでテストされた設定を使用します。

```sh
npm run replay -- CONFIG.json POSES.json
npm run replay -- CONFIG.json POSES.json --run
```

最初のコマンドは、設定を変更せずにフルパスをプレビューし、保存された制限に上限を課したターゲットをレポートする。`--run`は、現在の位置から最初のポーズへのアプローチを含む動作を開始する。フォロワーポートのみが開かれる。64 MiBまでのファイルは、ポートが開く前に受け入れられ、検証される。

...... [共有コントローラ](../../host/arm-control/README.md) プロファイルを適用し、既存のパワードセッションを処理し、重力補償を提供します。 `gravityModel` 構成されています **通常のコンプリートとCtrl+Cはパワードホールドを保持します。** Ctrl+C は緊急停止ではありません。 top-level `durationMs` ファイル全体の再生を省略します。

各ポーズはまとめてグループコマンドで送信されます。関節の速度は移動距離に比例し、再生速度と各モーターの速度制限に従います。各モーターは独自の S-curve を生成するため、到着時刻は近似的で、ウェイポイント間の軌道を連続的につなぐ処理は行いません。再生は、プランナーが完了し、すべての測定位置が `toleranceCounts` の範囲内に入るまで待ってから保持時間を開始します。移動が `moveTimeoutMs` を超えると失敗します。手動で記録したタイムスタンプは再生速度を決めません。

| `replay` 設定 | デフォルト | 意味 |
| --- | --- | --- |
| `speed` | 1000 | 最大速度、1–65535エンコーダcounts/s。 |
| `holdMs` | 1000 | 到着後に停止、0–600000 ms。 |
| `repeat` | 1 | パスの数、1–1000。各パスは最初のポーズに戻ります。 |
| `moveTimeoutMs` | 30000 | 到着タイムアウト、1–600000 ms。 |
| `toleranceCounts` | 10 | 測定位置誤差、0–32767カウントを許可します。 |

<a id="replay-a-recorded-session"></a>
## 録画したセッションを再生します。

リーダーを接続せずに遠隔操作ログを再生します。

```sh
npm run replay -- CONFIG.json SESSION.ndjson
npm run replay -- CONFIG.json SESSION.ndjson --run
```

記録には、リーダー限界とジョイントマッピングを備えた`preflight`と、モノトニックタイムスタンプとすべてのリーダーポジションを備えた`command`イベントを含める必要がある。現在の構成では、同じジョイントマッピングを使用する。記録されたリーダー位置は、記録されたリーダー限界とフォロワーの現在の制限を通じてマッピングされる。現在のプロファイルと重力が適用される。履歴設定と努力は再利用されない。失敗したログの意図されたコマンドがモーターに到達したことはないかもしれない。

Playback は記録したギャップを保存します。 catch-up フィードバックと重力の更新は一時停止中に続きます。 `replay.repeat`, `moveTimeoutMs` そして `toleranceCounts` 適用します。 `speed` そして `holdMs` 名前付きポーズにのみ適用します。最後のフレームは完了前に到着する必要があります。

<a id="legacy-replay"></a>
## レガシーリプレイ

モーターの保存されたPID設定を、延長速度フィードフォワードや重力補償なしで使用してください。コントローラファイルは不要で、永続的な設定は変更されません。モーターには絶対位置モードとユニットエンコーダ解像度が必要です。

```sh
npm run replay-legacy -- POSES.json --port /dev/ttyUSB0
npm run replay-legacy -- POSES.json --port /dev/ttyUSB0 --run
```

最初のコマンドプレビュー:`--run`moves.IDはポーズファイルから、アダプター上の他のモーターは単独で、カスタムファームウェアはレガシーモードに切り替える。設定は短時間で無効になり、選択した各モーターはre-enablesが最初に現在の位置をシードする。

| オプション | デフォルト | 意味 |
| --- | --- | --- |
| `--speed` | 1000 | 最大速度、1–32767エンコーダcounts/s。 |
| `--acceleration` | 5000 | Counts/s² 100–25400 複数の 100保存された制限が適用される。 |
| `--hold-ms` | 1000 | 計画された移動のたびに、0–600000 ms。 |
| `--baud` | 1000000 | アダプターボーレート。 |

各ポーズはグループコマンドとdistance-scaled速度を使用してほぼ同時に到着する。ターゲットは保存された位置制限に制限される。プレイバックは内部モーションプロファイルが終了するのを待ち、ホールドする。測定された位置エラーはゼロである。30秒以上の移動は失敗する。

完成度は最終ポーズのトルクを保持します。拡張リプレイとは異なり、**Ctrl+Cはtorque-off**を試みます。

<a id="logs-and-visualization"></a>
## ログと視覚化

どちらのリプレイコマンドもログを ignored に保存します。 `logs/motion/`キャリブレーション、ソースID、コマンド、フィードバックなど。 [テレメトリビューアー](../simulation/README.md) 別の端末でリプレイを実行します

```sh
mkdir -p logs/motion
tools/simulation/.venv/bin/python tools/simulation/viewer.py live logs/motion --model so102
```

利用 `--model so101` 他のバンドルモデルと一致するエンコーダマッピングのために、拡張リプレイは、ビューアによって示される移動参照に関する詳細なフィードバックを読み込む。トラフィックを減らすために、追加する。 `--compact`; 測定された動きと補償は引き続きアクティブですが、影は中間プランナーの位置ではなく目的地を示しています。 PID 利用規約および適用報酬の貢献も省略されています。 [フィードバックとタイミング](../../host/arm-control/README.md#checks-and-timing).

`npm run test:poses`でオフラインレコーディング、エクステンションリプレイ、レガシーリプレイテストを実行します。
<!-- /translated-content -->
