<!-- translation-navigation -->
[English](../../../en/host/servo-driver/README.md) · [Русский](../../../ru/host/servo-driver/README.md) · [Español](../../../es/host/servo-driver/README.md) · [Français](../../../fr/host/servo-driver/README.md) · [Deutsch](../../../de/host/servo-driver/README.md) · [Português (Brasil)](../../../pt-BR/host/servo-driver/README.md) · [简体中文](../../../zh-CN/host/servo-driver/README.md) · [日本語](README.md) · [हिन्दी](../../../hi/host/servo-driver/README.md) · [العربية](../../../ar/host/servo-driver/README.md)

[英語原文](../../../../../host/servo-driver/README.md)

> 全文の機械翻訳です。母語話者による校閲は未実施です。画像と動画は各言語で共用し、その中の文字は原文のままです。
<!-- /translation-navigation -->

<!-- translated-content -->
<a id="sts32xx-servo-driver"></a>
# STS32XXサーボドライバ

STS シリアルサーボと STS32XX ファームウェアの **v9 モーション拡張**用 Node.js ドライバーです。機器の検出、レジスタへのアクセス、設定操作、S-curve モーションコマンド、重力補償、フィードバックを同じシリアル接続で提供します。**Node.js 20 以降**と、対応するシリアルアダプターが必要です。

レガシー操作は、このパッケージに含まれているSTSコントロールテーブルを使用する。拡張操作には、カスタムファームウェアv9が必要である。ファクトリファームウェアは、それらを提供していない。パッケージは、Node.js用であり、ブラウザWebシリアルではない。

<a id="install"></a>
## インストール

このリポジトリから:

```sh
npm ci
npm run test:driver
npm pack --workspace sts32xx-servo-driver --pack-destination /tmp
```

別のNode.jsプロジェクトで、最後のコマンドで生成されたアーカイブをインストールします。

```sh
npm install /tmp/sts32xx-servo-driver-0.1.0.tgz
```

これはnpmレジストリに公開せずに動作する。アーカイブにはライブラリ、サンプル、README、ライセンスが含まれている。npm経由でインストールされるシリアル依存性。ファームウェア、ログ、テスト結果は含まれていない。

CommonJS

```js
const { StsServo } = require('sts32xx-servo-driver');
```

ESモジュール:

```js
import driver from 'sts32xx-servo-driver';
const { StsServo } = driver;
```

既存のリポジトリツールはインポートを継続できる `host/servo-driver` パッケージのメインエクスポートを使用する。内部ファイルパスは公開されていない API.

<a id="connect-and-read"></a>
## 接続して読む

```js
const { StsServo } = require('sts32xx-servo-driver');

const servo = new StsServo({
  serial: { path: '/dev/cu.usbmodemYOUR_ADAPTER', baudRate: 1000000 },
});

async function main() {
  try {
    const found = await servo.connect();
    for (const id of found.ids) {
      const values = await servo.bus.read(id,
        ['presentPosition', 'presentVoltage', 'servoStatus']);
      console.log(id, values, found.alarms.get(id) ?? []);
    }
  } finally {
    await servo.close();
  }
}
main().catch(console.error);
```

適宜、`/dev/ttyUSB0`、`COM3`、またはアダプタの実際のポートを使用してください。Discoveryは、選択したボーで応答IDを見つけます。モーター設定を変更したり、その他のボーレートをスキャンしたりしません。IDは一意でなければなりません。可能な限り高いIDと選択ボーを待ってください。`connect()`はポートを開き、モーターを発見します。`open()`はポートのみを開きます。バスと拡張メソッドは発見IDを必要とします。

登録の値は未使用の単位を使います `presentVoltage: 120` つまり 12 V `ControlTable` アドレス、エンコーディング、範囲、表示スケールを説明します。 Multi-byte フィールドは little-endian 符号付きレガシー値は符号ビットを使用します。

<a id="main-api"></a>
## 主なAPI

ハードウェアと通信するすべての操作は約束します。

