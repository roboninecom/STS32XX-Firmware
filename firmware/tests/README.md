# Firmware tests

<!-- documentation-languages -->
[English](../../docs/i18n/en/firmware/tests/README.md) · [Русский](../../docs/i18n/ru/firmware/tests/README.md) · [Español](../../docs/i18n/es/firmware/tests/README.md) · [Français](../../docs/i18n/fr/firmware/tests/README.md) · [Deutsch](../../docs/i18n/de/firmware/tests/README.md) · [Português (Brasil)](../../docs/i18n/pt-BR/firmware/tests/README.md) · [简体中文](../../docs/i18n/zh-CN/firmware/tests/README.md) · [日本語](../../docs/i18n/ja/firmware/tests/README.md) · [हिन्दी](../../docs/i18n/hi/firmware/tests/README.md) · [العربية](../../docs/i18n/ar/firmware/tests/README.md)
<!-- /documentation-languages -->

Run `make verify` from the repository root after installing the
[firmware toolchain](../README.md#build-and-verify). It builds the firmware and
runs sanitized C tests, register/storage contract checks, module boundary checks
and image layout verification. It does not connect to hardware.

`fixtures/` contains required regression inputs. Keep these with the tests.
`support/` supplies simulated hardware interfaces and storage fixtures.

See [project checks](../../tools/README.md#offline-checks) for host, flashing and
viewer tests, and the [hardware comparison suite](../../tools/hw-diff-tests/README.md)
for factory/custom behaviour checks on a dedicated bench.
