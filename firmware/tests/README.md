# Firmware tests

Run `make verify` from the repository root after installing the
[firmware toolchain](../README.md#build-and-verify). It builds the firmware and
runs sanitized C tests, register/storage contract checks, module boundary checks
and image layout verification. It does not connect to hardware.

`fixtures/` contains required regression inputs. Keep these with the tests.
`support/` supplies simulated hardware interfaces and storage fixtures.

See [project checks](../../tools/README.md#offline-checks) for host, flashing and
viewer tests, and the [hardware comparison suite](../../tools/hw-diff-tests/README.md)
for factory/custom behaviour checks on a dedicated bench.
