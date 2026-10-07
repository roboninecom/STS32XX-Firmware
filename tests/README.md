# Verification

Run `make verify` from the repository root. It builds the selected target
profile, runs sanitized C regressions, and checks the register contract,
storage fixture, module boundaries, profile manifest, and image layout.

`fixtures/` contains required, pinned regression inputs. The synthetic plant
tests cover controller regressions; they do not qualify a physical arm.

`hardware/` contains stationary telemetry, bus/stack timing, and read-only
storage diagnostics. These tools require explicit device selection and, for
timing or flash dumps, the corresponding diagnostic firmware profile.
They are not invoked by offline verification.
