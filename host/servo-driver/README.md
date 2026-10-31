# STS32XX servo driver

Node.js driver for STS serial servos and the STS32XX firmware **v9 motion
extension**. It provides discovery, register access, settings operations,
S-curve motion commands, gravity compensation and feedback through one serial
connection. Requires **Node.js 20 or newer** and a compatible serial adapter.

Legacy operations use the STS control table included in this package. Extension
operations require custom firmware v9; factory firmware does not provide them.
The package is for Node.js, not browser Web Serial.

## Install

From this repository:

```sh
npm ci
npm run test:driver
npm pack --workspace sts32xx-servo-driver --pack-destination /tmp
```

In another Node.js project, install the archive produced by the last command:

```sh
npm install /tmp/sts32xx-servo-driver-0.1.0.tgz
```

This works without publishing to an npm registry. The archive contains the
library, examples, README and license. Serial dependencies install through npm;
firmware, logs and test results are not included.

CommonJS:

```js
const { StsServo } = require('sts32xx-servo-driver');
```

ES modules:

```js
import driver from 'sts32xx-servo-driver';
const { StsServo } = driver;
```

Existing repository tools can continue importing `host/servo-driver` directly.
Use the package's main export; internal file paths are not part of its public API.

## Connect and read

```js
const { StsServo } = require('sts32xx-servo-driver');

const servo = new StsServo({
  serial: { path: '/dev/cu.usbmodemYOUR_ADAPTER', baudRate: 1000000 },
});

async function main() {
  try {
    const found = await servo.connect();
    for (const id of found.ids) {
      const values = await servo.bus.read(id,
        ['presentPosition', 'presentVoltage', 'servoStatus']);
      console.log(id, values, found.alarms.get(id) ?? []);
    }
  } finally {
    await servo.close();
  }
}
main().catch(console.error);
```

Use `/dev/ttyUSB0`, `COM3` or your adapter's actual port as appropriate.
Discovery finds responding IDs at the selected baud; it does not change motor
settings or scan other baud rates. IDs must be unique. Waits account for the
highest possible ID and selected baud. `connect()` opens the port and discovers
motors; `open()` only opens the port. Bus and extension methods require discovered
IDs.

Register values use raw units. For example, `presentVoltage: 120` means 12 V.
`ControlTable` describes addresses, encodings, ranges and display scales.
Multi-byte fields use little-endian encoding; signed legacy values use sign bits.

## Main API

All operations that communicate with hardware return promises.

| API | Purpose |
| --- | --- |
| `servo.connect()` / `servo.close()` | Open/discover or close the serial connection. |
| `servo.bus.discover()` | Refresh the list of known IDs. |
| `servo.bus.scan()` | Discover without replacing the known-ID list. |
| `servo.bus.verify(ids)` | Ping known motors individually. |
| `servo.bus.read(id, keys, options)` | Read named registers; returns an object keyed by register name. |
| `servo.bus.write(id, values, options)` | Write an object of named registers. |
| `servo.bus.readMany(ids, keys, options)` | Read several motors using group requests. |
| `servo.bus.syncWrite(entries, options)` | Write entries shaped as `{ id, values }` in a group. |
| `servo.bus.device(id)` | Obtain a convenience object with `read`, `write` and reset/calibration methods. |
| `servo.settings.read(id)` | Read persistent legacy settings. |
| `servo.settings.save(id, values)` | Unlock, save, verify and relock ordinary settings. |
| `servo.arm` | Access the v9 methods below. |

Settings saves use a 250 ms request timeout. After a lost write acknowledgement,
the driver waits for persistence and reads the register back before retrying.
Already-applied writes are not repeated. Temporary communication failures have
up to three attempts; persistent failures still report an error and attempt to
relock the motor. Pass `{ timeoutMs }` to `settings.save` to override the timeout.

Legacy example, for a secured motor in position mode that is intended to move:

```js
await servo.bus.write(id, { targetPosition: 2048 },
  { timeoutMs: 100, rejectOnAlarm: true });
```

A legacy goal write can automatically enable torque, depending on saved settings.
Persistent writes can change calibration, limits or gains. Disable torque before
changing settings. The settings API guards ID, baud and response-level changes;
use the [settings CLI](../../tools/settings/README.md) in the repository for full
backup/restore. Factory reset, reset-template and calibration commands are exposed
through `servo.protocol`; call them only when those changes are intended.

