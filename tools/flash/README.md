# Flash encoded firmware

Upload an encoded firmware release to a compatible **GD32F130 STS TTL servo**.
The tool includes normal flashing and recovery. It contains no encoder or keys.

**Warning: flashing firmware can damage your servo, erase calibration or leave
it unusable. Use this tool at your own risk. Recovery is not guaranteed.**

Use the publisher's encoded image and matching `release.json`, kept in the same
folder. Raw firmware builds are not supported. Check the release's hardware
compatibility before flashing.

## Install

Requires **Python 3.10 or newer**. Run from the repository root:

```sh
python3 -m venv tools/flash/.venv
source tools/flash/.venv/bin/activate
python -m pip install -r tools/flash/requirements.txt
```

On Windows, activate with `tools\flash\.venv\Scripts\Activate.ps1` instead.

## Prepare

- Connect **only one servo** to the adapter; bootloader transfers are not addressed
  by motor ID.
- Secure the mechanism, use stable motor power, and close other programs using
  the serial port.
- For normal flashing, disable torque, lock settings writes and clear any active
  alarm using your usual control tool. Know the servo's current ID and baud rate.
- Back up important calibration and settings. Start with settings saved to the
  servo; temporary changes can disappear after restart.

Place the release files in `tools/flash/releases/`, then check them:

```sh
python tools/flash/flash.py inspect \
  --manifest tools/flash/releases/release.json
```

This checks the file size, checksum and manifest without connecting to a servo.

## Flash

Replace the port and ID with your values:

```sh
python tools/flash/flash.py flash \
  --manifest tools/flash/releases/release.json \
  --port /dev/cu.usbmodemYOUR_ADAPTER --id 1
```

Type `FLASH` when prompted. Keep power connected until the command finishes.
The tool checks the servo, saves its settings snapshot, uploads the firmware,
then checks the application and compares settings. Successful verification leaves
torque disabled.

The default application baud rate is **1,000,000**. Add `--baud 500000`, for
example, if your servo uses that rate. Typical ports are `/dev/cu.usbmodem…` on
macOS, `/dev/ttyUSB0` on Linux and `COM3` on Windows.

## Recover an unresponsive servo

First check power, wiring, ID and baud rate. If recovery is needed:

```sh
python tools/flash/flash.py recover \
  --manifest tools/flash/releases/release.json \
  --port /dev/cu.usbmodemYOUR_ADAPTER --id 1
```

After confirmation, **power-cycle the servo when prompted**, leaving the USB
adapter connected. The tool waits up to 60 seconds for the bootloader.

Use the ID and baud rate expected after recovery. Recovery cannot check the
current model or back up settings before uploading, so confirm hardware
compatibility yourself. Check calibration and position limits before enabling
torque afterward.

## Returning to factory firmware

We have an encoded **SCServo21-GD32-TTL factory 3.10** recovery image. The current
public uploader verifies custom extension v9 firmware only; factory-image support
is not yet included.

Flashing factory firmware may require a separate settings repair, even if the
manufacturer's tool initially displays correct values. Use the separate `settings.py` tool to back up, restore and verify settings.
See [factory settings recovery](FACTORY_RECOVERY.md) for commands.

## Results and options

Each run saves a report and available settings snapshots under `backups/flash/`.
A successful upload includes application checks; it does not read back the full
firmware image. Settings are not automatically restored.

- `--output DIRECTORY`: choose where reports are saved.
- `--yes`: skip the confirmation prompt; all checks still run.
- `--help`: show command options.

If file validation fails, obtain a matching release pair. If flashing is
interrupted, the servo may need recovery. If transfer finishes but verification
fails, inspect the report and check ID, baud rate and settings before retrying.

For release authors, [release.example.json](release.example.json) shows the
required manifest fields. It is an example, not a usable firmware release.

## Acknowledgments

The flashing and recovery tools were inspired by
[0o8o0-blip/sts3215-firmware](https://github.com/0o8o0-blip/sts3215-firmware/).
