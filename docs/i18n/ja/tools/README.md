<!-- translation-navigation -->
[English](../../en/tools/README.md) · [Русский](../../ru/tools/README.md) · [Español](../../es/tools/README.md) · [Français](../../fr/tools/README.md) · [Deutsch](../../de/tools/README.md) · [Português (Brasil)](../../pt-BR/tools/README.md) · [简体中文](../../zh-CN/tools/README.md) · [日本語](README.md) · [हिन्दी](../../hi/tools/README.md) · [العربية](../../ar/tools/README.md)

[英語原文](../../../../tools/README.md)

> 全文の機械翻訳です。母語話者による校閲は未実施です。画像と動画は各言語で共用し、その中の文字は原文のままです。
<!-- /translation-navigation -->

<!-- translated-content -->
<a id="tools"></a>
# ツール

作業用のユーティリティ STS 各ガイドには、セットアップ手順、コマンド、ハードウェア要件が含まれており、アプリケーション開発には以下を使用してください。 [Node.jsサーボドライバ](../host/servo-driver/README.md)このリポジトリから構築されたスタンドアロンのnpmパッケージとして利用可能で、リプレイとテレオペレーションを共有する [アームコントローラと重力モデルは](../host/arm-control/README.md).

新しいメカニズムのために: [オフセットとリミットを校正する](settings/README.md#choose-the-reference-pose)既存のポーズと重力モデルを再利用する際には、検証済みのキャリブレーションを維持してください。

| ツール | 目的 |
| --- | --- |
| [自動チューニング](tuning/README.md) | 繰り返し動作と長い検証ホールドで、境界付けられた設定のバッチを比較します。 |
| [テレメトリビューア](simulation/README.md) | ライブテレメトリを表示し、バンドルされたSO-101とSO-102モデルで記録を再生します。 |
| [遠隔操作 ](teleoperation/README.md) | hand-operatedリーダーからフォロワーを制御します。 |
| [レコーディングとリプレイ](poses/README.md) | 名前付きポーズを記録;レガシーまたは拡張設定で再生するか、記録された遠隔操作セッションを再生します。 |
| [](settings/README.md) の発見、校正、設定 | モーターを見つけ、ジョイントオフセットとリミットをキャリブレーションし、永続的な設定をバックアップまたは復元します。 |
| [ハードウェアの比較テスト](hw-diff-tests/README.md) | 専用のサーボベンチで工場およびカスタムファームウェアの動作を比較します。 |
| [バスベンチマークとテレメトリの](diagnostics/README.md) | 通信遅延を計測し、異常値の定常的な読み取りを確認します。 |
| [ファームウェアの書き込みと回復](flash/README.md) | カスタムまたはバンドルされたファクトリファームウェアをフラッシュし、中断したアップロードを回復し、ファクトリ設定を修復します。 |

Node.jsツールはNode.jsを必要とする 20 書き込みと設定の回復には Python が必要です 3.10 シミュレーションはPythonを使い 3.12レポジトリルートからコマンドを実行し、ハードウェアを接続する前に関連するガイドに従ってください。比較テストはモーターを移動したり、設定を上書きしたり、書き込みするとサーボが損傷します。

<a id="offline-checks"></a>
## オフラインチェック

リポジトリルートから実行し、Node依存関係と各Pythonツールの要件を最初にインストールする。これらのコマンドのうち、シリアルポートを開いたり、ハードウェアを移動したりするコマンドはない。

| コマンド | 取材 |
| --- | --- |
| `make verify` | ファームウェアビルドやC回帰テスト register/storage 契約と画像レイアウトを参照してください。 [ツールチェーン](../firmware/README.md). |
| `npm test` | ドライバ、共有コントローラ、すべてのNode.jsツール。 |
| `npm run test:driver-package` | キャッシュされた npm 依存関係を使用して、ドライバパッケージングと分離インストール。 |
| `make flash-verify PYTHON=tools/flash/.venv/bin/python` | シミュレーションされたシリアルデバイスでフラッシュと工場設定の復旧。 |
| `PYTHONPATH=tools/simulation tools/simulation/.venv/bin/python -m unittest discover -s tools/simulation/test` | モデル、読者と視聴者の行動を記録する。 |

ハードウェアの比較 [専用のベンチスイート](hw-diff-tests/README.md)設定やテンプレートのリセットが可能です。 [診断](diagnostics/README.md) 組み立てられたメカニズム上の通信と定常テレメトリのために。
<!-- /translated-content -->
