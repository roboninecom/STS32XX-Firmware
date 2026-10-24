# STS32XX servo driver

Installable Node.js package `sts32xx-servo-driver` (Node.js 20+). From the repository
root, run `npm pack --workspace sts32xx-servo-driver --pack-destination /tmp`.
In another project, install the resulting `.tgz` with `npm install /path/to/archive.tgz`.
No npm registry publication is required.

Licensed under [MIT](LICENSE). This license applies to this driver directory,
including its examples and tests, not to firmware or vendor code elsewhere.
Dependencies retain their own licenses.

CommonJS host interface for STS serial framing, scheduled requests, discovery,
register access, settings, and the opt-in arm v9 extension. Install the root
package dependencies with `npm ci`; import with `require('./host/servo-driver')`.

`StsServo` owns the transport, request scheduler, protocol, bus, settings, and
arm API. `SerialTransport` accepts an injected `portFactory` for offline tests.
Serial ports open only when requested by the caller.

The arm API exposes capabilities, RAM configuration, selection with session setup, group targets, gravity support, and
coherent feedback. Each servo has one configuration, changed only while disarmed
with motor power off. The driver requires extension version 9 before accessing
control or feedback. Configuration is 24 bytes, gravity commands are 6 bytes,
and tuning feedback is 54 bytes. `ArmCodec` validates and encodes these payloads; the tests
pin their little-endian wire layouts to firmware vectors.

Configuration requires explicit gains, effort limits, symmetric
acceleration, velocity filtering, and a ramp time. Targets use encoder
position in Q8 and speed in counts/s; each motor entry is 9 bytes. Acceleration
in counts/s² is set once in configuration. Each target
has a sequence number; the group carries a shared session. Gravity and local
velocity feedforward are bounded effort, not measured joint torque.

The servo completes its last accepted target and holds it until replaced or
disarmed. Gravity reaches its last requested value at the configured slew rate
and remains active. No keepalive messages are needed. Sensor and motor
protection still apply. The removed `timeoutMs` and `ttlMs` fields are rejected.
Position limits come from legacy registers 9 and 11 when torque enable starts control. The removed
`positionMinQ8` and `positionMaxQ8` inputs are rejected. Equal legacy limits
disable travel limiting; the extension's supported position range still applies.
Changing either limit ends an active extension session and disables torque.

Configuration also requires `gravitySlewEffortPerS` and a `velocityFeedforward`
object containing `positiveGainQ8`, `negativeGainQ8`, and `effortLimit`. Use three
zeros to disable local feedforward. These settings are written and verified in
one operation; there is no separate feedforward register or API.

Sequence numbers accept forward gaps of 1–32767 and wrap from 65535 through zero.
The first command normally uses 1; duplicates, older values, and half-range jumps
are rejected. Check accepted numbers in feedback. To release a motor, write zero
to legacy torque-enable register 40. This also ends its extension session; the
separate `abort`/DISARM API has been removed. There is no separate `arm()` call. While torque is off, call
`arm.select(id, true, session, options)` to prepare extension control, then write
`1` to register 40 and verify the session and readiness in feedback. To select
legacy mode, use `arm.select(id, false, 0, options)`. Selection is a 3-byte payload;
the former one-byte payload and `0xBA` ARM selector are rejected.

A failed start leaves torque off and consumes the setup. Torque-off and faults
also clear it. Supply a new session ID in selection before restarting; a repeated
enable during active control preserves motion and compensation. The ordinary
legacy write acknowledgement does not confirm startup; use readback/feedback.

Capabilities are 8 bytes. Operational/tuning feedback remain 32/54 bytes; the
redundant `holding` and temperature-candidate flags are removed. An active
controller with `running` false is holding. Measurement numbers are retained.

Transport response timeouts remain host settings for detecting missing replies;
they do not expire a motor command.

```sh
node --test host/servo-driver/test/*.test.js
```

The included driver tests use fake transports and do not open serial ports.
