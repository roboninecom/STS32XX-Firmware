# Shared arm controller

`ArmController` owns follower setup, target sending, feedback checks and cleanup.
It uses the low-level [servo driver](../servo-driver/README.md). Input sources
provide joint IDs, read-only preflight/preview and a playback loop. Live input
and file replay share the same follower lifecycle; neither writes motor settings
independently.

The CLI commands remain documented in the [teleoperation](../../tools/teleoperation/README.md)
and [pose recorder](../../tools/pose-recorder/README.md) guides.
