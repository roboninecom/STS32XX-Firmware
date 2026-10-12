# Generic teleoperation

The leader is read-only; the follower must run this repository's arm v9 firmware.
Both buses need the exact configured IDs and distinct serial ports. Normal
exit in extension mode leaves the last target active: the follower finishes
that move and holds with motor power on. In legacy mode, normal exit requests a
hold at the measured position. On failure, the tool attempts torque-off on every
follower it prepared or powered, and reports cleanup failures.

```sh
node host/teleoperation/cli.js CONFIG.json
node host/teleoperation/cli.js CONFIG.json --run
```

Without `--run`, the CLI performs read-only preflight and prints one mapped
leader sample. A minimal legacy-control configuration is:

```json
{
  "leaderPort": "/dev/leader",
  "followerPort": "/dev/follower",
  "baudRate": 1000000,
  "protocol": "legacy",
  "hz": 60,
  "maxAgeMs": 100,
  "durationMs": 10000,
  "joints": [{"leaderId": 1, "followerId": 1, "mapping": "angle"}]
}
```

`angle` preserves encoder displacement; `range` maps each side of the leader's
midpoint to the follower's stored limits. Optional `direction` is +1 or -1;
`leaderMiddle` and `followerMiddle` can set explicit centers for range mapping.

Extension mode also requires explicit `acceleration`, `rampTimeMs`, and one
entry in `profiles` per follower ID. Each profile supplies `kpQ8`, `kdQ8`,
`kiQ8`, `integralLimit`, `effortLimit`, `velocityFilterQ8`,
`gravitySlewEffortPerS`, and `velocityFeedforward` with `positiveGainQ8`,
`negativeGainQ8`, and `effortLimit`. Set all three feedforward values to zero to
disable it. Acceleration, gravity slew, and velocity gains are configured before
enabling torque; targets carry only position, speed, and sequence. Sequence counters wrap
through zero without restarting control. The former top-level `velocityFeedforward` map is
rejected; keep these settings within each servo's profile.
Mapping, target capping, and startup checks use the saved legacy limits directly.
Separate profile position bounds and `startupBounds` overrides are rejected.
This tool requires an enabled, nonempty range on both buses for pose mapping,
even though the firmware supports equal limits as disabled travel limiting. The driver validates the
full RAM configuration. These entries are host-side settings, one per servo;
the firmware keeps one configuration and has no gain-profile switching.

Startup requires torque off on both buses. Configuration and selection with a
session ID precede torque enable; there is no separate ARM write. Enabling torque
captures the follower position, and startup waits for feedback confirming that
session and ready output. Set `session` to a new value (1–65535) for each run.
Host health checks reject stale or
invalid feedback and validated temperature at or above 60 C. The optional
`rearmPoweredFollower` flag explicitly allows follower torque-off rearming.
Session logs are written to ignored `backups/teleoperation/`.
