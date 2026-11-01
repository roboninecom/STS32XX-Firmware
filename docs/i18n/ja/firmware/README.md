<!-- translation-navigation -->
[English](../../en/firmware/README.md) · [Русский](../../ru/firmware/README.md) · [Español](../../es/firmware/README.md) · [Français](../../fr/firmware/README.md) · [Deutsch](../../de/firmware/README.md) · [Português (Brasil)](../../pt-BR/firmware/README.md) · [简体中文](../../zh-CN/firmware/README.md) · [日本語](README.md) · [हिन्दी](../../hi/firmware/README.md) · [العربية](../../ar/firmware/README.md)

[英語原文](../../../../firmware/README.md)

> 全文の機械翻訳です。母語話者による校閲は未実施です。画像と動画は各言語で共用し、その中の文字は原文のままです。
<!-- /translation-navigation -->

<!-- translated-content -->
<a id="firmware-sources"></a>
# ファームウェア

ポータブルコントロールコード、ハードウェアドライバ、テストを含むGD32F130ファームウェア拡張プロトコルは、[詳細なドキュメント](../DETAILED_DOCUMENTATION.md#extension-protocol).comに文書化されています。

| ディレクトリ | 内容 |
| --- | --- |
| `app/` | メインループとコンポーネント間の調整 |
| `core/` | 制御、センシング、プロトコル、レジスタ、ストレージ |
| `include/` | 共有C宣言とデータ型 |
| `platform/gd32f130/` | ハードウェアドライバ、起動コード、リンカスクリプト、ベンダヘッダー |
| [`tests/`](tests/README.md) | C回帰テスト、Pythonチェック、必須フィクスチャ |

<a id="build-and-verify"></a>
## ビルドと検証

リポジトリルートから:

```sh
make
make verify
```

インストール `arm-none-eabi-gcc`ホスト C コンパイラ address/undefined-behavior サニタイザーズ Python 3 外にあるツールチェーンを PATH:

```sh
make verify ARM_PREFIX=/path/to/toolchain/bin/arm-none-eabi-
```

ルートMakefileはこのディレクトリに委譲します。 `make -C firmware` そして `make -C firmware verify` 両方とも ファームウェアイメージを `build/motor-release/` ネイティブのテスト実行可能ファイル `build/host/` リポジトリルートに格納します。 `make clean` 生成したものを `build/` ディレクトリ

これらのコマンドはハードウェアをフラッシュしません。 [フラッシュツール](../tools/flash/README.md) と publisher-supplied ホストライブラリと command-line 道具は [`host/`](../host/servo-driver/README.md) そして [`tools/`](../tools/README.md).
<!-- /translated-content -->
