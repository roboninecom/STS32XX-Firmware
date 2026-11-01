<!-- translation-navigation -->
[English](../../../en/tools/hw-diff-tests/README.md) · [Русский](../../../ru/tools/hw-diff-tests/README.md) · [Español](../../../es/tools/hw-diff-tests/README.md) · [Français](../../../fr/tools/hw-diff-tests/README.md) · [Deutsch](../../../de/tools/hw-diff-tests/README.md) · [Português (Brasil)](../../../pt-BR/tools/hw-diff-tests/README.md) · [简体中文](../../../zh-CN/tools/hw-diff-tests/README.md) · [日本語](README.md) · [हिन्दी](../../../hi/tools/hw-diff-tests/README.md) · [العربية](../../../ar/tools/hw-diff-tests/README.md)

[英語原文](../../../../../tools/hw-diff-tests/README.md)

> 全文の機械翻訳です。母語話者による校閲は未実施です。画像と動画は各言語で共用し、その中の文字は原文のままです。
<!-- /translation-navigation -->

<!-- translated-content -->
<a id="hardware-comparison-tests"></a>
# ハードウェアの比較テスト

ファクトリとカスタムファームウェアの比較 STS レガシプロトコル、設定、動作、キャリブレーション、保護をカバーするスイートで、拡張プロトコルのv9コントロールのテストは行わない。テストはリポジトリを使用する。 [共有ドライバー](../../host/servo-driver/README.md).

**安全なサーボと無料のシャフト付きの専用のベンチを使用してください。** テストによっては、保存した設定やキャリブレーションを長押ししたり、連続的に移動したり、サーボをバックアップしたりします。

<a id="setup"></a>
## 設定

Node.js **20 または newer** をインストールし、リポジトリルートから実行します。

```sh
npm ci
npm run test:diff
npm run diff -- --list
```

これらのコマンドはオフラインで実行されます。 `--list` 各シナリオのステージ、モーション分類、正確な名前を表示します。 `--help` すべてのコマンドオプション。

テストサーボのみを接続します: 場合によってはブロードキャストを使用します. アダプターを使用して他のプログラムを閉じ、適切なモーター供給を提供します. デフォルト接続は次のとおりです。

| 設定 | デフォルト |
|---|---|
| 工場サーボID。 | `1` |
| カスタムファームウェアサーボID。 | `2` |
| ボーレート | `1000000` |

異なる値を設定します。 `--factory-id`, `--candidate-id` そして `--baud`.IDは識別されなければならず、IDを残す **250 そして 251** テストは一時的に使用しますので使用しないでください トルクをオフにすると 設定はロックされ アクティブなアラームはありません 運動を比較するときには モーターや電源や負荷に匹敵します

```sh
export SERVO_PORT=/dev/cu.usbmodemYOUR_ADAPTER
```

ポートを独自に置き換える.Linux は通常使用する `/dev/ttyUSB0`Windows では、ポートを直接渡します。 `--port COM3`.

<a id="run-tests"></a>
## テストを実行する

コミュニケーションチェックから始めます。

```sh
npm run diff -- --port "$SERVO_PORT" --case test_ping
```

デフォルトのグループを実行します。

```sh
npm run diff -- --port "$SERVO_PORT" --stage safe
```

`safe` グループは、PING をチェックし、read-only レジスタへの書き込みの読み取りと拒否. モーターを駆動しませんが、WRITE パケットを送信します。

`--stage`のグループを選択するか、`--case`で1つの正確なシナリオを選択します。

```sh
npm run diff -- --port "$SERVO_PORT" \
  --case test_motion_write_order_gap_matrix --allow-motion
```

`--case` は `--stage` を上書きする。フォーカスド・ランは既存のサーボ設定を使う。フル・スイートのテスト構成はインストールしない。開始できない場合は、ケースの前提条件を確認する。

