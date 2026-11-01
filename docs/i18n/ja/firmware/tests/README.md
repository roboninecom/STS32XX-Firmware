<!-- translation-navigation -->
[English](../../../en/firmware/tests/README.md) · [Русский](../../../ru/firmware/tests/README.md) · [Español](../../../es/firmware/tests/README.md) · [Français](../../../fr/firmware/tests/README.md) · [Deutsch](../../../de/firmware/tests/README.md) · [Português (Brasil)](../../../pt-BR/firmware/tests/README.md) · [简体中文](../../../zh-CN/firmware/tests/README.md) · [日本語](README.md) · [हिन्दी](../../../hi/firmware/tests/README.md) · [العربية](../../../ar/firmware/tests/README.md)

[英語原文](../../../../../firmware/tests/README.md)

> 全文の機械翻訳です。母語話者による校閲は未実施です。画像と動画は各言語で共用し、その中の文字は原文のままです。
<!-- /translation-navigation -->

<!-- translated-content -->
<a id="firmware-tests"></a>
# ファームウェアテスト

走る `make verify` リポジトリルートからインストールします。 [ファームウェアツールチェーン](../README.md#build-and-verify)ファームウェアを構築し、Cテストをサニタイズし、 register/storage コントラクトチェック、モジュール境界チェック、画像レイアウト検証はハードウェアに接続しません。

`fixtures/`は必要な回帰入力を含んでいる。これらをテストに持ち込み、`support/`はシミュレーションハードウェアインターフェイスとストレージフィクスチャを提供する。

ご覧あれ [プロジェクトチェック](../../tools/README.md#offline-checks) ホスト、書き込みテスト、視聴者テスト、そして [ハードウェアの比較スイート](../../tools/hw-diff-tests/README.md) です factory/custom 専用のベンチで行動チェックを
<!-- /translated-content -->
