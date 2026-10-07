# Generic teleoperation

The leader is read-only; the follower must run this repository's arm v4 firmware.
Both buses need the exact configured IDs and distinct serial ports. Normal
shutdown requests a powered hold on the follower.

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
`kiQ8`, `integralLimit`, `effortLimit`, `velocityFilterQ8`, and `timeoutMs`.
Position bounds are intersected with stored limits. The driver validates the
full RAM configuration; the utility does not select gains or tuning profiles.

Startup requires torque off on both buses. Host health checks reject stale or
invalid feedback and validated temperature at or above 60 C. The optional
`rearmPoweredFollower` flag explicitly allows follower torque-off rearming.
Session logs are written to ignored `backups/teleoperation/`.
