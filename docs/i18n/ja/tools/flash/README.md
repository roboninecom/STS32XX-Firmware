<!-- translation-navigation -->
[English](../../../en/tools/flash/README.md) · [Русский](../../../ru/tools/flash/README.md) · [Español](../../../es/tools/flash/README.md) · [Français](../../../fr/tools/flash/README.md) · [Deutsch](../../../de/tools/flash/README.md) · [Português (Brasil)](../../../pt-BR/tools/flash/README.md) · [简体中文](../../../zh-CN/tools/flash/README.md) · [日本語](README.md) · [हिन्दी](../../../hi/tools/flash/README.md) · [العربية](../../../ar/tools/flash/README.md)

[英語原文](../../../../../tools/flash/README.md)

> 全文の機械翻訳です。母語話者による校閲は未実施です。画像と動画は各言語で共用し、その中の文字は原文のままです。
<!-- /translation-navigation -->

<!-- translated-content -->
<a id="flash-firmware"></a>
# Flashファームウェア

互換性のあるカスタムまたはファクトリファームウェアをフラッシュします。 **GD32F130 STS TTL サーボ**リリースマニフェストでは、アプリケーションチェックが選択されている。

**警告:ファームウェアを書き込みさせることで、サーボを損傷したり、キャリブレーションを消したり、使用できなくなることがあります。**

パブリッシャーのファームウェアイメージを使用し、同じフォルダに保存されている`release.json`と一致する。生ファームウェアビルドはサポートされていない。書き込みする前に、リリースのハードウェア互換性を確認する。

<a id="install"></a>
## インストール

リポジトリルートから **Python 3.10 または newer** を実行する必要があります。

```sh
python3 -m venv tools/flash/.venv
source tools/flash/.venv/bin/activate
python -m pip install -r tools/flash/requirements.txt
```

Windowsでは、代わりに`tools\flash\.venv\Scripts\Activate.ps1`で有効にします。

<a id="choose-firmware"></a>
## ファームウェアを選択します。

| ファームウェア | マニフェスト |
| --- | --- |
| カスタム拡張 v9 | パブリッシャーの画像と`release.json`を一緒に`tools/flash/releases/`にダウンロードします。 |
| 工場 **SCServo21-GD32-TTL 3.10**モデル **9.3** | 束ねられた [`factory/release.json`](../../../../../tools/flash/factory/release.json)画像と一緒に。 |

ファクトリイメージは、ハードウェアにマッチするのみであり、選択したマニフェストを`inspect`、`flash`、`recover`で使用します。

<a id="prepare"></a>
## 準備

- 通常書き込みは、選択したモーターのみをリセットします。 IDユニークなIDを持つモーターは接続されている可能性がある。他のモーターが正常に動作している間、連続して書き込みさせる。 power-cycle バスや別のアップローダーを転送中に実行します。
- **Recovery**, のみ接続する意図したサーボ. Recoveryは、IDによってモーターを選択しず、ブートローダー転送は対処されません。
- 機構を確保し、安定したモーター電源を使用し、シリアルポートを使用して他のプログラムを閉じます。
- 通常の書き込みでは、トルクを無効にし、ロック設定を書き込み、通常の制御ツールを使用してアクティブなアラームをクリアします。 ID ボーレートです
- 重要なキャリブレーションと設定をバックアップし、サーボに保存された設定から開始します。

ポートを交換します。 ID デフォルトのボーレートは **1,000,000**; 追加 `--baud 500000`例えば 必要なら 典型的な港は `/dev/cu.usbmodem…` macOSでは `/dev/ttyUSB0` Linux と `COM3` Windowsで

```sh
python tools/flash/settings.py backup \
  --port /dev/cu.usbmodemYOUR_ADAPTER --id 2 \
  --file backups/servo-2-settings.json
```

この正確なサーボのためにこのバックアップを保持します. 既存のバックアップファイルは上書きされません。

<a id="flash"></a>
## Flash

ダウンロードしたカスタムリリースをチェックしてフラッシュします。

```sh
python tools/flash/flash.py inspect \
  --manifest tools/flash/releases/release.json

python tools/flash/flash.py flash \
  --manifest tools/flash/releases/release.json \
  --port /dev/cu.usbmodemYOUR_ADAPTER --id 2
```

バンドルされたファクトリファームウェアをインストールするには、代わりにマニフェストを選択し、この操作用のサーボを分離します:ファクトリスタートアップは、バス上の別のモーターと競合して、IDを1に変更することができます。

