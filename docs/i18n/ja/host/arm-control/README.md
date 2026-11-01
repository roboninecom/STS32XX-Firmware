<!-- translation-navigation -->
[English](../../../en/host/arm-control/README.md) · [Русский](../../../ru/host/arm-control/README.md) · [Español](../../../es/host/arm-control/README.md) · [Français](../../../fr/host/arm-control/README.md) · [Deutsch](../../../de/host/arm-control/README.md) · [Português (Brasil)](../../../pt-BR/host/arm-control/README.md) · [简体中文](../../../zh-CN/host/arm-control/README.md) · [日本語](README.md) · [हिन्दी](../../../hi/host/arm-control/README.md) · [العربية](../../../ar/host/arm-control/README.md)

[英語原文](../../../../../host/arm-control/README.md)

> 全文の機械翻訳です。母語話者による校閲は未実施です。画像と動画は各言語で共用し、その中の文字は原文のままです。
<!-- /translation-navigation -->

<!-- translated-content -->
<a id="shared-arm-controller-and-gravity-compensation"></a>
# 共有アームコントローラと重力補償

ライブテレオペレーションやチューニング named-pose 再生して timed-session 設定、目標、測定されたフィードバック、重力、クリーンアップを処理します。 [サーボドライバー](../servo-driver/README.md) パケットエンコーディングとトランスポートを所有しています。

<a id="motor-settings-files"></a>
## モーター設定ファイル

参照 [SO-101 そして SO-102 プロフィール](profiles/README.md) 参照設定とその動作制限。

`profiles`は、コントローラファイルに対するインライン設定またはパスを含むことがあります。

```json
"profiles": {"1": "motor-1.json", "2": "motor-2.json"}
```

サンプルプロファイル[](../../../../../host/arm-control/profile.example.json)は、ツールの例で共有されている。独自の設定でコピーして参照を更新したり、プロファイルをインライン化したりできる。コントローラファイルを移動した場合、プロファイルと重力パスを調整する。`*.local.json`という名前のファイルは、Gitでは無視される。

コントローラーの `acceleration` を counts/s²（1–30000）、`rampTimeMs` をミリ秒（1–255）で設定します。各モーターのプロファイルでは、`accelerationLimit` と `rampTimeMs` でこれらを個別に上書きできます。プロファイルは Extension の RAM 設定です。保存済みのエンコーダーオフセットと可動範囲の制限は別の設定です。

| プロフィールフィールド | 意味 |
| --- | --- |
| `kpQ8`, `kdQ8`, `kiQ8` | コントローラゲインに256を乗じます。 |
| `integralLimit`, `effortLimit` | PWMの努力単位の合計出力限界。 |
| `velocityLimit` | 最大速度はcounts/sです。デフォルトは65535です。 |
| `velocityFilterQ8` | 速度フィルタ設定、1–255の測定。 |
| `gravitySlewEffortPerS` | 重力作業のレート制限が変更されます。 |
| `velocityFeedforward` | `positiveGainQ8`、`negativeGainQ8`、`effortLimit`。 |