| API | 目的 |
| --- | --- |
| `servo.connect()` / `servo.close()` | Open/discover またはシリアル接続を閉じます。 |
| `servo.bus.discover()` | 既知のIDのリストを更新します。 |
| `servo.bus.scan()` | known-IDリストを交換せずに発見します。 |
| `servo.bus.verify(ids)` | ピンは個別にモーターを知っています。 |
| `servo.bus.read(id, keys, options)` | 名前付きレジスタを読み、レジスタ名によってキー付けされたオブジェクトを返します。 |
| `servo.bus.write(id, values, options)` | 名前付きレジスタのオブジェクトを書きます。 |
| `servo.bus.readMany(ids, keys, options)` | グループリクエストを使用していくつかのモーターを読みます。 |
| `servo.bus.syncWrite(entries, options)` | グループに`{ id, values }`の形をしたエントリを書きます。 |
| `servo.bus.device(id)` | 便利なオブジェクトを取得します。 `read`, `write` そして reset/calibration 方法だ |
| `servo.settings.read(id)` | 永続的なレガシ設定を読みます。 |
| `servo.settings.save(id, values)` | 通常の設定をロック解除、保存、検証、再ロックします。 |
| `servo.arm` | 以下の v9 メソッドにアクセスします。 |

設定の保存には 250 ms の要求タイムアウトを使用します。書き込み確認を受信できなかった場合、ドライバーは永続化の完了を待ち、再試行前にレジスタを読み返します。Already-applied の書き込みは繰り返しません。一時的な通信障害には最大で三回試行します。障害が続く場合はエラーを報告し、モーターの再ロックを試みます。タイムアウトを変更するには、`settings.save` に `{ timeoutMs }` を渡します。

レガシーの例では、移動を意図した位置モードで保護されたモーターの場合です。

```js
await servo.bus.write(id, { targetPosition: 2048 },
  { timeoutMs: 100, rejectOnAlarm: true });
```

レガシーゴールライトは、保存された設定に応じてトルクを自動的に有効にします。永続的な書き込みは、キャリブレーション、制限、ゲインを変更できます。設定を変更する前にトルクを無効にします。 API 警備員 IDバウドと response-level 変更; 使用 [設定 CLI](../../tools/settings/README.md) リポジトリに格納しておけば backup/restore工場のリセット reset-template キャリブレーションコマンドは `servo.protocol`; これらの変更が意図されている場合にのみそれらを呼び出します。

<a id="v9-control-lifecycle"></a>
## v9制御ライフサイクル

1. トルクオフから始め、能力と構成を読みます。
2. トルクがオフになっている間、`arm.configure()`で検証済みの構成を適用します。
3. 新しいノンゼロセッションIDで拡張モードを選択します。
4. レガシーレジスタ40を使用してトルクを有効にし、セッションが武装し、新鮮で、drive-enabledとoutput-readyになるまでフィードバックを読みます。
5. ターゲットと重力の更新を送信し、受信したシーケンス番号を新鮮なフィードバックで検証します。
6. アプリケーションがモーターを解放しようとするときに`torqueEnable: 0`を書きます。

```js
const options = { timeoutMs: 100, rejectOnAlarm: true };
const caps = await servo.arm.capabilities(id, options);
if (caps?.major !== 9) throw new Error('Extension v9 is required');

// config must contain values validated for this motor and mechanism.
await servo.arm.configure(id, config, options);
await servo.arm.select(id, true, session, options);
await servo.bus.write(id, { torqueEnable: 1 }, options);
// Check readiness using servo.arm.feedback() before sending motion.

await servo.arm.setTargets([
  { id, target: { sequence: 1, positionQ8: 2048 * 256, speedLimit: 100 } },
], session, options);

await servo.arm.updateGravity(id,
  { session, sequence: 1, gravityEffort: -20 }, options);
```

このスニペットは、コールを示している。[完全なモーションサンプルである](../../../../../host/servo-driver/examples/v9-move.js)には、検証、準備のポーリング、受け入れチェック、torque-offクリーンアップが含まれる。書き込みの承認を無効にすると、レガシー書き込みには、`expectResponse: false`と読み取り検証が必要である。完全な例では、これを自動的に処理する。

ファームウェアは最後の目標を保持し、重力補償の最新の出力値を、新しい値で置き換えるかトルクを無効にするまで維持します。ハートビート、コマンドのタイムアウト、重力補償の有効期限はありません。**シリアル接続を閉じても、モーターは停止せず、保持も解除されません。** 終了処理は機構に合わせて設計してください。荷重を支えるアームの保持を解除すると落下することがあります。ファームウェア内のセンサーとモーターの保護機能は動作を続けます。