```sh
python tools/flash/flash.py flash \
  --manifest tools/flash/factory/release.json \
  --port /dev/cu.usbmodemYOUR_ADAPTER --id 2
```

`inspect` サーボに接続せずにファイルサイズ、チェックサム、マニフェストを確認します。 `FLASH` コマンドが終了するまで電源を接続しておきます。このツールはサーボをチェックし、設定スナップショットを保存し、ファームウェアをアップロードし、アプリケーションをチェックし、設定を比較します。成功した検証ではトルクが無効になります。

工場出荷後、ツールが以前確認します。 ID/baudそれなら ID **1** で **1,000,000** baud 必要に応じて接続を出力します。 **2** は、工場内のファームウェアが応答したが、設定が変更されたことを意味し、再度書き込みするのではなく、以下の設定の修復を続行します。

<a id="recover-an-unresponsive-servo"></a>
## 応答しないサーボを復元します。

最初に電源、配線、ID、ボーレートを確認します。回復が必要な場合は、***のみを接続します*** 選択したマニフェストを使用してください。

```sh
python tools/flash/flash.py recover \
  --manifest tools/flash/factory/release.json \
  --port /dev/cu.usbmodemYOUR_ADAPTER --id 1
```

確認後、**power-cycle プロンプト**、接続されている USB アダプターを残し、ツールはブートローダーの 60 秒まで待ちます。

リカバリー後に期待されるIDとボーレートを使用し、リカバリーはアップロード前に現在のモデルを確認したり、設定をバックアップしたりすることはできません。

<a id="restore-factory-settings"></a>
## 工場設定を復元します。

ファクトリファームウェアに戻ったら、このサーボのバックアップを復元します。設定が最初に正しく見えても.Factoryファームウェアは、保存された設定が無効なときにbuilt-inデフォルトを使用します。

ご利用ください。 **現在のところ** ID/baud 例えば 書き込み後に印刷すると ID 1:

```sh
python tools/flash/settings.py restore \
  --port /dev/cu.usbmodemYOUR_ADAPTER --id 1 \
  --file backups/servo-2-settings.json
```

タイプ `RESTORE` 工場を支えています **3.10** 検出されたカスタムファームウェアを拒否します **保存したリセットテンプレートを置き換えます。**保存した設定を修復し、サーボを書き込み、再起動します。 ID/baud モーションコマンドを送信せずに、読み込みを変更し、検証します。

次に、**power-cycle サーボ**と**復元** ID/baudを使用して検証します。

```sh
python tools/flash/settings.py verify \
  --port /dev/cu.usbmodemYOUR_ADAPTER --id 2 \
  --file backups/servo-2-settings.json
```

検証が完了するまでトルクをオフにしてください。before-flashスナップショットを含む通常のフラッシュ`report.json`を`--file`として供給することもできます。設定が失われた後にバックアップしても元のキャリブレーションを回復することはできません。有効なバックアップがなければ、正確なモデルの設定を取得し、このサーボを再調整します。

故障時には、修復は設定をリロックしようとしますが、部分的な書き込みを解除したり、修復を自動的に再試行したりしません。

<a id="results-and-options"></a>
## 結果とオプション

Flashレポートは`backups/flash/`で保存される。`backups/settings/`で設定レポート。両方とも利用可能な設定スナップショットを含んでいる。アップロードに成功した場合、アプリケーションチェックが含まれる。フルファームウェアイメージを読み返さない。設定は自動的に復元されない。

- `--output DIRECTORY`:レポートが保存されている場所を選択します。
- `--yes`:確認プロンプトをスキップします。
- `--help`: コマンドオプションを表示します。

ファイル検証に失敗した場合は、一致するリリースペアを取得してください。書き込みが中断した場合は、サーボが回復する必要がある場合があります。転送が完了しても検証が失敗する場合は、レポートを確認し、再試行する前にID、ボーレート、設定を確認してください。

リリース著者にとって [リリース。 例。 ジョンソン](../../../../../tools/flash/release.example.json) カスタムマニフェストと [factory/release.json](../../../../../tools/flash/factory/release.json) ファクトリマニフェスト. カスタム例は、使用可能なファームウェアリリースではない。

<a id="acknowledgments"></a>
## 謝辞

書き込み・復旧ツールは [0o8o0-blip/sts3215-firmware](https://github.com/0o8o0-blip/sts3215-firmware/) を参考にしています。
<!-- /translated-content -->
