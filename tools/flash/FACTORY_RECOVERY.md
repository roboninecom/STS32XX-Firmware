# Returning to factory firmware

**Flashing can damage the servo or leave it unusable. Recovery is not guaranteed.**
Keep one servo connected, support the mechanism and leave torque disabled.

## Recovery image

The available encoded recovery image is `factory_SCServo21-GD32-TTL.enc`:

- Factory firmware: **3.10**; recorded model code: **9.3**.
- Size: **16,816 bytes**.
- SHA-256: `1e267ff0117eff318d30d8ba6c29651a567fa55da3849d5af616dae0a7256a35`.

This is not a universal STS image. Use it only with matching hardware.
The public `flash.py` currently accepts custom extension v9 releases only.
Do not label the factory image as v9 or bypass verification to upload it.
Factory upload support and release packaging are still pending.

## Why settings may need repair

Factory firmware checks the saved settings header at startup. If it is invalid,
the firmware uses built-in defaults. The servo can then show the wrong model,
ID, limits or control settings. Writing individual settings may look successful
but leave the header invalid, causing defaults to return after restart.

This was observed during factory recovery. The procedure below repaired the
affected devices. It also replaces the servo's saved reset template with the
settings you restore. A manufacturer tool that only writes ordinary settings
may not perform this additional repair.

## Back up before flashing

Use the same Python environment as the [flashing tool](README.md#install).
Connect only one servo, disable torque, lock settings writes and resolve any
active alarm. Run from the repository root:

```sh
python tools/flash/settings.py backup \
  --port /dev/cu.usbmodemYOUR_ADAPTER --id 2 \
  --file backups/servo-2-settings.json
```

Keep this backup for this exact servo. Existing files are never overwritten.
A normal upload's `report.json` can also be used: recovery reads its
`before_registers_hex` snapshot. A backup taken after settings were already lost
cannot recover the original calibration.

## Restore after installing factory firmware

```sh
python tools/flash/settings.py restore \
  --port /dev/cu.usbmodemYOUR_ADAPTER --id 2 \
  --file backups/servo-2-settings.json
```

Use the servo's **current** ID and baud (`--baud`, default `1000000`). They may
have changed after flashing. Type `RESTORE` to confirm that this is the correct
servo and backup; `--yes` skips the prompt.

The tool supports **factory 3.10** and refuses detected custom firmware. It:

1. Saves the current settings to a report and checks torque, lock and alarms.
2. Unlocks settings and restores writable configuration (registers 4–39 and
   78–86), checking readback. Response level, ID and baud are restored last;
   the connection follows any changes.
3. Saves the restored settings as the reset template (`0x09`), then applies
   that template (`0x06`) to repair the active settings header.
4. Locks settings, restarts (`0x08`), and verifies all restored settings,
   torque off, lock enabled and no alarm.

**This replaces the previous reset template.** No motion commands are sent.
On failure the tool attempts to relock settings and records the error. It does
not undo partial writes or automatically retry the whole recovery.

## Verify after power cycling

Power-cycle the servo, keeping the USB adapter connected. Then use the
**restored** ID and baud shown by the recovery tool:

```sh
python tools/flash/settings.py verify \
  --port /dev/cu.usbmodemYOUR_ADAPTER --id 2 \
  --file backups/servo-2-settings.json
```

`verify` only reads settings. Do not enable torque until this check passes.
Reports are saved under `backups/settings/`; use `--output DIRECTORY` to change
that location. A report includes before/after snapshots when available, the
recovery phase, last attempted connection and any cleanup failure.

If the servo does not answer, check power and its current ID/baud. If it answers
but settings differ, preserve the report and investigate before repeating repair.
Without a valid backup, obtain settings for the exact model and recalibrate the
individual servo; another motor's offset is not a replacement for its calibration.