## v9 control lifecycle

1. Start with torque off. Read capabilities and configuration.
2. Apply a validated configuration with `arm.configure()` while torque is off.
3. Select extension mode with a new nonzero session ID.
4. Enable torque using legacy register 40, then read feedback until the session is
   armed, fresh, drive-enabled and output-ready.
5. Send targets and gravity updates. Verify their accepted sequence numbers in
   fresh feedback.
6. Write `torqueEnable: 0` when the application intends to release the motor.

```js
const options = { timeoutMs: 100, rejectOnAlarm: true };
const caps = await servo.arm.capabilities(id, options);
if (caps?.major !== 9) throw new Error('Extension v9 is required');

// config must contain values validated for this motor and mechanism.
await servo.arm.configure(id, config, options);
await servo.arm.select(id, true, session, options);
await servo.bus.write(id, { torqueEnable: 1 }, options);
// Check readiness using servo.arm.feedback() before sending motion.

await servo.arm.setTargets([
  { id, target: { sequence: 1, positionQ8: 2048 * 256, speedLimit: 100 } },
], session, options);

await servo.arm.updateGravity(id,
  { session, sequence: 1, gravityEffort: -20 }, options);
```

This snippet shows the calls; the [complete motion example](examples/v9-move.js)
includes validation, readiness polling, acceptance checks and torque-off cleanup.
If write acknowledgments are disabled, legacy writes need `expectResponse: false`
and readback verification. The complete example handles this automatically.

The firmware holds the last target and retains the latest gravity effort until
replaced or torque is disabled. There is no heartbeat, command timeout or gravity
expiry. **Closing the serial connection does not stop or release a motor.**
Choose application cleanup to suit the mechanism; releasing a loaded arm can make
it fall. Sensor and motor protection remain active in firmware.

Torque enable captures the measured position. Do not seed an extension session
with legacy goal writes. Torque off or a fault ends the session; prepare a new
session before restarting. To select legacy mode with torque off, use
`arm.select(id, false, 0)`.

### Extension methods

| Method | Result or effect |
| --- | --- |
| `capabilities(id, options)` | `{ major, minor, tickMs }` for a recognised signature; unsupported firmware may reject the request or time out. |
| `configuration(id, options)` | Read the current RAM configuration. |
| `configure(id, config, options)` | Write configuration and verify the encoded bytes by readback. |
| `select(id, enabled, session, options)` | Prepare v9 control, or select legacy mode with `false, 0`. |
| `setTargets(entries, session, options)` | Send one broadcast containing one to six unique motors. |
| `updateGravity(id, command, options)` | Send signed gravity effort with its own sequence number. |
| `feedback(id, options)` | Read one coherent operational sample. |
| `tuning(id, options)` | Read operational feedback plus reference motion and individual effort terms. |
| `invalidate(id)` | Clear cached capabilities after an external power cycle or firmware change; omit ID to clear all. |

The driver automatically invalidates capabilities on discovery, ID changes,
connection changes and resets issued through its protocol API.

### Configuration and units

Every configuration field is explicit. This object illustrates the format, not a
recommended tuning profile:

```js
const config = {
  kpQ8: 256, kdQ8: 0, kiQ8: 0,
  integralLimit: 0, effortLimit: 100,
  velocityLimit: 100, accelerationLimit: 500,
  velocityFilterQ8: 64, rampTimeMs: 30,
  velocityFeedforward: {
    positiveGainQ8: 0, negativeGainQ8: 0, effortLimit: 0,
  },
  gravitySlewEffortPerS: 1000,
};
```

