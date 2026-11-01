# STS32XX Firmware

Firmware for GD32F130-based STS3215 servos. Standard STS commands are available
in legacy mode; extension mode adds locally planned smooth motion, configurable
position control, velocity feedforward and host-calculated gravity compensation.

Start with the **[Quick start](QUICKSTART.md)** guide, or read the
[detailed documentation](DETAILED_DOCUMENTATION.md) for configuration and protocol details.

[![Overview: recorded SO-101 and SO-102 before-and-after tests](assets/readme/posters/overview.jpg)](assets/readme/videos/overview.mp4)

[Watch video (MP4)](assets/readme/videos/overview.mp4)

Approximate values describe the recorded demonstrations, not guaranteed accuracy across the workspace.

Select a video image or the link below it to watch the silent clip.

- [Why we built it](#why-we-built-it)
- [What changes in control](#what-changes-in-control)
- [Results on SO-101 / SO-102](#results-on-so-101--so-102)
- [Robots and links](#robots-and-links)
- [Quick start](#quick-start)
- [Detailed documentation](#detailed-documentation)

## Why we built it

A robot arm can return consistently to the same point and still miss the
commanded target. **Repeatability** describes that consistency; **absolute
positioning accuracy** describes how close the arm gets to the target.

**Repeated returns measured with an indicator**

[![Repeated returns measured with an indicator](assets/readme/posters/repeatability.jpg)](assets/readme/videos/repeatability.mp4)

[Watch video (MP4)](assets/readme/videos/repeatability.mp4)

**Repeatability versus absolute positioning accuracy**

[![Conceptual explanation of repeatability and absolute positioning accuracy](assets/readme/posters/repeatability-vs-accuracy.jpg)](assets/readme/videos/repeatability-vs-accuracy.mp4)

[Watch video (MP4)](assets/readme/videos/repeatability-vs-accuracy.mp4)

We tried to reduce positioning error by tuning PID on the stock firmware. In
some test scenarios, the settings that reduced the error also caused oscillation.
We developed custom firmware to give us more control over motion planning and
position control.

[![Stock firmware: oscillation during PID tuning](assets/readme/posters/stock-pid-oscillation.jpg)](assets/readme/videos/stock-pid-oscillation.mp4)

[Watch video (MP4)](assets/readme/videos/stock-pid-oscillation.mp4)

## What changes in control

The host sends targets and settings; each servo plans and controls its own movement.

![Control overview: host settings and targets, local motion planning and control](assets/readme/illustrations/control-overview.png)

[Watch the recorded overview (MP4)](assets/readme/videos/overview.mp4)

### S-curve motion

Makes acceleration and braking more gradual. The curve illustrates acceleration over time.

[![Conceptual illustration of s-curve motion](assets/readme/illustrations/s-curve.png)](assets/readme/videos/s-curve.mp4)

[Watch video (MP4)](assets/readme/videos/s-curve.mp4)

[Configuration and limitations](DETAILED_DOCUMENTATION.md#s-curve-motion).

### PID control

Adjusts how the servo corrects position error. The gray curve illustrates oscillation; the white curve illustrates a more damped response. The dashed line is the target.

[![Conceptual illustration of pid control](assets/readme/illustrations/pid-tuning.png)](assets/readme/videos/pid-tuning.mp4)

[Watch video (MP4)](assets/readme/videos/pid-tuning.mp4)

[Configuration and limitations](DETAILED_DOCUMENTATION.md#pid-controller).

### Velocity feedforward

Adds motor output based on planned speed, calculated inside the servo. Both curves progress from left to right over time.

[![Conceptual illustration of velocity feedforward](assets/readme/illustrations/velocity-feedforward.png)](assets/readme/videos/velocity-feedforward.mp4)

[Watch video (MP4)](assets/readme/videos/velocity-feedforward.mp4)

[Configuration and limitations](DETAILED_DOCUMENTATION.md#velocity-feedforward).

### Gravity compensation

The host calculates the contribution and the servo applies it. The downward arrow represents weight; the upward arrow represents support.

[![Conceptual illustration of gravity compensation](assets/readme/illustrations/gravity-compensation.png)](assets/readme/videos/gravity-compensation.mp4)

[Watch video (MP4)](assets/readme/videos/gravity-compensation.mp4)

[Configuration and limitations](DETAILED_DOCUMENTATION.md#gravity-compensation).

These explanatory graphics and animations are conceptual, not measured hardware plots.
See the [detailed documentation](DETAILED_DOCUMENTATION.md) for settings, protocol
details and limitations. Extension clients must support **protocol v9.0**;
extension settings are temporary and must be sent again after a reset or power cycle.

## Results on SO-101 / SO-102

The clips below show recorded before-and-after tests on SO-101 and SO-102.
Each comparison shows the original behavior first, followed by the
custom-firmware setup.

**SO-101: before, then after**

[![SO-101 recorded before-and-after comparison](assets/readme/posters/so101-before-after.jpg)](assets/readme/videos/so101-before-after.mp4)

[Watch video (MP4)](assets/readme/videos/so101-before-after.mp4)

**SO-102: before, then after**

[![SO-102 recorded before-and-after comparison](assets/readme/posters/so102-before-after.jpg)](assets/readme/videos/so102-before-after.mp4)

[Watch video (MP4)](assets/readme/videos/so102-before-after.mp4)

The approximate values shown describe these demonstrations, not guaranteed
accuracy across the arm's workspace. Repeatability, absolute positioning
accuracy and mechanical deflection are different measurements.

### Complete coordinated movement

[![Complete recorded SO-101 movement](assets/readme/posters/coordinated-motion.jpg)](assets/readme/videos/coordinated-motion.mp4)

[Watch video (MP4)](assets/readme/videos/coordinated-motion.mp4)

This clip preserves the complete recorded movement. Each servo plans locally;
sending targets together does not by itself guarantee simultaneous arrival.

### Mechanical limitations

[![Gearbox backlash and frame flex](assets/readme/posters/mechanical-limits.jpg)](assets/readme/videos/mechanical-limits.mp4)

[Watch video (MP4)](assets/readme/videos/mechanical-limits.mp4)

Gearbox backlash and frame flex still affect the arm's endpoint position.
Controller tuning does not remove these mechanical limitations. Validate
settings on the actual mechanism and load; see
[current limits](DETAILED_DOCUMENTATION.md#current-limits).

## Robots and links

Interested in building a similar setup? Explore the SO-ARM101 and SO-ARM102 kits
from Robonine. Kit contents are documented on the product pages.

| SO-ARM101 | SO-ARM102 |
| --- | --- |
| ![SO-ARM101 robot kit](assets/readme/illustrations/hardware-so101.jpg) | ![SO-ARM102 robot kit](assets/readme/illustrations/hardware-so102.jpg) |
| [Buy the SO-ARM101 kit from Robonine](https://robonine.com/ru/shop/so-arm101-black-white-robotic-arm-kit/) | [Buy the SO-ARM102 kit from Robonine](https://robonine.com/ru/shop/so-arm102-robotic-arm-kit/) |

[Explore SO-ARM102 hardware, CAD and BOM](https://github.com/roboninecom/SO-ARM102).

## Quick start

Follow the **[existing Quick start guide](QUICKSTART.md)** for the prerequisites,
commands, checks and flashing precautions. Its setup sequence is:

1. Install the required tools and select the servo port.
2. Back up motor settings and flash the published custom firmware.
3. Calibrate joint offsets and travel limits as required for the setup.
4. Check communication with torque off.
5. Record poses, preview replay and perform the first motion test.
6. Enable gravity compensation with a model matching the arm and its calibration.
7. Tune and view motion.

**Flashing can damage the servo or erase calibration.** Follow the guide's
power, torque and recovery precautions before proceeding.

For a new SO-101 or SO-102 calibration, use the existing reference-pose images
and follow the [calibration guide](tools/settings/README.md#reference-pose-images).
Keep an existing verified calibration when reusing its recordings and gravity model.

**SO-101 reference pose**

[![SO-101 reference pose with six labeled joints](tools/settings/images/so101-reference-pose.png)](tools/settings/images/so101-reference-pose.png)

**SO-102 reference pose**

[![SO-102 reference pose with six labeled joints](tools/settings/images/so102-reference-pose.png)](tools/settings/images/so102-reference-pose.png)

## Detailed documentation

The **[detailed documentation](DETAILED_DOCUMENTATION.md)** covers configuration,
protocols, registers, building and verification. Technical diagrams and relevant
video demonstrations appear alongside the corresponding sections.

- [Legacy mode](DETAILED_DOCUMENTATION.md#legacy-mode)
- [How extension mode works](DETAILED_DOCUMENTATION.md#how-extension-mode-works)
- [S-curve motion](DETAILED_DOCUMENTATION.md#s-curve-motion)
- [Calibration reference poses](DETAILED_DOCUMENTATION.md#calibration-reference-poses)
- [PID controller](DETAILED_DOCUMENTATION.md#pid-controller)
- [Velocity feedforward](DETAILED_DOCUMENTATION.md#velocity-feedforward)
- [Gravity compensation](DETAILED_DOCUMENTATION.md#gravity-compensation)
- [Starting and stopping extension mode](DETAILED_DOCUMENTATION.md#starting-and-stopping-extension-mode)
- [Extension protocol](DETAILED_DOCUMENTATION.md#extension-protocol)
- [Extension registers](DETAILED_DOCUMENTATION.md#extension-registers)
- [Build and verification](DETAILED_DOCUMENTATION.md#build-and-verification)
- [Repository layout](DETAILED_DOCUMENTATION.md#repository-layout)
- [Current limits](DETAILED_DOCUMENTATION.md#current-limits)


See [tools](tools/README.md) for individual command guides and
[firmware](firmware/README.md) for the build toolchain.
