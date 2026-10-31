# Flash firmware

Flash custom or factory firmware on a compatible **GD32F130 STS TTL servo**.
One uploader handles both; the release manifest selects the application checks.

**Warning: flashing firmware can damage your servo, erase calibration or leave
it unusable. Use this tool at your own risk. Recovery is not guaranteed.**

Use the publisher's firmware image and matching `release.json`, kept in the same
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

## Choose firmware

| Firmware | Manifest |
| --- | --- |
| Custom extension v9 | Download the publisher's image and `release.json` together into `tools/flash/releases/`. |
| Factory **SCServo21-GD32-TTL 3.10**, model **9.3** | Bundled at [`factory/release.json`](factory/release.json), alongside its image. |

The factory image is only for matching hardware. Use the selected manifest with
`inspect`, `flash` or `recover`; no separate factory command or mode is needed.

## Prepare

- Normal flashing resets only the selected motor ID. Motors with unique IDs may
  remain connected; flash them sequentially while the others run normally.
  Do not power-cycle the bus or run another uploader during a transfer.
- For **recovery**, connect only the intended servo. Recovery does not select a
  motor by ID, and bootloader transfers are not addressed.
- Secure the mechanism, use stable motor power, and close other programs using
  the serial port.
- For normal flashing, disable torque, lock settings writes and clear any active
  alarm using your usual control tool. Know the servo's current ID and baud rate.
- Back up important calibration and settings. Start with settings saved to the
  servo; temporary changes can disappear after restart.

Replace the port and ID with your values. The default baud rate is **1,000,000**;
add `--baud 500000`, for example, if needed. Typical ports are `/dev/cu.usbmodem…`
on macOS, `/dev/ttyUSB0` on Linux and `COM3` on Windows.

```sh
python tools/flash/settings.py backup \
  --port /dev/cu.usbmodemYOUR_ADAPTER --id 2 \
  --file backups/servo-2-settings.json
```

Keep this backup for this exact servo. Existing backup files are not overwritten.

## Flash

Check and flash a downloaded custom release:

```sh
python tools/flash/flash.py inspect \
  --manifest tools/flash/releases/release.json

python tools/flash/flash.py flash \
  --manifest tools/flash/releases/release.json \
  --port /dev/cu.usbmodemYOUR_ADAPTER --id 2
```

To install the bundled factory firmware, select its manifest instead. Isolate
the servo for this operation: factory startup may change its ID to 1, conflicting
with another motor on the bus.

```sh
python tools/flash/flash.py flash \
  --manifest tools/flash/factory/release.json \
  --port /dev/cu.usbmodemYOUR_ADAPTER --id 2
```

`inspect` checks the file size, checksum and manifest without connecting to a servo.
Type `FLASH` when prompted. Keep power connected until the command finishes.
The tool checks the servo, saves its settings snapshot, uploads the firmware,
then checks the application and compares settings. Successful verification leaves
torque disabled.

After a factory flash, the tool checks the previous ID/baud, then ID **1** at
**1,000,000** baud if needed, and prints the working connection. Exit code **2**
means factory firmware responded but settings changed. Continue with settings
repair below rather than flashing again.

## Recover an unresponsive servo

First check power, wiring, ID and baud rate. If recovery is needed, connect
**only the intended servo** and use the selected manifest. For example, to
recover with factory firmware:

```sh
python tools/flash/flash.py recover \
  --manifest tools/flash/factory/release.json \
  --port /dev/cu.usbmodemYOUR_ADAPTER --id 1
```

After confirmation, **power-cycle the servo when prompted**, leaving the USB
adapter connected. The tool waits up to 60 seconds for the bootloader.

Use the ID and baud rate expected after recovery. Recovery cannot check the
current model or back up settings before uploading, so confirm hardware
compatibility yourself. Check calibration and position limits before enabling
torque afterward.

## Restore factory settings

After returning to factory firmware, restore this servo's backup even if settings
initially look correct. Factory firmware may use built-in defaults when its saved
settings are invalid; ordinary register writes may not fix this.

Use the **current** ID/baud printed after flashing. For example, if it now answers
as ID 1:

```sh
python tools/flash/settings.py restore \
  --port /dev/cu.usbmodemYOUR_ADAPTER --id 1 \
  --file backups/servo-2-settings.json
```

Type `RESTORE` to confirm. This supports factory **3.10** and refuses detected
custom firmware. It restores settings, **replaces the saved reset template**,
repairs the saved settings, locks writes and restarts the servo. It follows any
ID/baud changes and verifies readback without sending motion commands.

Then **power-cycle the servo** and verify using the **restored** ID/baud:

```sh
python tools/flash/settings.py verify \
  --port /dev/cu.usbmodemYOUR_ADAPTER --id 2 \
  --file backups/servo-2-settings.json
```

Keep torque off until verification passes. You can also supply a normal flash
`report.json` containing a before-flash snapshot as `--file`. Backups taken after
settings were lost cannot recover original calibration. Without a valid backup,
obtain settings for the exact model and recalibrate this servo.

On failure, repair attempts to relock settings but does not undo partial writes
or retry the repair automatically. Preserve the report before investigating.

## Results and options

Flash reports are saved under `backups/flash/`; settings reports under
`backups/settings/`. Both include available settings snapshots.
A successful upload includes application checks; it does not read back the full
firmware image. Settings are not automatically restored.

- `--output DIRECTORY`: choose where reports are saved.
- `--yes`: skip the confirmation prompt; all checks still run.
- `--help`: show command options.

If file validation fails, obtain a matching release pair. If flashing is
interrupted, the servo may need recovery. If transfer finishes but verification
fails, inspect the report and check ID, baud rate and settings before retrying.

For release authors, [release.example.json](release.example.json) shows a custom
manifest and [factory/release.json](factory/release.json) a factory manifest.
The custom example is not a usable firmware release.

## Acknowledgments

The flashing and recovery tools were inspired by
[0o8o0-blip/sts3215-firmware](https://github.com/0o8o0-blip/sts3215-firmware/).