Torqueenableは測定された位置をキャプチャする。レガシーゴール書き込みで拡張セッションをシードするな。トルクをオフにするか、障害がセッションを終了する。再起動する前に新しいセッションを準備する。トルクをオフにしてレガシーモードを選択するには、`arm.select(id, false, 0)`を使用する。

<a id="extension-methods"></a>
### 拡張方法

| 方法 | 結果または効果 |
| --- | --- |
| `capabilities(id, options)` | `{ major, minor, tickMs }` は承認済みシグネチャです。サポートされていないファームウェアはリクエストやタイムアウトを拒否することができます。 |
| `configuration(id, options)` | 現在のRAM構成を読みます。 |
| `configure(id, config, options)` | コンフィギュレーションを書き、リードバックによってエンコードされたバイトを検証します。 |
| `select(id, enabled, session, options)` | v9コントロールを準備するか、`false, 0`でレガシーモードを選択します。 |
| `setTargets(entries, session, options)` | 1つから6つのユニークなモーターを含む1つの放送を送信します。 |
| `updateGravity(id, command, options)` | 署名済みの重力作業を独自のシーケンス番号で送信します。 |
| `feedback(id, options)` | 1つのコヒーレントな操作サンプルを読みます。 |
| `tuning(id, options)` | 操作フィードバックと参照動作と個々の作業条件を読みます。 |
| `invalidate(id)` | 外部電源サイクルまたはファームウェア変更後にキャッシュ機能をクリアします。 ID 全てをクリアする |

ドライバは、検出、ID の変更、接続の変更、およびプロトコル API を通じて発行されたリセットの機能を自動的に無効にします。

<a id="configuration-and-units"></a>
### 構成・ユニット

すべての設定フィールドは明示的です。このオブジェクトは、推奨されるチューニングプロファイルではなく、フォーマットを示しています。

```js
const config = {
  kpQ8: 256, kdQ8: 0, kiQ8: 0,
  integralLimit: 0, effortLimit: 100,
  velocityLimit: 100, accelerationLimit: 500,
  velocityFilterQ8: 64, rampTimeMs: 30,
  velocityFeedforward: {
    positiveGainQ8: 0, negativeGainQ8: 0, effortLimit: 0,
  },
  gravitySlewEffortPerS: 1000,
};
```

| フィールド | ユニットとリミット |
| --- | --- |
| `kpQ8`, `kdQ8`, `kiQ8` | 256; 整数 0–65535 を乗算する。 |
| `effortLimit`, `integralLimit` | PWM 努力ユニット; 全体の限界 1–1000、整数制限 0総じて限度。 |
| `velocityLimit`, ターゲット `speedLimit` | エンコーダ counts/s; 1–65535。 |
| `accelerationLimit` | Counts/s²; 1–30000、加速と制動で共有。 |
| `rampTimeMs` | S-curve加速度ランプ時間; 1–255 ms。 |
| `velocityFilterQ8` | フィルター係数を256; 1–255で乗算します。 |
| ベロシティフィードフォワードゲイン | Direction-specific の利得は 256; 0–65535. その努力キャップは、全体のキャップを超えることはできません. 無効にするために、利得とキャップの両方をゼロに設定します。 |
| `gravitySlewEffortPerS` | 重力の努力は毎秒変化します; 1–10000。 |
| ターゲット `positionQ8` | エンコーダ位置は、256; −32767×256を32767×256に乗じます。 |
| `gravityEffort` | 署名されたPWMの取り組み; −1000から1000.ファームウェアはその努力の制限を適用します。 |

トラベルリミットは、保存されたレガシーポジションリミットに由来する。ファームウェアキャップはアクティブなリミットを目標とする。コンフィギュレーションはRAM状態であり、永続的なチューニングプロファイルではない。ローカルベロシティフィードフォワードは、ファームウェアモーション参照に従っている。アプリケーションは、個別に重力補償を提供する。

