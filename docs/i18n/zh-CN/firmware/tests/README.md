<!-- translation-navigation -->
[English](../../../en/firmware/tests/README.md) · [Русский](../../../ru/firmware/tests/README.md) · [Español](../../../es/firmware/tests/README.md) · [Français](../../../fr/firmware/tests/README.md) · [Deutsch](../../../de/firmware/tests/README.md) · [Português (Brasil)](../../../pt-BR/firmware/tests/README.md) · [简体中文](README.md) · [日本語](../../../ja/firmware/tests/README.md) · [हिन्दी](../../../hi/firmware/tests/README.md) · [العربية](../../../ar/firmware/tests/README.md)

[英文原文](../../../../../firmware/tests/README.md)

> 完整机器翻译，尚未经母语人士审校。所有语言共用图片和视频，其中的文字保留原文。
<!-- /translation-navigation -->

<!-- translated-content -->
<a id="firmware-tests"></a>
# 固件测试

安装[固件工具链](../README.md#build-and-verify)后，从存储库根运行`make verify`。它构建固件并运行经过净化的 C 测试、register/storage 合同检查、模块边界检查和图像布局验证。它不连接到硬件。

`fixtures/` 包含所需的回归输入。将这些与测试一起保存。 `support/` 提供模拟硬件接口和存储装置。

请参阅[项目检查](../../tools/README.md#offline-checks)了解主机、刷写和查看器测试，以及[硬件比较套件](../../tools/hw-diff-tests/README.md)了解专用工作台上的factory/custom行为检查。
<!-- /translated-content -->