| 許可 | 許可 |
|---|---|
| `--allow-motion` | ドライブを有効にするかモーションコマンドを発行します。 |
| `--allow-persistence-write` | 保存された設定書き込み、キャリブレーション、restore-defaults |
| `--allow-template-write` | 保存したリセットテンプレートを置き換えます。 |
| `--allow-current-protection` | Driven current-protectionテスト。モーション権限も必要です。 |

フルスイートでは、すべての4つの許可と1000000の初期ボーレートが必要です。

```sh
npm run diff -- --port "$SERVO_PORT" --stage all \
  --allow-motion --allow-persistence-write \
  --allow-template-write --allow-current-protection
```

最初のnon-passingケースの後、停止するために`--fail-fast`を追加します。

<a id="settings-and-cleanup"></a>
## 設定とクリーンアップ

**フルスイートは元の設定を復元しません.*** サーボのリセットテンプレートを読み込んで保存したテスト構成をインストールし、終了します. テンプレートテストは、そのテンプレートをスイート設定に置き換えます。

これらの集中テストは、永続的な効果もあります。

- `prerequisites`は、restore-defaultsとキャリブレーションが含まれています. そのオフセットテストは、2048に表示位置を置く新しいオフセットを保存します。
- `restore-defaults`は、メーカーの元の設定と異なる可能性がある保存されたリセットテンプレート(`0x06`)をロードします。
- `template`は、リセットテンプレート(`0x09`)をpre-testアクティブな設定に置き換えます. 古いテンプレートは、このスイートで読み戻したり復元することはできません。

他の永続化ケースでは、変更した設定を復元しようとします。別の実行の前に必ずクリーンアップエラーを検査します。バックアップコマンドとファクトリカバリについては、[設定バックアップとリカバリ](../flash/README.md#restore-factory-settings)を参照してください。

**Ctrl+C では終了処理やレポートの保存は保証されません。** 実行プログラムには通常の割り込み終了処理がありません。直ちに動作を止める必要がある場合はモーターの電源を切り、再開前に通信、設定、トルクの状態を確認してください。

<a id="compare-against-a-saved-factory-run"></a>
## 保存された工場運営と比較する

同じケース、スイートリビジョン、ボーレート、および同等のベンチ条件を使用します。

```sh
npm run diff -- --port "$SERVO_PORT" --mode factory --case test_ping

npm run diff -- --port "$SERVO_PORT" --mode candidate --case test_ping \
  --reference tools/hw-diff-tests/results/FACTORY_TIMESTAMP/report.json
```

参照パスを最初の実行レポートに置き換える. 元の工場を保ちます。 ID で `--factory-id`; 候補者は別人でなければならない ID書き込み後に同じ物理サーボをテストしても、スイートはそれを変えません。 ID 君のために Pair-only ケースはスキップされます single-device モードなし `--reference`あ... single-device pass は、ファクトリ等価性ではなく、そのシナリオのアサーションのみをチェックする。

<a id="results"></a>
## 結果

レポートは`tools/hw-diff-tests/results/`、または`--results`で提供されるディレクトリの下で保存される。

開館 `report.json` 各デバイスの観察、比較、送信されたパケット、受信した応答とタイミング。 `fatal`, `cleanupError` そして `closeError` 事件の結果も同様です

| 結果 | 意味 |
|---|---|
| `passed` | アサーションと利用可能な比較 |
| `mismatch` | 工場と候補者の観察は異なっていた |
| `failed` | アサーション、コミュニケーション、または回復チェックが失敗しました。 |
| `inconclusive` | その工場は比較に必要な効果を作り出さなかった |
| `skipped` | 事件は起こらなかった |

終了コード **0** 報告された失敗はなく 未解決の症例は残るかもしれません **1** つまり argument/setup エラーまたは未処理例外。 **2** 報告には失敗やミスマッチ 決定的な結果や cleanup/connection-close 間違いです

タイミングには、ホストスケジューリング、USB、シリアル遅延が含まれます。それは、ファームウェア実行時間の直接的な測定ではありません. レポートを保存し、ファームウェアに動作の違いをアトリビュートする前に集中ケースを再現します。
<!-- /translated-content -->