| Fields | Units and limits |
| --- | --- |
| `kpQ8`, `kdQ8`, `kiQ8` | Gains multiplied by 256; integers 0–65535. |
| `effortLimit`, `integralLimit` | PWM effort units; overall limit 1–1000, integral limit 0–overall limit. |
| `velocityLimit`, target `speedLimit` | Encoder counts/s; 1–65535. |
| `accelerationLimit` | Counts/s²; 1–30000, shared by acceleration and braking. |
| `rampTimeMs` | S-curve acceleration ramp time; 1–255 ms. |
| `velocityFilterQ8` | Filter coefficient multiplied by 256; 1–255. |
| Velocity feedforward gains | Direction-specific gains multiplied by 256; 0–65535. Its effort cap cannot exceed the overall cap. Set both gains and cap to zero to disable it. |
| `gravitySlewEffortPerS` | Gravity effort change per second; 1–10000. |
| Target `positionQ8` | Encoder position multiplied by 256; −32767×256 to 32767×256. |
| `gravityEffort` | Signed PWM effort; −1000 to 1000. Firmware applies its effort limits. |

Travel limits come from the saved legacy position limits. Firmware caps targets
to the active limits. Configuration is RAM state, not a persistent tuning profile.
Local velocity feedforward follows the firmware motion reference; the application
supplies gravity compensation separately.

Extension target IDs are 1–253. A session is 1–65535. Each motor tracks target and gravity sequences separately.
Increment the corresponding sequence for every new command, wrapping 65535 to 0;
forward gaps up to 32767 are accepted. Begin a new session with sequence 1.
Broadcast completion means the packet was sent, not that every motor accepted it.
Check `acceptedSequence`, `gravitySequence` and `session` in subsequent feedback.

### Feedback and errors

`feedback()` includes measured position/velocity in Q8 units, applied effort,
current ADC delta, raw voltage, validated temperature, faults, session and accepted
sequences. Use `fresh`, `ageMs`, `sampleSequence`, `armed`, `driveEnabled` and
`outputReady` to judge whether a sample is usable. Temperature is usable only
when `temperatureValid` is true. `running: false` means the planner is no longer
moving; it does not guarantee zero position error.

`tuning()` adds reference position/velocity, requested effort, P/D/I terms,
gravity effort, velocity feedforward and the overrun count.

Read and write options include `timeoutMs` and `rejectOnAlarm`. Legacy alarms do
not reject otherwise valid replies by default; pass `rejectOnAlarm: true` when
an alarm should abort an operation. Typed errors include `RequestTimeoutError`,
`MissingResponseError`, `ServoStatusError`, `SettingsVerificationError` and
`InvalidPacketError`. Additional context is in `error.details`; extension
rejections include `extensionStatus` there.

The scheduler serializes requests and supports priorities and exclusive
transactions. Await commands and use group targets for coordinated motion.
The reply timeout begins after the serial write drains; transport operations have
their own deadlines. These timeouts do not change motor behaviour.
Legacy packets have no sequence number, so an unusually late reply cannot always
be distinguished from a later request with the same response shape.

Low-level exports include `SerialTransport`, `StsProtocol`, `RequestScheduler`,
`PacketEncoder`, `PacketDecoder`, `RegisterCodec`, `RegisterLayout`, `ArmCodec`,
constants and errors. They remain separate from the high-level bus API.

## Runnable examples

From this directory, or using the example files included in the installed package:

```sh
node examples/discover.js /dev/cu.usbmodemYOUR_ADAPTER
node examples/v9-feedback.js /dev/cu.usbmodemYOUR_ADAPTER 2
node examples/v9-move.js /dev/cu.usbmodemYOUR_ADAPTER 2 2048 100 /path/to/config.json
```

The first two examples only read. The motion example requires a JSON configuration
with the fields above and uses 1 Mbaud. Run it on a secured, unloaded motor with
free travel. It disables torque after the move, an error or graceful Ctrl+C.
It waits up to 3 seconds for startup and 30 seconds for the move. Optional final
argument: signed gravity effort, default zero. Do not use it to support an arm load.

## Tests and license

From the repository root:

```sh
npm run test:driver
npm run test:driver-package
npm test
```

Tests use fake transports and do not open serial ports. The package check installs
the actual archive in a temporary project, using npm's cached dependencies from
`npm ci`, and verifies CommonJS/ESM imports and example entry points. It does not
publish the package. Production installation may require native build tools if a
serial-port binding is unavailable for the operating system and CPU.

[MIT](LICENSE), copyright 2026 STS32XX-Firmware contributors. This license covers
this driver directory, including examples and tests. It does not relicense
firmware or vendor code elsewhere in the repository. Dependencies retain their
own licenses.
