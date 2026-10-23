# Bus benchmark and telemetry diagnostics

Two command-line tools for STS servos: measure communication performance and
check stationary telemetry for unusual readings. Requires Node.js 20 or newer.
From the repository root, install dependencies with `npm install`.

Keep the motors stationary with torque off and settings locked. Stop other
programs using the serial port. Both tools check the selected servos before and
after a run. Neither enables torque, moves a motor, flashes firmware, or saves
settings.

## Bus benchmark

```sh
npm run bus-benchmark -- --port /dev/cu.usbmodemXXXX --ids 1,2 --repetitions 1000
```

By default, measures PING and READ requests of different sizes. Each case runs
20 warmup attempts, then 1,000 measured attempts per motor. Motor order rotates
between rounds. Failed attempts remain failures; retries never replace them.

Useful options:

- `--list`: list cases without opening a port.
- `--cases ping,read-table-87`: run selected cases.
- `--warmup 20`, `--repetitions 1000`: attempts per case and motor.
- `--gap-ms 1`: pause between requests; default is no added pause.
- `--results DIR`: output parent; default is `tools/diagnostics/results`.
- `--include-writes`: also benchmark acknowledged writes to RAM registers 51–54.
  These registers are undocumented on other firmware; use this option only on
  a verified compatible servo. Original values are restored on completion,
  failure or graceful interruption. Write acknowledgments must be enabled.

Each run creates a new directory containing `summary.csv`, `report.json` and
`samples.jsonl`. The summary includes median, p95, p99 and maximum latency,
plus timeout and error counts. Raw records include warmup and cleanup exchanges.

Latency runs from the serial write call to a matching decoded reply. It includes
USB and operating-system delays; it is not firmware-only response time or a
measurement of maximum bus capacity. Timeouts are counted separately, not
included in latency percentiles.

## Telemetry

```sh
npm run telemetry -- --port /dev/cu.usbmodemXXXX --ids 1,2 \
  --samples 1000 --interval-ms 20 --output tools/diagnostics/results/telemetry-check
```

Reads 17 bytes starting at register 56, once per motor per round. The default is
100,000 samples per motor with no added pause. Use a new output directory for
each run; existing sample files are never overwritten.

- `--interval-ms 20`: minimum interval between round starts. Missed slots are
  skipped and counted in `missedDeadlines`; delayed rounds do not cause bursts.
- `--gap-ms 1`: instead, pause after each motor request. Cannot be combined with
  `--interval-ms`.
- `--voltage-min 5.5 --voltage-max 8.4`: expected voltage range in volts;
  defaults to 8–16 V. Set this for the connected motors and power supply.

Outputs: `samples.csv` contains every attempt, `anomalies.jsonl` contains flagged
readings and raw exchanges, and `report.json` contains counts, ranges, timing
statistics and before/after settings. CSV voltage is in tenths of a volt;
position, speed, current and effort retain their raw register units.

Checks flag voltage and temperature changes, implausible readings, nonzero
status and effort while torque is off. Temperature spike detection requires
three consecutive valid replies; a missing or invalid reply breaks the sequence.
These flags identify readings to inspect, not proof of a firmware or sensor
fault. Identical stationary readings are normal and do not prove stale data.

## Common options and tests

Both tools accept `--baud 1000000`, `--timeout-ms 100` and `--help`. IDs default
to `1,2`; specify the motors actually connected. The reply timeout begins after
the serial write drains. After a timeout, the tools wait for a quiet bus before
continuing because replies contain no sequence numbers.

Ctrl+C stops the run and performs cleanup. Errors, incomplete runs and flagged
samples produce a nonzero exit code. Results under `results/` are ignored by Git.

```sh
npm run test:diagnostics
```

These offline tests do not connect to hardware.
