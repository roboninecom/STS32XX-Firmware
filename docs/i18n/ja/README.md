<!-- translation-navigation -->
[English](../en/README.md) · [Русский](../ru/README.md) · [Español](../es/README.md) · [Français](../fr/README.md) · [Deutsch](../de/README.md) · [Português (Brasil)](../pt-BR/README.md) · [简体中文](../zh-CN/README.md) · [日本語](README.md) · [हिन्दी](../hi/README.md) · [العربية](../ar/README.md)

[英語原文](../../../README.md)

> 全文の機械翻訳です。母語話者による校閲は未実施です。画像と動画は各言語で共用し、その中の文字は原文のままです。
<!-- /translation-navigation -->

<!-- translated-content -->
<a id="sts32xx-firmware"></a>
# STS32XX ファームウェア

ファームウェア GD32F130-based STS3215 サーボ規格 STS コマンドはレガシーモードで利用できます。拡張モードでは、ローカルで計画されたスムーズな動作、設定可能な位置制御、ベロシティフィードフォワード、および。 host-calculated 重力補償です

まずは **[クイックスタート](QUICKSTART.md)** ガイドする、または読む [詳細なドキュメント](DETAILED_DOCUMENTATION.md) コンフィギュレーションとプロトコルの詳細。

[![概要 SO-101 そして SO-102 before-and-after テスト](../../../assets/readme/posters/overview.jpg)](https://youtu.be/AsxFs24vXQs)

[YouTubeで見る](https://youtu.be/AsxFs24vXQs) | [MP4](../../../assets/readme/videos/overview.mp4)

近似値は記録されたデモンストレーションを記述し、ワークスペース全体の精度を保証するものではない。

サイレントクリップを見るには、下の動画またはYouTubeリンクを選択します. すべてのドキュメント動画はリンクで利用可能です(未記載)。 MP4 コピーも用意されています

- [なぜ私たちは](#why-we-built-it)
- [制御の](#what-changes-in-control)の変化は?
- [結果 SO-101 / SO-102](#results-on-so-101--so-102)
- [ロボットとリンク](#robots-and-links)
- [クイックスタート](#quick-start)
- [詳細なドキュメント](#detailed-documentation)

<a id="why-we-built-it"></a>
## なぜ私たちは

ロボットアームは同じ点に一貫して戻り、コマンドされたターゲットを逃すことができます。 **再現性** 一貫性を説明します **絶対位置決め精度** 腕が目標にどれだけ近づくかを説明します

**インジケータで測定した繰り返しリターン**

[![インジケータで測定した繰り返しリターン](../../../assets/readme/posters/repeatability.jpg)](https://youtu.be/_VN10zWybBU)

[YouTubeで見る](https://youtu.be/_VN10zWybBU) | [MP4](../../../assets/readme/videos/repeatability.mp4)

**再現性 vs 絶対位置決め精度**

[![再現性と絶対位置決め精度の概念的説明](../../../assets/readme/posters/repeatability-vs-accuracy.jpg)](https://youtu.be/L5FINW5FATI)

[YouTubeで見る](https://youtu.be/L5FINW5FATI) | [MP4](../../../assets/readme/videos/repeatability-vs-accuracy.mp4)

ストックファームウェアでPIDをチューニングして位置決め誤差を低減しようとしたところ、エラーを軽減した設定が振動の原因となったケースもありますが、モーションプランニングや位置決めをよりコントロールできるカスタムファームウェアを開発しました。

[![ストックファームウェア: 振動中。 PID チューニング](../../../assets/readme/posters/stock-pid-oscillation.jpg)](https://youtu.be/wIBd3jnOwRk)

[YouTubeで見る](https://youtu.be/wIBd3jnOwRk) | [MP4](../../../assets/readme/videos/stock-pid-oscillation.mp4)

<a id="what-changes-in-control"></a>
## コントロールの変化とは?

ホストは目標と設定を送信し、各サーボは独自の動作を計画および制御します。

1. ホストは目標と設定を送信し、設定時に重力補償を計算します。
2. 各サーボは独自のS-curveモーションを計画します。
3. ローカルPIDとフィードフォワード制御は、測定位置と推定速度を使用してモーター出力を調整します。

[録画された概要を YouTube でご覧ください](https://youtu.be/AsxFs24vXQs) | [MP4](../../../assets/readme/videos/overview.mp4)

<a id="s-curve-motion"></a>
### S-curveモーション

加速度とブレーキを徐々に増やし、カーブは時間の経過とともに加速を表します。

[![s-curveモーション](../../../assets/readme/illustrations/s-curve.png)](https://youtu.be/92mDt4rbobY)の概念図

[YouTubeで見る](https://youtu.be/92mDt4rbobY) | [MP4](../../../assets/readme/videos/s-curve.mp4)

[構成と制限は](DETAILED_DOCUMENTATION.md#s-curve-motion)です。

<a id="pid-control"></a>
### PID制御

サーボが位置誤差を補正する方法を調整します グレーカーブは振動を表し 白カーブは減衰反応を示しています ダッシュラインは目標です

[![pid 制御の概念図](../../../assets/readme/illustrations/pid-tuning.png)](https://youtu.be/TEpvaAMlfrg)

[YouTubeで見る](https://youtu.be/TEpvaAMlfrg) | [MP4](../../../assets/readme/videos/pid-tuning.mp4)

[構成と制限は](DETAILED_DOCUMENTATION.md#pid-controller)です。

<a id="velocity-feedforward"></a>
### 速度フィードフォワード

サーボ内で計算される計画された速度に基づいてモーター出力を追加し、両方の曲線は時間とともに左から右に進みます。

[![速度フィードフォワードの概念図](../../../assets/readme/illustrations/velocity-feedforward.png)](https://youtu.be/osGGs-nhk9I)

[YouTubeで見る](https://youtu.be/osGGs-nhk9I) | [MP4](../../../assets/readme/videos/velocity-feedforward.mp4)

[構成と制限は](DETAILED_DOCUMENTATION.md#velocity-feedforward)です。

<a id="gravity-compensation"></a>
### 重力補正

ホストはコントリビューションを計算し、サーボを適用します。下向きの矢印は重量を表し、上向きの矢印はサポートを表します。

[![重力補正の概念図](../../../assets/readme/illustrations/gravity-compensation.png)](https://youtu.be/25sc41PTDIA)

[YouTubeで見る](https://youtu.be/25sc41PTDIA) | [MP4](../../../assets/readme/videos/gravity-compensation.mp4)

[構成と制限は](DETAILED_DOCUMENTATION.md#gravity-compensation)です。

これらの説明図とアニメーションは概念を示すもので、実機で測定したグラフではありません。設定、プロトコルの詳細、制限事項は[詳細ドキュメント](DETAILED_DOCUMENTATION.md)を参照してください。Extension クライアントは **プロトコル v9.0** に対応する必要があります。Extension の設定は一時的で、リセットや電源の入れ直し後に再送信する必要があります。

<a id="results-on-so-101--so-102"></a>
## SO-101/SO-102の結果

下のビデオは録画されている。 before-and-after テストして SO-101 そして SO-102それぞれの比較は、最初に元の動作を示し、次に、 custom-firmware セットアップ

**SO-101:その前、その後**

[![SO-101 記録 before-and-after 比較](../../../assets/readme/posters/so101-before-after.jpg)](https://youtu.be/ZdLlv8q73gE)

[YouTubeで見る](https://youtu.be/ZdLlv8q73gE) | [MP4](../../../assets/readme/videos/so101-before-after.mp4)

**SO-102:その前、その後**

[![SO-102 記録 before-and-after 比較](../../../assets/readme/posters/so102-before-after.jpg)](https://youtu.be/0rmO15pFqJ4)

[YouTubeで見る](https://youtu.be/0rmO15pFqJ4) | [MP4](../../../assets/readme/videos/so102-before-after.mp4)

近似値はこれらのデモンストレーションを表し、腕のワークスペース全体の精度は保証されていない. 再現性, 絶対位置決め精度, 機械的偏向は異なる測定値である。

<a id="complete-coordinated-movement"></a>
### 完全協調運動

[![完全記録 SO-101 運動](../../../assets/readme/posters/coordinated-motion.jpg)](https://youtu.be/dCtcS5aAko0)

[YouTubeで見る](https://youtu.be/dCtcS5aAko0) | [MP4](../../../assets/readme/videos/coordinated-motion.mp4)

このクリップは、記録された動きを完全に保存します。各サーボはローカルに計画します。

<a id="mechanical-limitations"></a>
### 機械的制約

[![ギアボックスのバックラッシュとフレームのフレックス](../../../assets/readme/posters/mechanical-limits.jpg)](https://youtu.be/53l7at5aE6k)

[YouTubeで見る](https://youtu.be/53l7at5aE6k) | [MP4](../../../assets/readme/videos/mechanical-limits.mp4)

ギアボックスのバックラッシとフレームフレックスは、アームのエンドポイント位置に影響を与えます。コントローラチューニングは、これらの機械的制限を除去しません。実際のメカニズムと負荷の設定を検証します。[現在の制限は](DETAILED_DOCUMENTATION.md#current-limits)です。

<a id="robots-and-links"></a>
## ロボットとリンク

RobonineからSO-ARM101とSO-ARM102キットを探してください. キットの内容は製品ページに文書化されています。

| SO-ARM101 | SO-ARM102 |
| --- | --- |
| ![SO-ARM101ロボットキット](../../../assets/readme/illustrations/hardware-so101.jpg) | ![SO-ARM102ロボットキット](../../../assets/readme/illustrations/hardware-so102.jpg) |
| [購入する SO-ARM101 Robonineのキットです。](https://robonine.com/ru/shop/so-arm101-black-white-robotic-arm-kit/) | [購入する SO-ARM102 Robonineのキットです。](https://robonine.com/ru/shop/so-arm102-robotic-arm-kit/) |

[探索 SO-ARM102 ハードウェア CAD そして BOM](https://github.com/roboninecom/SO-ARM102).

<a id="quick-start"></a>
## クイックスタート

フォローしてください。 **[クイックスタートガイド](QUICKSTART.md)** 必須条件、コマンド、チェック、書き込み防止のための設定シーケンスは次のとおりです。

1. 必要なツールをインストールし、サーボポートを選択します。
2. モーター設定をバックアップし、公開されたカスタムファームウェアをフラッシュします。
3. 設定に必要なジョイントオフセットとトラベルリミットを校正します。
4. トルクをオフにして通信を確認します。
5. ポーズを記録し、リプレイをプレビューし、最初のモーションテストを実行します。
6. アームとキャリブレーションに一致するモデルで重力補償を可能にします。
7. トーンとビューの動き。

**書き込みはサーボを損傷したり、キャリブレーションを消したりする可能性があります.**進行前にガイドの力、トルク、および回復の注意に従ってください。

新しいことのために SO-101 それとも SO-102 キャリブレーション 既存のものを使って reference-pose 画像とフォローして [校正ガイド](tools/settings/README.md#reference-pose-images)記録と重力モデルを再利用する場合、既存の検証済みのキャリブレーションを維持する。

**SO-101参考ポーズ**

[![SO-101 6 つのラベル付きジョイントを使用した参照ポーズ](../../../tools/settings/images/so101-reference-pose.png)](../../../tools/settings/images/so101-reference-pose.png)

**SO-102参考ポーズ**

[![SO-102 6 つのラベル付きジョイントを使用した参照ポーズ](../../../tools/settings/images/so102-reference-pose.png)](../../../tools/settings/images/so102-reference-pose.png)

<a id="detailed-documentation"></a>
## 詳細なドキュメント

**[詳細なドキュメント](DETAILED_DOCUMENTATION.md)**は、構成、プロトコル、レジスタ、構築、検証をカバーし、対応するセクションと一緒に技術図と関連するビデオデモンストレーションが表示されます。

- [レガシーモード](DETAILED_DOCUMENTATION.md#legacy-mode)
- [拡張モードの仕組み](DETAILED_DOCUMENTATION.md#how-extension-mode-works)
- [S-curveモーション](DETAILED_DOCUMENTATION.md#s-curve-motion)
- [キャリブレーション基準ポーズ](DETAILED_DOCUMENTATION.md#calibration-reference-poses)
- [PIDコントローラー](DETAILED_DOCUMENTATION.md#pid-controller)
- [速度フィードフォワード](DETAILED_DOCUMENTATION.md#velocity-feedforward)
- [重力補正](DETAILED_DOCUMENTATION.md#gravity-compensation)
- [拡張モードの起動と停止](DETAILED_DOCUMENTATION.md#starting-and-stopping-extension-mode)
- [拡張プロトコル](DETAILED_DOCUMENTATION.md#extension-protocol)
- [拡張レジスタ](DETAILED_DOCUMENTATION.md#extension-registers)
- [構築と検証](DETAILED_DOCUMENTATION.md#build-and-verification)
- [リポジトリのレイアウト](DETAILED_DOCUMENTATION.md#repository-layout)
- [電流制限](DETAILED_DOCUMENTATION.md#current-limits)


個々のコマンドガイドについては[tools](tools/README.md)、ビルドツールチェーンについては[firmware](firmware/README.md)を参照してください。
<!-- /translated-content -->
