# Teleoperation

Move a powered follower by moving an unpowered leader by hand. Supports 1–6
joint pairs on two separate serial buses. The leader may use factory firmware;
the follower requires this repository's v9 firmware in both control modes.

## Run

Install Node.js 20 or newer, then run `npm install` from the repository root.
Copy [legacy.json](examples/legacy.json) or [extension.json](examples/extension.json)
to your own configuration file. Set the ports, baud rate and joint IDs. Example
gains and limits illustrate the format; use settings tested on your mechanism.

Preview the mapping without changing any motor settings:

```sh
npm run teleoperate -- CONFIG.json
```

Check the reported positions and targets, support both mechanisms, and leave
room for the follower to move toward the leader's pose. Start control explicitly:

```sh
npm run teleoperate -- CONFIG.json --run
```

Each bus must contain exactly its configured IDs. Both mechanisms need saved,
nonempty position limits and ordinary position mode with unit resolution.
Follower settings must be locked with no deferred write pending. Torque must
already be off on both buses; this tool never writes to the leader.

The examples run for 10 seconds. Remove `durationMs` to run until Ctrl+C.
**A normal stop leaves the follower powered.** Extension control finishes its
last target and holds there; legacy control requests a hold at the measured
position. An error or interrupted startup attempts torque-off on every follower
prepared or powered by the tool. Support the mechanism in case power is removed.
A broken connection can prevent torque-off; failed cleanup is reported. The
firmware has no command timeout, so a killed process or lost connection can leave
its last target active.

## Mapping and control

Each `joints` entry contains `leaderId`, `followerId` and `mapping`:

| Setting | Meaning |
| --- | --- |
| `mapping: "angle"` | Preserve encoder displacement from the center of the stored limits. |
| `mapping: "range"` | Scale each half of the leader's travel to the corresponding follower half. Useful for grippers. |
| `direction` | `1` (default) or `-1` to reverse movement. |
| `leaderMiddle`, `followerMiddle` | Optional centers for range mapping, strictly inside the respective limits. |

Targets are capped to the follower's saved limits. `angle` operates in encoder
counts, so it assumes compatible encoder scales and gearing.

`protocol: "legacy"` uses the existing position controller with maximum-speed
semantics (goal time and speed are zero). Optional `legacyAcceleration` (0–254)
sets the legacy acceleration register for the session; otherwise it is unchanged.

`protocol: "extension"` uses the firmware's PID controller and S-curves. It needs
`acceleration` in counts/s² (1–30000), `rampTimeMs` in milliseconds (1–255), and
one `profiles` entry per follower ID:

| Profile field | Meaning |
| --- | --- |
| `kpQ8`, `kdQ8`, `kiQ8` | Controller gains multiplied by 256. |
| `integralLimit`, `effortLimit` | Integral and total output limits in PWM effort units. |
| `velocityLimit` | Maximum speed in counts/s; defaults to 65535. |
| `velocityFilterQ8` | Measured velocity filter setting, 1–255. |
| `gravitySlewEffortPerS` | Rate limit for changes to gravity effort. Required by the firmware configuration. |
| `velocityFeedforward` | `positiveGainQ8`, `negativeGainQ8`, and `effortLimit`; set all three to zero to disable it. |

See the [firmware register guide](../../README.md) for gain units and field
ranges. Profiles are configuration entries for individual motors, not switchable
firmware profiles. Acceleration and ramp time are shared by all followers.
The tool configures and selects extension control with a generated session ID,
then enables torque and waits for ready feedback. It does not calculate or send
gravity compensation or change persistent settings.

## Timing and checks

| Optional setting | Default | Meaning |
| --- | --- | --- |
| `hz` | 60 | Requested update rate, 1–60 Hz. Missed periods are skipped. |
| `maxAgeMs` | 100 | Maximum age of a leader frame before sending, 10–10000 ms. |
| `responseTimeoutMs` | 100 | Response and transaction queue timeout, 25–10000 ms. |
| `durationMs` | Unlimited | Run duration including control startup, 1–86400000 ms. |
| `session` | Generated | Explicit extension session ID, 1–65535, if needed. |
| `rearmPoweredFollower` | false | Allow torque-off before reconfiguring a powered follower. Support it first. |

A frame must include all leader positions. Its age is checked again when the
follower bus becomes available. Follower health is checked at startup and roughly
every 250 ms during control: alarms, invalid/stale readings, temperatures at or
above 60 °C, and lost extension ownership or rejected targets stop the run.
Health checks and logging share the loop, so the achieved rate depends on bus,
computer and disk performance.

Logs are saved in ignored `tools/teleoperation/logs/` as newline-delimited JSON.
They contain configuration, the chosen session ID, preview, intended commands,
sent frames, feedback and stop/error records. A command record alone does not
prove a target was sent or accepted. Writes are awaited without accumulating an
unbounded log queue; slow logging may trigger the frame-age check.

## Replay a recorded session

Replay recorded leader positions on the follower without connecting the leader:

```sh
npm run teleoperate -- CONFIG.json --replay SESSION.ndjson
npm run teleoperate -- CONFIG.json --replay SESSION.ndjson --run
```

The first command is a read-only preview. The second starts motion. Use the
current configuration and tested gains. The recording must contain a `preflight`
event with leader limits and joint mapping, followed by `command` events with
monotonic timestamps and all leader positions. The joint mapping must match the
current configuration. Old session logs with those fields can be read, but old
controller configurations must be adapted to the current configuration format.
Files up to 64 MiB are supported. Truncated or malformed JSON is rejected
before opening a port.

Replay maps recorded leader positions through the recorded leader limits and
the follower's current limits. It sends new commands with a fresh session and
sequence numbers; recorded gains, gravity efforts, targets and packets are not
reused. A `command` event records an intended command, so a log from a failed run
can include a position that was never sent during that run.

Recorded gaps are preserved. Processing delays can stretch playback; it never
sends catch-up bursts. Health checks continue during pauses. After the final
frame, playback waits for arrival (default tolerance 10 counts, timeout 30 s),
then exits with the same powered-hold behaviour as live control. Ctrl+C ends it
early; faults attempt torque-off. The first frame can cause an initial approach
from the follower's current pose.

Optional `replay.repeat`, `replay.moveTimeoutMs` and `replay.toleranceCounts` use
the ranges documented in the [pose replay guide](../pose-recorder/README.md#replay-poses).
`replay.speed` and `replay.holdMs` apply only to pose files; session replay uses
recorded timing and the configured controller limits. `hz` applies only to live
control. Remove `durationMs` from a copied example if you want the complete
recording instead of the example's 10-second cap.

For named poses from the pose recorder, use `npm run replay-poses` as described
in that guide. Both commands share follower setup, health checks and cleanup.
Replay logs include the source path and SHA-256 hash.

Run offline tests with `npm run test:teleoperation`.
