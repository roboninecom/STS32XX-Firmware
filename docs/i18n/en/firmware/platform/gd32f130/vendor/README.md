<!-- translation-navigation -->
[English](README.md) · [Русский](../../../../../ru/firmware/platform/gd32f130/vendor/README.md) · [Español](../../../../../es/firmware/platform/gd32f130/vendor/README.md) · [Français](../../../../../fr/firmware/platform/gd32f130/vendor/README.md) · [Deutsch](../../../../../de/firmware/platform/gd32f130/vendor/README.md) · [Português (Brasil)](../../../../../pt-BR/firmware/platform/gd32f130/vendor/README.md) · [简体中文](../../../../../zh-CN/firmware/platform/gd32f130/vendor/README.md) · [日本語](../../../../../ja/firmware/platform/gd32f130/vendor/README.md) · [हिन्दी](../../../../../hi/firmware/platform/gd32f130/vendor/README.md) · [العربية](../../../../../ar/firmware/platform/gd32f130/vendor/README.md)

[English original](../../../../../../../firmware/platform/gd32f130/vendor/README.md)

> English source copy. Images and videos are shared across languages.
<!-- /translation-navigation -->

<!-- translated-content -->
<a id="pinned-gd32f1x0-declarations"></a>
# Pinned GD32F1x0 declarations

Source: community `sts3215-firmware/firmware/lib` at repository revision `24ba15ba80bfe8213684c6bb4523a7d7ee079998`. The GD32 device/SPL headers identify GigaDevice V3.3.0 (2020-09-21). The CMSIS core header identifies ARM V3.30. `SHA256SUMS` records every copied header's exact bytes. No vendor C implementation or system startup source is included.

The dependency closure contains 18 headers: 5 CMSIS and 13 SPL. The device header includes `gd32f1x0_libopt.h`; that local aggregator references every peripheral header. All selected vendor/CMSIS headers except the aggregator contain their own upstream copyright, redistribution conditions and disclaimer. The aggregator has no embedded notice; the source repository's MIT license is included as `COMMUNITY_LICENSE`. The upstream notices remain unmodified in each file and must accompany source and binary distributions. Include this directory or reproduce those notices in distribution materials when shipping a binary.

Only target builds add these include paths. `mcu.h` selects `GD32F130_150`. No application, core or public interface should include this device header. Do not replace the project's clock startup, vector layout or linker contract with vendor implementation code as part of a declaration-only migration.
<!-- /translated-content -->
