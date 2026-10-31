# Teleoperation

Move a powered follower by moving an unpowered leader by hand. Supports 1–6
joint pairs on two separate serial buses. The leader may use factory firmware;
the follower requires this repository's v9 firmware.

## Run

Install Node.js 20 or newer, then run `npm install` from the repository root.
Copy [example.json](example.json) beside the original as `controller.local.json`.
Set the ports, baud rate and joint IDs. The example shares the
[motor profile](../../host/arm-control/profile.example.json) with replay and tuning.
Copy it for your own settings and update its path, or inline your profiles.
Paths are relative to the controller file. Example gains illustrate the format;
use settings tested on your mechanism.

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
Follower settings must be locked with no deferred write pending. Leader torque
must already be off; this tool never writes to the leader. Follower startup
handles powered and unpowered motors automatically.

Runs continue until Ctrl+C unless you explicitly set `durationMs`.
**Normal exit retains a powered hold.** Startup, gravity and failure cleanup
follow the [shared controller behaviour](../../host/arm-control/README.md#control-behaviour).

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

The mapping center is the midpoint of the saved limits, which may differ from
the calibration reference at 2048. Matching calibration poses alone therefore
does not guarantee matching targets when leader and follower limits are
asymmetric. Preview the mapping before moving. `leaderMiddle` and
`followerMiddle` override centers only for `range` mapping.

Provide a profile for each follower and shared acceleration/ramp settings as
described in [motor settings](../../host/arm-control/README.md#motor-settings-files).
Add `gravityModel` to enable [gravity compensation](../../host/arm-control/README.md#enable-gravity).

## Timing and checks

| Optional setting | Default | Meaning |
| --- | --- | --- |
| `hz` | 60 | Requested update rate, 1–60 Hz. Missed periods are skipped. |
| `maxAgeMs` | 100 | Maximum age of a leader frame before sending, 10–10000 ms. |
| `responseTimeoutMs` | 100 | Response and transaction queue timeout, 25–10000 ms. |
| `durationMs` | Unlimited | Run duration including control startup, 1–86400000 ms. |

Each frame must include every leader position and remain within `maxAgeMs`
until sent. Missed update periods are skipped. Feedback, gravity and logging
share the control loop; achieved speed depends on bus and computer performance.
See [shared checks and timing](../../host/arm-control/README.md#checks-and-timing).

Logs are saved in ignored `logs/motion/` as newline-delimited JSON.
They contain configuration, the chosen session ID, preview, intended commands,
sent frames, feedback and stop/error records. A command record alone does not
prove a target was sent or accepted. Writes are awaited without accumulating an
unbounded log queue; slow logging may trigger the frame-age check.

Replay logs without a connected leader using the
[recorded-session replay command](../poses/README.md#replay-a-recorded-session).

Run offline tests with `npm run test:teleoperation`.
