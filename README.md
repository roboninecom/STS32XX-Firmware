# STS32XX Firmware

Firmware for GD32F130-based STS3215 servos, with factory-compatible legacy
registers and an explicitly selected arm controller. The portable C11 core uses
bounded static memory and keeps hardware access in `platform/gd32f130/`.

## Build and verify

Install an Arm GNU bare-metal toolchain providing `arm-none-eabi-gcc`, a host C
compiler with address/undefined-behavior sanitizers, Python 3, and Make.

```sh
make
make verify
```

For a toolchain outside PATH, set `ARM_PREFIX` to its full executable prefix:

```sh
make verify ARM_PREFIX=/path/to/toolchain/bin/arm-none-eabi-
```

The default build is motion-capable. Optional profiles are `MOTOR_TEST=1`,
`FLASH_DUMP=1`, and `TIMING_PROBE=1`. Images and manifests are generated under
`build/`, which is excluded from Git. Verification builds and tests offline;
it does not flash a servo or open a serial port.

## Layout

- `core/`: portable control, sensing, protocol, register mapping, and storage.
- `include/`: public portable contracts.
- `app/`: firmware runtime and service ownership.
- `platform/gd32f130/`: target drivers, startup, linker, and pinned vendor headers.
- `tests/`: regression tests, required fixtures, and selected hardware diagnostics.

Registers 0–86 preserve the legacy wire contract. Arm control requires explicit
selection and a session with supplied limits and gains. Offline regressions do
not establish loaded hardware behavior. Vendor redistribution notices are
retained in the headers and [vendor README](platform/gd32f130/vendor/README.md).