参照 [ファームウェア登録ガイド](../../DETAILED_DOCUMENTATION.md#configuration--0xa0) 完全なユニットと範囲です per-motor 設定、切り替え不可能なファームウェアプロファイル。

チューニングと設定の適用には `joints: [{ "followerId": 1 }]` を使用し、制御するモーターごとにエントリを追加します。Named-pose の再生は記録から ID を取得するため、`joints` 配列は不要です。ライブの遠隔操作と recorded-leader の再生だけが、`leaderId`、`mapping`、必要に応じた direction/centers を使用します。[遠隔操作のマッピング](../../tools/teleoperation/README.md#mapping-and-control)を参照してください。

<a id="enable-gravity"></a>
## 重力を有効にする

既存の設定に `gravityModel` を追加します。パスは作業ディレクトリではなく **設定ファイル** に相対します。

```json
"gravityModel": "host/arm-control/models/arm-upright-empty.json"
```

この行は、独立したファイルではなく、完全な構成の追加です。すべてのフォロワーのためにテストされた`profiles`を提供します。`effortLimit`は、総モーター出力をキャプチャし、`gravitySlewEffortPerS`は、重力の努力の変化の速度を制限します。スリューを設定するだけでは重力を有効にしません。`gravityModel`なしでは、リプレイは重力の努力をクリアし、重力補償なしで実行します。

供給者 [腕型](models/README.md) 直立した状態を保ち empty-gripper 腕のキャリブレーションです モーターの係数は 2–4 結合ジョイントを含む測定されたエンコーダ数を使用します。 1, 5 そして 6 すべての制御されたフォロワーはモデルを必要とし、その用語で使用されるすべての関節は制御および測定されなければならない。 Angle-dependent モデルは `encoderCalibration` それぞれの入力に署名します。 `positionCorrection`, `resolution: 1`そして `reverse` (エンコーダ反転フラグ)Preflightはこれらをモーターレジスタと比較し、セットアップやトルク有効化の前にミスマッチを拒否する。同じアームから一致するバックアップを復元するか、再調整後にモデルを更新して検証する。参照キャプチャ 2048 モデルの物理的角度は確立しません。 [校正ガイド](../../tools/settings/README.md#choose-the-reference-pose)どちらにしても six-motor IDを含むモデル 1–6 エンコーダのオフセット、マウント、ジオメトリ、ペイロードを変更した後、キャリブレーションを確認せずにモデルを再利用しないでください。

コマンドごとに同じ設定フィールドを使用します。

```sh
npm run teleoperate -- CONFIG.json
npm run replay -- CONFIG.json POSES.json
npm run replay -- CONFIG.json SESSION.ndjson
```

これらのコマンドはプレビューのみである。`--run`を追加して制御を開始する。現在の構成と測定されたフォロワ位置は重力を決定する。記録された重力値と過去の利得は決して再生されない。モデルは使用前に検証され、そのパスとSHA-256ハッシュはセッションログに含まれている。

<a id="control-behaviour"></a>
## 制御行動

1. プリフライトは、ファームウェア、保存されたリミット、ヘルス、プロファイル、モデル入力をチェックします。
2. すべてのコントローラツールは、互換性のある動力セッションを継続するか、自動的に新しいものを準備します。マッチングプロファイルはトルクを保ちます。
3. 重力は、最初の移動目標の前に測定、送信、および確認されます。
4. 移動中も待機中も、同じフィードバック読み取りで健全性の確認と重力計算を行います。重力補償は約 50 ms ごとに更新されます。別のテレメトリー読み取り処理や、ホスト側の速度フィードフォワードループはありません。
5. 通常の出口では、重力は最終動作と残りのファームウェアの重力によって続きます。コントローラは200 msの残りを待ち、30の完了タイムアウトを行い、最終的な重力更新を確認します。トルクは継続します。ファームウェアは最後の目標と重力の努力を保持します。

Ctrl+Cでは、リプレイと遠隔操作のために新しいターゲットを停止し、同じ完了シーケンスに従って、バッチと試行を中断します。 torque-offCtrl+Cは緊急停止ではありません。残りは、プランナーが停止し、測定された各位置がa内に留まることを意味します。 one-count いっぱいの範囲 200 MS間隔 ゼロトラッキングエラーを証明しません pose/session リプレイは、設定された着信公差も適用します。

退出後にプロセスが重力をリフレッシュするのを止めます アームがその後動かされたり 負荷が変わったりすると 残された作業は適応しません 殺害されたプロセスや接続されていないバスは 最後の目標と労力を有効に保ちます

<a id="checks-and-timing"></a>
## チェックとタイミング

Gravityは、要求されたターゲットではなく、測定されたフォロワーの位置を使用する。フィードバックサンプルは健全で新鮮で、現在のセッションに属さなければならない。すべての重力更新には独自のシーケンスがあり、次のフィードバックパスで受理がチェックされる。すべての結果は、書き込みの前にモデルとモーターの動作キャップに対してチェックされる。過剰な結果はエラーであり、クリップされた値ではない。

結合した測定はシーケンシャルで、取得、キュー、そしてその後の書き込みはそのままでなければならない 100 遅延したリーダー、ロガー、バスが古い重力で静かに続行するのではなく障害を起こす。これらはホストチェックであり、ファームウェアタイムアウトではない。 I/O 検出を遅らせることができます。 real-time コントローラー

ライブヘルスチェックはほぼすべて実行されます。 250 重力や重荷のない ms 50 ms を使っています C2 フィードバックを 50 ホールドとタイムド再生中のMS。到着チェックはより速くポーリングされることがあります。 `--compact` より小さく C1 中間プランナーの位置を省略したパケット PID コントリビューション すべてのモーターに関する詳細なフィードバックをチューニングします。 C2 探知機と C1 フィードバックは常に重力リーダーを共有します

モデルエラー、拒否された更新、missing/staleフィードバック、所有権の喪失、60 °C 試行以上のアラームと温度は、すべての準備されたフォロワーで torque-off を検証しました。

1つの例外は確立されたホールドの間にgravity-updateの締め切りを逃すことです:コントローラーは2つの新鮮なフィードバックが同じセッションの健康な、静止したモーターを確認すればだけトルクを保ちます. 実行はまだ失敗し、`holdRetained: true`を報告します;それは自動的に再開しません。

テレメトリログレコードには、測定されたフィードバックと最新の要求された重力effort/sequenceが含まれる。ファームウェアフィードバックは、その後のサンプルに対する要求を確認する。記録された要求のみは、受け入れの証明ではない。`settledAt`は、要求された重力スキューが終了するタイミングの保守的なホスト推定である。

<a id="api-and-tests"></a>
## APIとテスト

`session.run` シリアル接続、セッションログ、入力ソースのクリーンアップを管理します。 `ArmController` フォロワードライバ、設定、入力ソース、オプションを受け付けます。 `GravityModel` instance.load モデル `await GravityModel.load(filename)`; CLI 解決します configuration-relative path. 入力ソースは `joints`, `preflight`, `describe`, `sample` そして `play`; ライブ入力は、リーダーが電源をオフにしていることを確認します. 自動チューニングは同じリーダーを介してプローブモーターの詳細なフィードバックを要求できます。 `changeProfile` 静止制御を検証し、そのモーターのみを解放し、構成し、 re-enables 変更されたモーターはトルクを一時的に失い、再起動時に測定された位置をキャプチャします。プロファイルの変更にはサポートされたポーズまたは機械的に安全なポーズを使用します。 all-motor 故障の片付けだ

ソースはコントローラを通じてポジションを送信し、そのサービス待ちを使用するため、長い一時停止はフィードバックの更新を継続します。

共有コントローラ用の`npm run test:arm`、recording/replay用の`npm run test:poses`、ライブコントロール用の`npm run test:teleoperation`を実行する。
<!-- /translated-content -->
