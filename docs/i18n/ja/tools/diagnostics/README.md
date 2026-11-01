<!-- translation-navigation -->
[English](../../../en/tools/diagnostics/README.md) · [Русский](../../../ru/tools/diagnostics/README.md) · [Español](../../../es/tools/diagnostics/README.md) · [Français](../../../fr/tools/diagnostics/README.md) · [Deutsch](../../../de/tools/diagnostics/README.md) · [Português (Brasil)](../../../pt-BR/tools/diagnostics/README.md) · [简体中文](../../../zh-CN/tools/diagnostics/README.md) · [日本語](README.md) · [हिन्दी](../../../hi/tools/diagnostics/README.md) · [العربية](../../../ar/tools/diagnostics/README.md)

[英語原文](../../../../../tools/diagnostics/README.md)

> 全文の機械翻訳です。母語話者による校閲は未実施です。画像と動画は各言語で共用し、その中の文字は原文のままです。
<!-- /translation-navigation -->

<!-- translated-content -->
<a id="bus-benchmark-and-telemetry-diagnostics"></a>
# バスベンチマークとテレメトリ診断

STSサーボ用の2つのcommand-lineツール: 通信性能の測定と、異常な読み取りのための定常テレメトリのチェック。 Node.js 20以上が必要である。リポジトリルートから、`npm install`への依存関係をインストールする。

トルクをオフにし、設定をロックしてモーターを静止させ、シリアルポートを使用して他のプログラムを停止します。両方のツールは、実行前と実行後に選択したサーボを確認します.トルクを有効にしたり、モーターを移動したり、ファームウェアを書き込みさせたり、設定を保存したりしません。

<a id="bus-benchmark"></a>
## バスベンチマーク

```sh
npm run bus-benchmark -- --port /dev/cu.usbmodemXXXX --ids 1,2 --repetitions 1000
```

デフォルトでは、PINGとREADの異なるサイズの要求を測定する。各ケースでは、20ウォームアップ試行が実行され、1,000はモーターあたりの試行が測定される。モーターの順序はラウンド間を回転する。失敗した試みは失敗のままであり、再試行はそれらを置き換えることはない。

便利なオプション:

- `--list`: ポートを開かないケースをリストします。
- `--cases ping,read-table-87`: 選択したケースを実行します。
- `--warmup 20`、`--repetitions 1000`:ケースとモーターごとに試行します。
- `--gap-ms 1`: リクエスト間の一時停止。
- `--results DIR`:出力親。デフォルトは`tools/diagnostics/results`です。
- `--include-writes`: ベンチマークが書き込みを承認 RAM レジスター 51–54これらのレジスタは、他のファームウェアでは文書化されていない。このオプションは、検証済みの互換性のあるサーボでのみ使用する。元の値は、完了、障害、または優雅な中断時に復元される。書き込みの承認を有効にする必要がある。

各実行は、新しいディレクトリを作成します。 `summary.csv`, `report.json` そして `samples.jsonl`要約には、中央値、p95、p99、最大遅延、タイムアウトとエラー数が含まれる。生記録にはウォームアップとクリーンアップの交換が含まれる。

遅延は、シリアル書き込み呼び出しから一致するデコードされた応答まで実行される。これには、USBとoperating-systemの遅延が含まれる。firmware-onlyの応答時間や最大バス容量の測定ではない。タイムアウトは、レイテンシパーセンタイルに含まれていない、別々にカウントされる。

<a id="telemetry"></a>
## テレメトリ

```sh
npm run telemetry -- --port /dev/cu.usbmodemXXXX --ids 1,2 \
  --samples 1000 --interval-ms 20 --output tools/diagnostics/results/telemetry-check
```

各ラウンドで、モーターごとにレジスタ 56 から 17 バイトを読み取ります。既定ではモーターごとに 100,000 サンプルを取得し、追加の待機時間は設けません。実行ごとに新しい出力ディレクトリを使用してください。既存のサンプルファイルは上書きされません。

- `--interval-ms 20`:ラウンドスタート間の最小間隔。`missedDeadlines`でミススロットをスキップしてカウントします。
- `--gap-ms 1`:代わりに、各モーター要求後に一時停止. `--interval-ms`と組み合わせることはできません。
- `--voltage-min 5.5 --voltage-max 8.4`:電圧の期待電圧範囲。デフォルトは8–16 V. 接続されたモーターと電源のためにこれを設定します。

出力: `samples.csv` あらゆる試みを `anomalies.jsonl` フラグ付きの読み取りと生の交換が含まれています。 `report.json` カウント、範囲、タイミング統計、 before/after 設定 CSV 電圧はボルトの10分の1です。位置、速度、電流、および労力は、生のレジスタユニットを保持します。

フラグの電圧と温度の変化, 目立たない読み取り, 非ゼロ状態, トルクがオフの際の作業のチェック。 温度スパイク検出には3つの連続した有効な応答が必要である。 欠如または無効な応答がシーケンスを破る。 これらのフラグは、検査する読み取りを識別し、ファームウェアやセンサの障害の証明ではない。 同一の定常読み取りは正常であり、古いデータを証明しない。

<a id="common-options-and-tests"></a>
## 一般的なオプションとテスト

どちらのツールも、`--baud 1000000`、`--timeout-ms 100`、`--help`を受け付けている。デフォルトでは`1,2`のIDである。接続されたモーターを指定する。シリアル書き込みが終了した後に応答タイムアウトを開始する。タイムアウトの後、応答にシーケンス番号が含まれていないため、ツールは継続前に静かなバスを待機する。

Ctrl+Cは実行を停止し、クリーンアップを実行する。エラー、不完全な実行、フラグ付きサンプルは、非ゼロの終了コードを生成する。`results/`の下での結果は、Gitによって無視される。

```sh
npm run test:diagnostics
```

これらのオフラインテストはハードウェアに接続しない。
<!-- /translated-content -->
