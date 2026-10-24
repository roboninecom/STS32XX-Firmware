# Discovery and settings backup/restore

Find STS servos and back up or restore their persistent legacy settings. Uses the
repository's shared driver and STS control table. Requires Node.js 20 or newer.
Run these commands from the repository root after `npm ci`.

## Discover

```sh
npm run settings -- discover --port /dev/cu.usbmodemYOUR_ADAPTER
```

Lists responding motor IDs and reported alarms as JSON. Discovery is read-only
and scans the selected baud rate, which defaults to 1,000,000. Add
`--baud 500000` for a different supported rate. On Linux or Windows, use your
adapter's port, such as `/dev/ttyUSB0` or `COM3`.

Motors must have unique IDs. Discovery cannot reliably distinguish motors that
share an ID, or find motors using another baud rate.

## Back up

```sh
npm run settings -- backup --port /dev/cu.usbmodemYOUR_ADAPTER --id 2 \
  --file tools/settings/backups/servo-2.json
```

Saves device identity and every persistent setting described by the shared
control table, including calibration, limits, gains, ID and baud selector.
Backup only reads the motor. Existing files are never overwritten. Without
`--file`, a timestamped file is created under `tools/settings/backups/`, which
is ignored by Git.

## Restore

Connect only the motor being restored, disable torque, lock settings and clear
active alarms. Close other programs using the port. Use a backup from the same
motor: restoring another motor's calibration can change its reported position.

```sh
npm run settings -- restore --port /dev/cu.usbmodemYOUR_ADAPTER --id 2 \
  --file tools/settings/backups/servo-2.json
```

`--id` and `--baud` describe the **current connection**. The backup may restore a
different ID or baud rate; the tool follows those changes and reports the final
connection. It checks model identity, writes only changed settings, waits for each saved
register range to finish, reads the settings back and relocks the motor. It never enables torque or sends a motion command. A failed
restore may leave some settings changed; inspect the error before retrying.

These backups cover legacy settings, not extension configuration or the factory
reset template. For repair after flashing factory firmware over custom firmware,
use the [factory settings recovery tool](../flash/FACTORY_RECOVERY.md). Its backup
files use a different format and are not interchangeable with this tool's JSON.

## Help and tests

```sh
npm run settings -- --help
npm run test:settings
```

Tests run offline without opening a serial port. Commands exit with a nonzero
status on failure; an empty discovery list means no replies at the selected baud.