拡張対象IDは 1–253セッションは 1–65535各モーターは目標シーケンスと重力シーケンスを別々に追跡し、新しいコマンドごとに対応するシーケンスをラップする 65535 です 0; フォワードギャップまで 32767 新しいセッションを開始します 1放送完了とは、パケットが送信されたことを意味し、すべてのモーターが受信したわけではない。 `acceptedSequence`, `gravitySequence` そして `session` その後のフィードバックで

<a id="feedback-and-errors"></a>
### フィードバックとエラー

`feedback()` 測定します position/velocity で Q8 単位、適用された努力、電流 ADC デルタ、生電圧、検証された温度、故障、セッションおよび受け入れられたシーケンスを使用します。 `fresh`, `ageMs`, `sampleSequence`, `armed`, `driveEnabled` そして `outputReady` 試料が使用可能かどうかを判断します。 `temperatureValid` 本当です `running: false` プランナーが移動しなくなったことを意味します。ゼロ位置誤差を保証するものではありません。

`tuning()`は、参照position/velocity、要求された努力、P/D/I用語、重力努力、速度フィードフォワードとオーバーラン数を追加します。

読み書きオプションは含まれます。 `timeoutMs` そして `rejectOnAlarm`レガシーアラームは、デフォルトで有効な返信を拒否しません。 `rejectOnAlarm: true` アラームが動作を中止するときに、型付きエラーがあります。 `RequestTimeoutError`, `MissingResponseError`, `ServoStatusError`, `SettingsVerificationError` そして `InvalidPacketError`追加のコンテキストは、 `error.details`; 拡張拒否を含む `extensionStatus` そこだ

スケジューラはリクエストをシリアライズし、優先度と排他的トランザクションをサポートする。コマンドを待機し、協調動作のためにグループターゲットを使用する。応答タイムアウトは、シリアル書き込み後に始まる。転送操作には独自の期限がある。これらのタイムアウトは、モーターの動作を変更しない。レガシーパケットにシーケンス番号がないため、異常に遅い応答が、同じレスポンス形状の後のリクエストと区別できない。

Low-level 輸出は `SerialTransport`, `StsProtocol`, `RequestScheduler`, `PacketEncoder`, `PacketDecoder`, `RegisterCodec`, `RegisterLayout`, `ArmCodec`定数と誤差は別々です high-level バス API.

<a id="runnable-examples"></a>
## 実行可能な例

このディレクトリから、またはインストールされているパッケージに含まれているサンプルファイルを使用します。

```sh
node examples/discover.js /dev/cu.usbmodemYOUR_ADAPTER
node examples/v9-feedback.js /dev/cu.usbmodemYOUR_ADAPTER 2
node examples/v9-move.js /dev/cu.usbmodemYOUR_ADAPTER 2 2048 100 /path/to/config.json
```

最初の二つの例は読み取りだけを行います。モーションの例には、上記のフィールドを含む JSON 設定が必要で、通信速度は 1 Mbaud です。固定した無負荷のモーターを、動ける範囲を確保して使用してください。移動完了後、エラー時、または通常の Ctrl+C 終了時にトルクを無効にします。起動には最大 3 秒、移動には最大 30 秒待機します。省略可能な最後の引数は、符号付きの重力補償出力で、既定値はゼロです。アームの荷重を支える用途には使用しないでください。

<a id="tests-and-license"></a>
## テストとライセンス

リポジトリルートから:

```sh
npm run test:driver
npm run test:driver-package
npm test
```

テストではフェイクトランスポートを使用し、シリアルポートを開かない。パッケージチェックでは、npmのキャッシュされた依存関係を使用して、実際のアーカイブを一時的なプロジェクトにインストールする。 `npm ci`そして検証します CommonJS/ESM imports およびサンプルエントリポイント. パッケージを公開しない。本番環境へのインストールには、ネイティブビルドツールが必要な場合がある。 serial-port バインディングはオペレーティングシステムでは使用できません。 CPU.

[MIT](../../../../../host/servo-driver/LICENSE)著作権 2026 STS32XX-Firmware このライセンスは、サンプルやテストなど、このドライバディレクトリをカバーしている。リポジトリ内の他の場所にファームウェアやベンダーコードを再ライセンスすることはない。依存関係は、独自のライセンスを保持する。
<!-- /translated-content -->
