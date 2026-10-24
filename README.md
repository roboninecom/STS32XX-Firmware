# STS32XX Firmware

Firmware for GD32F130-based STS3215 servos, with two ways to control the motor:

- **Legacy mode** uses the standard STS commands for position, speed, and motor
  power. It is enabled by default.
- **Extension mode** adds smooth motion, adjustable position control, and
  compensation for motion and gravity. The connected computer sends settings and
  destinations; each servo calculates its movement locally.

This README explains how the features work, then provides the command and
register reference for **extension protocol v9.0**. Extension settings are kept
in temporary memory and must be sent again after a reset or power cycle.
Controlling software must support version 9; older extension clients are not
compatible.

- [Legacy mode](#legacy-mode)
- [How extension mode works](#how-extension-mode-works)
- [S-curve motion](#s-curve-motion)
- [PID controller](#pid-controller)
- [Velocity feedforward](#velocity-feedforward)
- [Gravity compensation](#gravity-compensation)
- [Starting and stopping extension mode](#starting-and-stopping-extension-mode)
- [Extension protocol](#extension-protocol)
- [Extension registers](#extension-registers)
- [Build and verification](#build-and-verification)
- [Repository layout](#repository-layout)
- [Current limits](#current-limits)

## Legacy mode

Legacy mode supports the standard STS register interface, including motor power,
operating mode, position and speed commands, and status readings. Existing STS
software can use registers **0–86** without enabling the extension.

In legacy position modes, enabling motor power without a new position command
holds the measured position, even outside the saved limits. It does not replay
an old target or move the shaft to the nearest limit. New position commands
are still capped to the saved limits.

The extension uses its own motion and control settings. Gain values should not
be copied directly between the two modes because their scales differ. Support
for the standard commands does not guarantee identical physical behavior across
all servo models.

## How extension mode works

The **host** is the computer or controller connected to the servos. It sends a
**target**: a destination and speed limit. Acceleration and compensation settings
are configured before enabling motor power. Each servo then:

1. Plans a smooth movement toward the destination.
2. Measures its position and estimates its speed.
3. Adjusts motor output to follow the planned movement.
4. Holds the destination when the movement finishes.

The planned position and speed at any moment are called the **reference**. The
controller compares them with the measured movement, so a reference position and
an actual position can differ.

A few terms used throughout this document:

| Term | Meaning |
| --- | --- |
| Encoder count | A position measurement unit; nominally 4096 counts per revolution |
| Effort | The signed motor-output command: its sign sets direction and its size sets output strength |
| Gain | A setting that determines how strongly the controller responds |
| Feedforward | Extra motor output calculated from expected demand, rather than waiting for a position or speed error |
| Feedback | Measurements and status returned by the servo |
| Register | A setting or reading identified by a number |
| Session | One period of extension control, identified by a number supplied by the host |

Effort is expressed in PWM units, the units used to control electrical output to
the motor. The extension allows an output limit up to **1000** in either
direction. These values are not direct measurements of torque or current.

## S-curve motion

An S-curve makes acceleration increase and decrease gradually. Instead of
suddenly applying full acceleration or braking, the servo eases into and out of
each part of the movement. This can reduce mechanical jolts and vibration.

A full movement from rest to rest has these stages:

| Stage | What happens |
| --- | --- |
| 1 | Acceleration gradually increases |
| 2 | The servo accelerates at a steady rate |
| 3 | Acceleration gradually decreases to zero |
| 4 | The servo moves at a steady speed |
| 5 | Braking gradually increases |
| 6 | The servo brakes at a steady rate |
| 7 | Braking gradually decreases as the servo stops |

Short moves skip stages when there is not enough distance to reach the requested
speed or acceleration. The same acceleration limit applies when speeding up and
slowing down.

The `ramp_time_ms` setting controls how long acceleration takes to rise from zero
to its limit. A longer ramp gives a gentler change, but generally needs more time
and distance to accelerate or stop.

**Jerk** means the rate at which acceleration changes. This planner limits jerk,
so acceleration changes smoothly. Jerk itself can still change abruptly between
stages. Its approximate magnitude is:

```text
jerk = 1000 × acceleration / ramp_time_ms    [counts/s³]
```

### Changing a destination during movement

A new target continues from the current planned movement, preserving its position,
speed, and acceleration. Sending the same destination again does not restart the
move. Keep the same requested speed limit while moving; it can change for the
next move once the planned movement has stopped. Acceleration and ramp time
belong to configuration and require motor power off and a disarmed session to change.

A destination outside the saved legacy position limits is **adjusted to the
nearest limit**. Requested speed is also capped at its configured limit. The servo uses
the configured acceleration for every move. Zero speed or configured acceleration
is invalid.

The whole planned movement must stay inside the position limits. A new target
can therefore be rejected if the servo is already approaching a limit too fast
to stop within it, even when the destination itself is allowed.

On arrival, the servo automatically holds the destination with motor power on.
The measured position may still have some error due to friction, load, output
limits, or tuning. Holding continues to correct position error; it does not
freeze the motor output at a fixed value.

Each servo plans its own movement. Sending several targets together does not
guarantee that all servos will arrive at the same time.

### Shared position limits

Legacy and extension control use the same position-limit registers: **9–10**
contain the minimum and **11–12** the maximum. Each is an unsigned 16-bit value
in corrected encoder counts, including the servo's configured direction and
position correction. There are no separate extension position-limit settings.

The firmware reads these registers when starting control. With limits enabled,
the minimum must be below the maximum, the maximum must be at most 32767, and the measured
position must be inside the range. Otherwise startup fails without moving the
motor. The planner keeps the complete movement, including braking, within the
range it read.

**Equal minimum and maximum values disable the travel limits**, matching legacy
behavior. Extension commands still stay within their supported position range
of −32767 to 32767 counts.

An accepted write to either limit ends an active extension session and turns
motor power off, including writes that are only applied in RAM. Arm a new session
to use the changed values. Normal legacy settings persistence still applies.

## PID controller

The PID controller adjusts motor output to follow the planned movement. Its three
settings have different jobs:

| Setting | What it does | Main tradeoff |
| --- | --- | --- |
| **P — position correction** | Pulls the motor toward the planned position; larger errors produce more correction | Higher P can reduce error but can also cause oscillation |
| **I — accumulated correction** | Builds up extra correction when an error persists | Can reduce a lasting error, but may increase overshoot or settling time |
| **D — speed correction** | Responds to the difference between planned and measured speed; resists movement while holding | Can improve damping, but excessive response to noisy speed readings can make output uneven |

The calculation is:

```text
position error = planned position − measured position
speed error = planned speed − filtered measured speed

motor output = Kp × position error
             + Kd × speed error
             + accumulated I correction
             + gravity compensation
             + velocity feedforward
```

The result is limited to the configured maximum output. Motor protection can
reduce it further. Feedback reports both the requested and applied output so the
host can see when the motor is being limited.

Measured speed is smoothed using recent position readings and an adjustable
filter. A larger `velocity_filter_q8` setting responds faster to changes but
removes less measurement noise.

### Preventing excessive accumulated correction

The I contribution has its own limit. The controller also prevents it from
continuing to build in a direction where the motor output is already limited;
this is commonly called **anti-windup**. It can still decrease to help the motor
recover from that limit. Setting `Ki` to zero disables and clears I correction.

When the servo has been nearly stationary for at least 50 ms and the position
error is within one encoder count, I stops accumulating. P, D, and both forms of
feedforward remain active. Turning motor output off clears I correction.

## Velocity feedforward

Velocity feedforward supplies some of the output expected to be needed for
movement before a tracking error develops. It is calculated **inside the servo**
from the planned speed:

```text
velocity feedforward = velocity gain × planned speed
```

There is one gain for each direction and a limit on the resulting output. Both
gains are nonnegative; movement direction determines the output sign. Its output limit must be no greater than the main motor-output limit.

Because the servo knows its own planned speed, the compensation follows
acceleration and braking automatically and becomes zero when the planned motion
stops. The host only supplies its settings; it does not need to send continuous
velocity-feedforward values.

Configure this feature together with the other settings in `0xA0`, while motor
power is off and the session is disarmed. Set both gains and its output limit
to zero to disable it.

## Gravity compensation

Gravity compensation provides the output needed to support the weight of an arm
and its load. It is useful even when the motor is holding still, where velocity
feedforward is zero.

The **host calculates gravity compensation** and sends a signed output value to
each servo. The calculation can use joint angles, arm dimensions, link weights,
and payload. The host must convert the estimated load into the servo's output
units. The firmware does not contain a model of the arm.

Direction matters: positive extension output follows increasing encoder counts.
An arm's joint-angle convention may run in the opposite direction, so the host's
conversion must account for that.

Each gravity update contains the desired output value. The **slew rate**—how
quickly compensation may change, in output units per second—is part of the main
configuration and remains fixed throughout the session.

The servo gradually changes its compensation toward the requested value and
adds it to the controller output. All contributions together remain subject to
the configured output limit and motor protection.

**If gravity updates stop arriving, the servo continues toward the last requested
compensation at its configured slew rate, then keeps that value.** There is no
expiry timer. The host should update compensation when the arm pose or load
changes. Setting torque-enable register **40** to zero clears compensation and
turns motor output off.

## Starting and stopping extension mode

The following sequence uses the register numbers and commands documented later.
Selection prepares a session; enabling motor power starts control.

1. Find the connected servo IDs and read each servo's capabilities. Check for
   `ARMC` and version `9.0`. Repeat this check after a reset or firmware change.
2. Turn motor power off by setting legacy torque-enable register **40** to `0`.
   Finish any existing session and apply any permanent legacy settings.
3. Write and read back the complete configuration (`0xA0`), including velocity
   feedforward settings and the gravity slew rate.
4. Write `mode=1` and a new nonzero session number to `0xB8` (3 bytes total).
   This selects extension mode and prepares the next start; power remains off.
5. Set register **40** to `1`. The firmware checks sensors, protection status,
   configuration and saved position limits, then captures the measured position
   as the initial hold target. Command counters, I correction and gravity
   compensation start at zero. Read `0xC1` and wait for the correct session,
   current usable measurements, motor drive enabled and output ready.
6. Send targets and any gravity updates. Read feedback to check which commands
   were accepted and how closely the servo follows them.
7. The servo finishes its last move and holds the destination until given a new
   target. Set register **40** to `0` to turn motor power off and end the session.
   To return to legacy mode, keep power off and write `mode=0, session=0` to `0xB8`.

If a start fails, register **40** returns to `0`. Its normal write acknowledgement
alone does not confirm successful startup: check register readback and feedback.
Every start attempt consumes the prepared session. After a failed start,
torque-off or protection shutdown, correct the cause and write `0xB8` with a new
session number before enabling torque again. Repeating torque enable while
control is running preserves its target, compensation and command counters.

Commands that move or adjust a powered motor require ready hardware, no reported
fault, and sensor readings no more than **2 ms** old. The controller normally
updates every **1 ms** and accepts intervals up to 2 ms. Longer gaps cause motor
output to be disabled.

While using the extension, avoid legacy writes to operating mode register **33**
or motion registers **41–47**: they turn motor power off and leave extension
mode. Saving permanent settings also ends extension control. Setting register
**40** to `0` leaves extension mode selected, ready for another session setup.

### If host commands stop arriving

The servo finishes the last accepted move and keeps holding that destination.
Gravity compensation continues toward its last requested value and stays there.
No repeated messages are needed to keep the session active, and loss of host
communication does not itself change the target or turn motor power off.

To change where the servo goes, send another target. To release the motor, set
torque enable to zero. Sensor freshness checks, motor protection,
and the firmware watchdog remain active while moving and holding.

## Extension protocol

This section describes the exact messages exchanged between the host and servo.
It is intended for readers connecting their own software.

### Message format and number encoding

Each message is a packet: a sequence of bytes containing the destination, command,
data, and a checksum used to detect transmission errors. Extension commands use
the standard STS packet format:

```text
Request:  FF FF ID LENGTH INSTRUCTION PARAMETERS... CHECKSUM
Response: FF FF ID LENGTH LEGACY_ERROR EXT_STATUS DATA... CHECKSUM
```

- Request `LENGTH = parameter_bytes + 2`.
- Response `LENGTH = data_bytes + 3`; the extension status occupies the first
  response parameter, separately from the normal legacy error byte.
- `CHECKSUM = ~(ID + LENGTH + instruction_or_error + all_parameter_bytes) & 0xFF`.
  The response sum includes `EXT_STATUS` and any data.
- A field occupying several bytes sends the least significant byte first
  (**little-endian**). For example, the number 256 is sent as `00 01` in two bytes.
- `u8`, `u16`, and `u32` are nonnegative whole numbers occupying 1, 2, and 4 bytes.
  `i16` and `i32` occupy 2 and 4 bytes and can also represent negative numbers.
  Signed extension values use **two's complement**: for example, −1 is `FF FF`
  in an `i16` field. This differs from the legacy encoding of signed values.
- **Q8** means a value is multiplied by 256 before transmission so fractions can
  be represented as whole numbers. Divide by 256 when reading it. For example,
  position 1000 counts is sent as 256000, and gain 4.5 is sent as 1152.
- Position is in encoder counts and velocity is in counts/s. The host handles any
  conversion to joint angles, including changes of direction or zero position.
- **Unicast** means a message addressed to one servo. **Broadcast** uses ID `0xFE`
  and reaches all servos. Broadcast extension commands never generate replies.

Example: read the 8-byte capabilities block from servo ID 1:

```text
FF FF 01 04 90 90 08 D2
```

A **selector** identifies a complete register block, such as configuration or
feedback. Access it with extension READ/WRITE and the exact block size listed
below. Reading or writing just part of a block is unsupported, and the legacy
READ/WRITE commands cannot access these blocks.

### Instructions

The parameter sizes below exclude the packet header and checksum. In a reply,
`EXT_STATUS` reports whether the extension command succeeded, separately from
`LEGACY_ERROR`, the servo's normal error byte. A successful read adds the requested
data after `EXT_STATUS`; writes, other commands, and failed reads have no extra
data.

| Instruction | Name | Parameters | Broadcast |
| --- | --- | --- | --- |
| `0x90` | READ | `selector:u8, count:u8` | No useful response |
| `0x91` | WRITE | `selector:u8, block...` | Not accepted |
| `0x99` | GRAVITY | 6 bytes, below | Not accepted |
| `0x9A` | TARGETS | `session:u16` + 1–6 entries of 9 bytes | Accepted |

Instruction numbers `0x92`, `0x93`, `0x94`, `0x95`, `0x96`, `0x97`, and `0x98`, and selectors `0xA1`, `0xA3`,
`0xB0`, `0xBA`, `0xE0`, and `0xF0`, are reserved and must not be used.

| Extension status | Meaning |
| --- | --- |
| `0` | OK |
| `1` | Invalid length, selector, or field value |
| `2` | Command cannot be accepted in the current state |
| `3` | Reserved |
| `4` | Reserved |
| `5` | Unsupported instruction |

A session mismatch returns a state failure. Inspect both the legacy error byte
and extension status.

### Sessions and sequence numbers

The host assigns each session a number from 1 to 65535 and includes it in control
commands. This lets the servo check that a command belongs to the current session.
Choose a new number for each startup; setup numbers are not stored permanently.

A **sequence number** counts accepted commands in order, allowing the host and
servo to identify missing, repeated, or out-of-order commands.

TARGETS has a per-servo motion sequence counter. GRAVITY has a separate counter.
Both start at zero when torque enable starts control; normally send **1** first.
Numbers increase through 65535 and then wrap to **0**, without ending the session. Gaps are allowed: after
10, the servo may accept 12 even if 11 was lost or rejected. Equal or older
numbers are rejected without changing the current command.

For an exact comparison, calculate `distance = (incoming − accepted) & 0xFFFF`.
A command is newer only when `1 ≤ distance ≤ 32767`. A jump of exactly 32768 is
ambiguous and rejected. Keep the gap from the last accepted command below 32768;
if command history is uncertain, turn torque off, prepare a new session ID, and enable torque again.
Do not reuse queued packets from an earlier session or counter cycle.

Acceptance still requires valid fields, current sensor readings, and a feasible
movement. A rejected command does not advance its counter. These commands replace
absolute targets; they are not a waypoint queue. To visit every waypoint, wait
for each arrival before sending the next destination.

When sending a group target, read each servo's feedback to verify its accepted
sequence. Each servo decides independently whether it can accept its target;
one may reject it while the others start moving.

### TARGETS — `0x9A`

The first two parameter bytes contain the shared session. Each following entry
has this layout; offsets are relative to the start of that entry:

| Offset | Type | Field |
| --- | --- | --- |
| 0 | `u8` | Servo ID, 1–253 |
| 1 | `u16` | Newer motion sequence for this servo |
| 3 | `i32` | Destination position, Q8 counts |
| 7 | `u16` | Maximum speed, counts/s, nonzero |

The parameter length is `2 + 9 × entry_count`, at most 56 bytes. IDs must be
unique. Each servo checks the format and required fields of **all** entries
before handling its own. A servo that is not listed does nothing. A listed servo
checks its session, sequence, readiness, and whether the movement can stay within
its limits. An accepted target starts immediately and stays active until replaced
or disarmed. Values are capped at the configured limits as described under
S-curve motion.

### GRAVITY — `0x99`

| Offset | Type | Field / constraint |
| --- | --- | --- |
| 0 | `u16` | Current session |
| 2 | `u16` | Newer gravity sequence |
| 4 | `i16` | Desired gravity effort; magnitude ≤ configured output limit |

The parameter length is exactly 6 bytes. Requires an armed session with motor
power on, ready hardware, no reported fault, and recent sensor readings. It does
not advance the motion sequence. The requested value remains active until
replaced or disarmed.

## Extension registers

An **offset** is the starting byte of a field, counting from zero within its
block. Offsets below are decimal; selectors use hexadecimal notation (`0x...`). All writes use instruction `0x91`; reads use
`0x90` with the exact byte count.

| Selector | Block | Access | Bytes |
| --- | --- | --- | --- |
| `0x90` | Capabilities | Read | 8 |
| `0xA0` | Configuration | Read/write | 24 |
| `0xB8` | Controller selection and session setup | Write | 3 |
| `0xC1` | Operational feedback | Read | 32 |
| `0xC2` | Tuning feedback | Read | 54 |

### Capabilities — `0x90`

| Offset | Type | Value / meaning |
| --- | --- | --- |
| 0–3 | 4 bytes | ASCII `ARMC` |
| 4 | `u8` | Major version: 9 |
| 5 | `u8` | Minor version: 0 |
| 6 | `u8` | Reserved: 0 |
| 7 | `u8` | Normal controller update interval: 1 ms |

The protocol version defines the available blocks and their exact lengths.
Selection and session setup share one write-only block, documented below.

### Configuration — `0xA0`

| Offset | Type | Field | Units / valid range |
| --- | --- | --- | --- |
| 0 | `u16` | `kp_q8` | Gain × 256; 0–65535 |
| 2 | `u16` | `kd_q8` | Gain × 256; 0–65535 |
| 4 | `u16` | `ki_q8` | Gain × 256; 0–65535 |
| 6 | `u16` | `integral_limit` | Effort; 0–`effort_limit` |
| 8 | `u16` | `effort_limit` | Effort; 1–1000 |
| 10 | `u16` | `velocity_limit` | Counts/s; 1–65535 |
| 12 | `u16` | `acceleration_limit` | Counts/s²; 1–30000 |
| 14 | `u8` | `velocity_filter_q8` | Speed-filter response; 1–255, higher responds faster |
| 15 | `u8` | `ramp_time_ms` | Acceleration ramp; 1–255 ms |
| 16 | `u16` | `velocity_ff.positive_gain_q8` | Output/(count/s) × 256; 0–65535 |
| 18 | `u16` | `velocity_ff.negative_gain_q8` | Output/(count/s) × 256; 0–65535 |
| 20 | `u16` | `velocity_ff.effort_limit` | Effort; 0–main `effort_limit` |
| 22 | `u16` | `gravity_slew` | Compensation change, effort units/s; 1–10000 |

Gains are sent as the desired value multiplied by 256. Their units are
output/count for P, output/(count/s) for D, and output/(count·s) for I. For example,
P = 4.5 produces 4.5 output units per count of error and is sent as 1152.

The servo has **one active configuration**. Writing it requires motor power off and a disarmed session.
Every write replaces the entire configuration, including feedforward
settings. Invalid settings reject the entire write without changing anything.
Read `0xA0` to check the settings that were accepted.

Velocity-feedforward gains are nonnegative. A zero feedforward output limit
requires both gains to be zero. The same feedforward output limit applies in
both directions and must not exceed the main output limit.

After a reset, configure the servo before enabling motor power. Keep saved settings and
alternative tuning values on the host; change gains between runs with the arm
supported and motor power off.

### Selection and session setup — `0xB8`

| Offset | Type | Meaning |
| --- | --- | --- |
| 0 | `u8` | Mode: `0` legacy, `1` extension |
| 1 | `u16` | Session: `0` for legacy, `1–65535` for extension |

The exact payload length is **3 bytes**, with the session in little-endian order.
For example, extension mode with session `0x1234` is `01 34 12`; legacy mode is
`00 00 00`. Invalid combinations reject the whole write without changing state.
Both modes require motor power off and replace any earlier session setup.
Selection alone does not start control or capture a holding position.

Legacy torque-enable register **40** starts the prepared extension session when
written to `1`. It requires available motor output, a valid configuration, initialized sensors with
readings no more than 2 ms old, no fault requiring shutdown, and usable saved
legacy position limits. The measured position must be within those limits when
they are enabled. These checks happen at enable time, so movement or faults
between setup and enable are taken into account.

Torque-off cancels both running control and unused setup. Sensor failures,
protection shutdown, position-limit or encoder-offset changes, calibration and
saving permanent settings also invalidate session setup. Read feedback to check
whether control has actually started; there is no separate ARM command.
The former `0xBA` selector and former one-byte selection payload are rejected.

### Operational feedback — `0xC1`

| Offset | Type | Field / units |
| --- | --- | --- |
| 0 | `u32` | Measurement time, ms since startup; returns to zero after 4294967295 |
| 4 | `u16` | Measurement number; returns to zero after 65535 |
| 6 | `u16` | Session |
| 8 | `u16` | Accepted target sequence |
| 10 | `u16` | Accepted gravity sequence |
| 12 | `u16` | Flags, below |
| 14 | `i32` | Measured position, Q8 counts |
| 18 | `i32` | Filtered measured velocity, Q8 counts/s |
| 22 | `i16` | Applied output; positive follows increasing encoder counts |
| 24 | `i16` | Current-sensor reading relative to its baseline; not amperes |
| 26 | `u8` | Supply voltage, 0.1 V units |
| 27 | `u8` | Validated temperature, °C |
| 28 | `u8` | Legacy servo fault/status flags |
| 29 | `u8` | Reserved: zero |
| 30 | `u16` | Measurement age at read time, ms; maximum reported value 65535 |

| Flag bit | Meaning when set |
| --- | --- |
| 0 | Sample is fresh and usable for current arm control state |
| 1 | Controller active |
| 2 | Reserved: zero |
| 3 | Motor output limited |
| 4 | Arm drive enabled |
| 5 | Session started by torque enable |
| 6 | Reserved: zero |
| 7 | Output ready |
| 8 | A gravity command has been received |
| 9 | Reserved: zero |
| 10 | Validated temperature available |
| 11 | Reserved: zero |
| 12 | Motion target active |
| 13 | Reserved: zero |
| 14 | Arm controller selected |
| 15 | Reserved: zero |

Each flag is one bit: bit 0 has value 1, bit 1 has value 2, bit 2 has value 4,
and so on. Several flags can be set at once. An active controller with bit 12
clear is holding its destination. A clear motion bit alone does not mean the
motor is powered or ready.

Feedback describes a recorded measurement. If the servo's state changes before
the host reads it, some fields may describe the earlier state. Bit 0 is cleared
when the measurement is over 2 ms old, the controller is no longer selected,
armed, driving, or ready, or its session/sequence numbers no longer match.
Check bit 0, age, session, and accepted sequence together.

Position and health readings are also available in legacy mode and with motor
power off. Unavailable control fields are zero. The sample sequence advances
when measurements are acquired, not each time the host reads them. It distinguishes
samples that share the same millisecond timestamp. Unexpected
large temperature changes are checked across several readings before appearing
here; see the protection limitation below.

### Tuning feedback — `0xC2`

Bytes 0–31 have exactly the `0xC1` layout. The remaining bytes are:

| Offset | Type | Field / units |
| --- | --- | --- |
| 32 | `i32` | Reference position, Q8 counts |
| 36 | `i32` | Reference velocity, Q8 counts/s |
| 40 | `i16` | Requested output after its configured limit, before motor protection |
| 42 | `i16` | P contribution, effort |
| 44 | `i16` | D contribution, effort |
| 46 | `i16` | Integral contribution, effort |
| 48 | `i16` | Gravity compensation currently applied, effort |
| 50 | `i16` | Local velocity feedforward, effort |
| 52 | `u16` | Accumulated extra controller delay, ms; maximum 65535 |

The delay counter adds the extra time whenever a controller update takes more
than the normal 1 ms (`elapsed_ms − 1`). It does not count lost messages. Reported
P and D contributions are limited to ±32767, so adding the displayed values may
not reproduce the full internal calculation.

The servo sends feedback only when asked. Use `0xC1` for normal monitoring and
`0xC2` when tuning needs the additional values. Reading `0xC2` already includes
all of `0xC1`, so reading both unnecessarily adds traffic. Separate reads can
refer to different moments; compare their timestamps and sample numbers.

## Build and verification

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

The default build is the normal motor firmware. Separate diagnostic builds are
available with `TIMING_PROBE=1` for general timing measurements or
`TIMING_PROBE=arm` for extension-control timing. These measurements are excluded
from the normal build. Images and build records are generated under `build/`,
which is excluded from Git. Verification builds and
tests offline; it does not flash a servo or open a serial port. See
[tests/README.md](tests/README.md) for the available regression coverage.

An [encoded-firmware upload and recovery tool](tools/flash/README.md) is included.
It accepts publisher-supplied encoded releases and contains no firmware encoder
or encryption key. Follow its setup and verification guide before using hardware.

## Repository layout

| Directory | Responsibility |
| --- | --- |
| `core/` | Portable control, sensing, protocol, register mapping, and storage |
| `include/` | Shared C declarations and data types |
| `app/` | Main firmware loop and coordination between components |
| `platform/gd32f130/` | Hardware drivers, startup code, and build support for the microcontroller |
| `tests/` | Regression tests, required fixtures, and selected hardware diagnostics |
| [`host/servo-driver/`](host/servo-driver/README.md) | Installable Node.js driver for legacy commands and the v9 extension |
| [`tools/teleoperation/`](tools/teleoperation/README.md) | Control a follower from a hand-operated leader |
| [`tools/pose-recorder/`](tools/pose-recorder/README.md) | Record and replay named motor positions |
| [`tools/settings/`](tools/settings/README.md) | Motor discovery and settings backup/restore |
| [`tools/hw-diff-tests/`](tools/hw-diff-tests/README.md) | Hardware comparison tests for factory and custom firmware |
| [`tools/diagnostics/`](tools/diagnostics/README.md) | Bus latency benchmarks and stationary telemetry checks |
| [`tools/flash/`](tools/flash/README.md) | Encoded firmware flashing and settings recovery |

For implementation details, see the
[extension commands](app/arm_extension.c),
[motion planner](core/control/arm_motion.c),
[arm controller](core/control/arm_control.c), and
[runtime](app/runtime.c). Vendor redistribution notices are retained in the
headers and [vendor README](platform/gd32f130/vendor/README.md).

## Current limits

Temperature reported through extension feedback is checked to suppress isolated
jumps, but the motor's temperature protection still uses the raw sensor readings.
This means a brief bad reading can affect protection even if it is filtered out
of extension feedback.

Gains, limits, and compensation must be adjusted for the actual mechanism.
Software tests alone do not establish how an arm will behave under load. Check
measured position, speed, and applied output to assess accuracy, settling, and
whether the motor is reaching its output limit.
