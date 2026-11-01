# Firmware sources

<!-- documentation-languages -->
[English](../docs/i18n/en/firmware/README.md) · [Русский](../docs/i18n/ru/firmware/README.md) · [Español](../docs/i18n/es/firmware/README.md) · [Français](../docs/i18n/fr/firmware/README.md) · [Deutsch](../docs/i18n/de/firmware/README.md) · [Português (Brasil)](../docs/i18n/pt-BR/firmware/README.md) · [简体中文](../docs/i18n/zh-CN/firmware/README.md) · [日本語](../docs/i18n/ja/firmware/README.md) · [हिन्दी](../docs/i18n/hi/firmware/README.md) · [العربية](../docs/i18n/ar/firmware/README.md)
<!-- /documentation-languages -->

GD32F130 firmware, including portable control code, hardware drivers and tests.
The extension protocol is documented in the [detailed documentation](../DETAILED_DOCUMENTATION.md#extension-protocol).

| Directory | Contents |
| --- | --- |
| `app/` | Main loop and coordination between components |
| `core/` | Control, sensing, protocol, registers and storage |
| `include/` | Shared C declarations and data types |
| `platform/gd32f130/` | Hardware drivers, startup code, linker script and vendor headers |
| [`tests/`](tests/README.md) | C regression tests, Python checks and required fixtures |

## Build and verify

From the repository root:

```sh
make
make verify
```

Install `arm-none-eabi-gcc`, a host C compiler with address/undefined-behavior
sanitizers, Python 3 and Make. For a toolchain outside PATH:

```sh
make verify ARM_PREFIX=/path/to/toolchain/bin/arm-none-eabi-
```

The root Makefile delegates to this directory. `make -C firmware` and
`make -C firmware verify` also work. Both write firmware images to
`build/motor-release/` and native test executables to `build/host/` at the
repository root. `make clean` removes that generated `build/` directory.

These commands do not flash hardware. Use the [flash tool](../tools/flash/README.md)
with a publisher-supplied release. Host libraries and command-line tools remain
under [`host/`](../host/servo-driver/README.md) and [`tools/`](../tools/README.md).
