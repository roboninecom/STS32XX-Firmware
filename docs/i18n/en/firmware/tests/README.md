<!-- translation-navigation -->
[English](README.md) · [Русский](../../../ru/firmware/tests/README.md) · [Español](../../../es/firmware/tests/README.md) · [Français](../../../fr/firmware/tests/README.md) · [Deutsch](../../../de/firmware/tests/README.md) · [Português (Brasil)](../../../pt-BR/firmware/tests/README.md) · [简体中文](../../../zh-CN/firmware/tests/README.md) · [日本語](../../../ja/firmware/tests/README.md) · [हिन्दी](../../../hi/firmware/tests/README.md) · [العربية](../../../ar/firmware/tests/README.md)

[English original](../../../../../firmware/tests/README.md)

> English source copy. Images and videos are shared across languages.
<!-- /translation-navigation -->

<!-- translated-content -->
<a id="firmware-tests"></a>
# Firmware tests

Run `make verify` from the repository root after installing the [firmware toolchain](../README.md#build-and-verify). It builds the firmware and runs sanitized C tests, register/storage contract checks, module boundary checks and image layout verification. It does not connect to hardware.

`fixtures/` contains required regression inputs. Keep these with the tests. `support/` supplies simulated hardware interfaces and storage fixtures.

See [project checks](../../tools/README.md#offline-checks) for host, flashing and viewer tests, and the [hardware comparison suite](../../tools/hw-diff-tests/README.md) for factory/custom behaviour checks on a dedicated bench.
<!-- /translated-content -->
