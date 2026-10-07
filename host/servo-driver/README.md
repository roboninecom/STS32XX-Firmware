# Servo driver

CommonJS host interface for STS serial framing, scheduled requests, discovery,
register access, settings, and the opt-in arm v4 extension. Install the root
package dependencies with `npm ci`; import with `require('./host/servo-driver')`.

`StsServo` owns the transport, request scheduler, protocol, bus, settings, and
arm API. `SerialTransport` accepts an injected `portFactory` for offline tests.
Serial ports open only when requested by the caller.

The arm API exposes capabilities, RAM configuration, extension selection,
session arming, group targets, heartbeat, gravity support, powered stop, and
coherent feedback. `ArmCodec` validates and encodes these payloads; the tests
pin their little-endian wire layouts to firmware vectors.

Configuration requires explicit gains, effort and position limits, symmetric
acceleration, timeout, velocity filtering, and a ramp time. Targets use encoder
position in Q8, speed in counts/s, and acceleration in counts/s². Each target
has a sequence number; the group carries a shared session. Gravity and local
velocity feedforward are bounded effort, not measured joint torque.

```sh
node --test host/servo-driver/test/*.test.js
```

The included driver tests use fake transports and do not open serial ports.
