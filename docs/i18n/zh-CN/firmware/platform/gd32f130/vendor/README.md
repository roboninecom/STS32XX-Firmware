<!-- translation-navigation -->
[English](../../../../../en/firmware/platform/gd32f130/vendor/README.md) · [Русский](../../../../../ru/firmware/platform/gd32f130/vendor/README.md) · [Español](../../../../../es/firmware/platform/gd32f130/vendor/README.md) · [Français](../../../../../fr/firmware/platform/gd32f130/vendor/README.md) · [Deutsch](../../../../../de/firmware/platform/gd32f130/vendor/README.md) · [Português (Brasil)](../../../../../pt-BR/firmware/platform/gd32f130/vendor/README.md) · [简体中文](README.md) · [日本語](../../../../../ja/firmware/platform/gd32f130/vendor/README.md) · [हिन्दी](../../../../../hi/firmware/platform/gd32f130/vendor/README.md) · [العربية](../../../../../ar/firmware/platform/gd32f130/vendor/README.md)

[英文原文](../../../../../../../firmware/platform/gd32f130/vendor/README.md)

> 完整机器翻译，尚未经母语人士审校。所有语言共用图片和视频，其中的文字保留原文。
<!-- /translation-navigation -->

<!-- translated-content -->
<a id="pinned-gd32f1x0-declarations"></a>
# 固定的 GD32F1x0 声明

来源：社区`sts3215-firmware/firmware/lib`，存储库修订版`24ba15ba80bfe8213684c6bb4523a7d7ee079998`。 GD32 device/SPL 标头标识 GigaDevice V3.3.0 (2020-09-21)。 CMSIS核心标头标识ARMV3.30。 `SHA256SUMS` 记录每个复制的标头的确切字节。不包含供应商 C 实现或系统启动源代码。

依赖闭包包含 18 标头：5 CMSIS 和 13 SPL。设备头包括`gd32f1x0_libopt.h`；该本地聚合器引用每个外设标头。除聚合器外，所有选定的 vendor/CMSIS 标头均包含其自己的上游版权、再分发条件和免责声明。聚合器没有嵌入通知；源存储库的 MIT 许可证包含为 `COMMUNITY_LICENSE`。上游通知在每个文件中保持不变，并且必须随附源代码和二进制发行版。运送二进制文件时，请包含此目录或在分发材料中复制这些通知。

只有目标构建才会添加这些包含路径。 `mcu.h` 选择`GD32F130_150`。任何应用程序、核心或公共接口都不应包含此设备标头。作为 declaration-only 迁移的一部分，请勿使用供应商实现代码替换项目的时钟启动、矢量布局或链接器契约。
<!-- /translated-content -->
