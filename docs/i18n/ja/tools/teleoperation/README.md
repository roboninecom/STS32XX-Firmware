<!-- translation-navigation -->
[English](../../../en/tools/teleoperation/README.md) · [Русский](../../../ru/tools/teleoperation/README.md) · [Español](../../../es/tools/teleoperation/README.md) · [Français](../../../fr/tools/teleoperation/README.md) · [Deutsch](../../../de/tools/teleoperation/README.md) · [Português (Brasil)](../../../pt-BR/tools/teleoperation/README.md) · [简体中文](../../../zh-CN/tools/teleoperation/README.md) · [日本語](README.md) · [हिन्दी](../../../hi/tools/teleoperation/README.md) · [العربية](../../../ar/tools/teleoperation/README.md)

[英語原文](../../../../../tools/teleoperation/README.md)

> 全文の機械翻訳です。母語話者による校閲は未実施です。画像と動画は各言語で共用し、その中の文字は原文のままです。
<!-- /translation-navigation -->

<!-- translated-content -->
<a id="teleoperation"></a>
# 遠隔操作

電源のないリーダを手で移動して、パワードフォロワを移動しよう。2つの別々のシリアルバスで、1–6ジョイントペアをサポートする。リーダはファクトリファームウェアを使うことができる。フォロワーは、このリポジトリのv9ファームウェアを必要とする。

<a id="run"></a>
## 走る

Node.jsのインストール 20 それどころか 走って `npm install` リポジトリルートからコピーします。 [例えば ジョンソンは](../../../../../tools/teleoperation/example.json) オリジナル以外にも `controller.local.json`ポート、ボーレート、ジョイントID を設定し、例を共有します。 [モータープロファイル](../../../../../host/arm-control/profile.example.json) リプレイとチューニング. 独自の設定のためにそれをコピーして、そのパスを更新するか、またはあなたのプロファイルをインライン化する. パスはコントローラファイルと相対的です。

モーター設定を変更せずにマッピングをプレビューします。

```sh
npm run teleoperate -- CONFIG.json
```

報告された位置と目標を確認し、両方のメカニズムをサポートし、フォロワーがリーダーのポーズに向かって移動するための余地を残します。

```sh
npm run teleoperate -- CONFIG.json --run
```

各バスには、正確に構成されたIDを含める必要がある。両方のメカニズムは、保存された、空でない位置制限とユニット解像度の通常の位置モードを必要とする。フォロワー設定は、遅延書き込みの保留なしでロックされなければならない。リーダーのトルクはすでにオフでなければならない。このツールはリーダーに書き込みはしない。フォロワー起動は、電源と電源のないモーターを自動的に処理する。

明示的に設定しない限り、Ctrl+C まで実行します。 `durationMs`. **通常の出口は電源ホルダーを保持します。** 起動、重力、故障のクリーンアップは [コントロールの振る舞いを](../../host/arm-control/README.md#control-behaviour).

<a id="mapping-and-control"></a>
## マッピングとコントロール

各`joints`エントリは、`leaderId`、`followerId`と`mapping`が含まれています。

| 設定 | 意味 |
| --- | --- |
| `mapping: "angle"` | 保存されたリミットの中心からエンコーダの変位を保存します。 |
| `mapping: "range"` | リーダーの旅のそれぞれの半分を対応するフォロワーの半分にスケール. グリッパーに便利です。 |
| `direction` | `1` (既定) または `-1` 移動を反転します。 |
| `leaderMiddle`, `followerMiddle` | 範囲マッピングのためのオプションセンター、厳密に各制限内。 |

ターゲットはフォロワーの保存された制限に上限付けられ、`angle`はエンコーダ数で動作するため、互換性のあるエンコーダのスケールとギアを仮定する。

マッピングセンターは保存されたリミットの中点であり、キャリブレーション参照と異なる場合があります。 2048したがって、適合キャリブレーションのポーズだけでは、リーダーとフォロワーの制限が非対称である場合にマッチングターゲットを保証することはできない。移動前にマッピングをプレビューする。 `leaderMiddle` そして `followerMiddle` センターをオーバーライドするのは `range` マッピング

各フォロワーにプロフィールを提供し、共有します。 acceleration/ramp で説明したように設定する [モーター設定](../../host/arm-control/README.md#motor-settings-files)追加 `gravityModel` 有効にします [重力補償](../../host/arm-control/README.md#enable-gravity).

<a id="timing-and-checks"></a>
## タイミングとチェック

| オプション設定 | デフォルト | 意味 |
| --- | --- | --- |
| `hz` | 60 | リクエストされた更新レート、1–60 Hz. ミスした期間はスキップされます。 |
| `maxAgeMs` | 100 | 送信前のリーダーフレームの最大年齢、10–10000 ms。 |
| `responseTimeoutMs` | 100 | レスポンスとトランザクションキューのタイムアウト、25–10000 ms。 |
| `durationMs` | 無制限 | 制御起動、1–86400000 ms を含む実行時間。 |

各フレームにはリーダーのポジションがすべて含まれており、内部に留まります。 `maxAgeMs` 更新期間の省略。フィードバック、重力、ロギングは制御ループを共有します。達成された速度は、バスとコンピュータのパフォーマンスに依存します。 [チェックとタイミングを](../../host/arm-control/README.md#checks-and-timing).

ログは無視して保存される `logs/motion/` こう newline-delimited JSON構成、選択したセッションを含んでいる IDプレビュー、意図したコマンド、送信されたフレーム、フィードバック。 stop/error Record.Records. コマンドレコードだけでは、ターゲットが送信または受け入れられたことを証明できない。書き込みは無制限のログキューを蓄積せずに待機する。遅いロギングは、その原因となる可能性がある。 frame-age 確認して

接続されたリーダーなしでログを再生します。 [recorded-session リプレイコマンド](../poses/README.md#replay-a-recorded-session).

オフラインテストを`npm run test:teleoperation`で実行する。
<!-- /translated-content -->
