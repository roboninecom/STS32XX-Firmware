# Firmware sources

GD32F130 firmware, including portable control code, hardware drivers and tests.
The extension protocol is documented in the [project README](../README.md).

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
