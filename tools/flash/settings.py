#!/usr/bin/env python3
"""Back up, verify, or repair settings after returning to factory firmware."""

import argparse
import json
from pathlib import Path
import sys
import tempfile
import time

import serial

import bootloader
from flash import BAUD_RATES, persistent, save_report, unique_object

FORMAT = 'sts-settings-v1'
ADDRESSES = tuple(range(4, 40)) + tuple(range(78, 87))


def validate_table(table):
    if len(table) != 87 or table[0] != 3 or table[3] != 9:
        raise ValueError('Expected an 87-byte GD32 STS register snapshot')
    if table[5] > 253 or table[6] >= len(BAUD_RATES) or table[8] not in (0, 1):
        raise ValueError('Invalid saved ID, baud selector or response level')
    return table


def load_backup(path):
    data = json.loads(Path(path).read_text(), object_pairs_hook=unique_object)
    if not isinstance(data, dict):
        raise ValueError('Backup must be a JSON object')
    if data.get('format') == FORMAT:
        raw = data.get('registers_hex')
    elif data.get('mode') == 'flash' and 'before_registers_hex' in data:
        raw = data['before_registers_hex']
    else:
        raise ValueError('Use a settings backup or a normal flash report with a before snapshot')
    if not isinstance(raw, str) or len(raw) != 174:
        raise ValueError('Expected exactly 87 register bytes encoded as hex')
    return validate_table(bytes.fromhex(raw))


def ready(table, servo_id, baud):
    validate_table(table)
    if table[5] != servo_id or BAUD_RATES[table[6]] != baud:
        raise RuntimeError('Live ID/baud differs from the requested connection')
    if table[40] != 0 or table[55] != 1 or table[65] != 0:
        raise RuntimeError('Requires torque off, settings locked and no active alarm')


def compare(table, expected):
    differences = [address for address in ADDRESSES if table[address] != expected[address]]
    if differences:
        raise RuntimeError(f'Settings differ at registers: {differences}')


def require_factory(ser, servo_id, table):
    if table[:4] != bytes([3, 10, 0, 9]):
        raise RuntimeError('Restore supports factory firmware 3.10 only')
    # Custom firmware retains the legacy version bytes. An explicit unsupported
    # instruction reply distinguishes factory firmware from a missing response.
    ser.reset_input_buffer()
    bootloader.send(ser, servo_id, 0x90, bytes([0x90, 8]))
    reply = bootloader.receive(ser, 0.3)
    if reply and reply[0] == servo_id and reply[2].startswith(b'\x00ARMC'):
        raise RuntimeError('Custom firmware detected; install factory firmware before repair')
    if table[8] == 1 and (not reply or reply[0] != servo_id or reply[2]):
        raise RuntimeError('Cannot establish factory protocol; no valid unsupported-command reply')
    # Response level zero suppresses unknown-command replies. Reads must still
    # work, and a responding custom extension above is always rejected.
    ready(bootloader.registers(ser, servo_id), servo_id, ser.baudrate)


class Device:
    def __init__(self, ser, servo_id, report):
        self.ser, self.id, self.report = ser, servo_id, report

    def read(self):
        return bootloader.registers(self.ser, self.id)

    def command(self, code, data=b'', delay=0.25):
        # Never retry a mutation. Later reads verify its effects; WRITE status
        # replies may use the old ID/baud or be disabled by response level zero.
        expect_status = code in (0x09, 0x06) and self.read()[8] != 0
        self.report['last_command'] = {'id': self.id, 'instruction': code, 'data_hex': data.hex()}
        self.ser.reset_input_buffer()
        bootloader.send(self.ser, self.id, code, data)
        time.sleep(delay)
        if expect_status:
            reply = bootloader.receive(self.ser, 0.3)
            if reply != (self.id, 0, b''):
                raise RuntimeError(f'Template instruction 0x{code:02x} was not acknowledged successfully')

    def write(self, address, value):
        self.command(0x03, bytes([address, value]), 0.060)
        # Follow changes even if the subsequent read fails, so cleanup attempts
        # address the new connection. The report keeps this last attempted state.
        if address == 5:
            self.id = value
        elif address == 6:
            self.ser.baudrate = BAUD_RATES[value]
        self.report['connection'] = {'id': self.id, 'baud': self.ser.baudrate}
        table = self.read()
        if table[address] != value:
            raise RuntimeError(f'Register {address} did not retain the requested value')
        if table[40] != 0 or table[65] != 0:
            raise RuntimeError('Torque or alarm state changed during recovery')
        return table


def repair(device, expected, before, checkpoint):
    ready(before, device.id, device.ser.baudrate)
    unlocked = False
    try:
        checkpoint('restoring-settings')
        unlocked = True  # Include ambiguous failures during the unlock write.
        device.write(55, 0)
        for address in ADDRESSES:
            if address not in (5, 6, 8) and before[address] != expected[address]:
                device.write(address, expected[address])
        for address in (8, 5, 6):
            if before[address] != expected[address]:
                device.write(address, expected[address])
        compare(device.read(), expected)
        checkpoint('saving-template')
        device.command(0x09)
        checkpoint('applying-template')
        device.command(0x06)
        compare(device.read(), expected)
        device.write(55, 1)
        unlocked = False
        checkpoint('restarting')
        device.command(0x08, delay=1.0)
        after = device.read()
        device.report['after_registers_hex'] = after.hex()
        ready(after, expected[5], BAUD_RATES[expected[6]])
        compare(after, expected)
        return after
    finally:
        if unlocked:
            try:
                device.write(55, 1)
                device.report['cleanup'] = 'settings relocked'
            except (OSError, RuntimeError, ValueError) as error:
                device.report['cleanup'] = f'Could not confirm settings lock: {error}'


def execute(args, expected):
    output = Path(args.output).resolve()
    output.mkdir(parents=True, exist_ok=True)
    directory = Path(tempfile.mkdtemp(prefix='settings-', dir=output))
    report = {'mode': args.command, 'status': 'started', 'port': args.port,
              'connection': {'id': args.id, 'baud': args.baud}, 'started_unix_s': time.time()}
    if expected is not None:
        report['expected_registers_hex'] = expected.hex()
    def checkpoint(phase):
        report['phase'] = phase
        save_report(directory, report)
    checkpoint('preflight')
    print(f'Report: {directory / "report.json"}', flush=True)
    try:
        with serial.Serial(args.port, args.baud, timeout=0, write_timeout=0.5) as ser:
            time.sleep(0.1)
            before = bootloader.registers(ser, args.id)
            report['before_registers_hex'] = before.hex()
            checkpoint('snapshot-saved')
            ready(before, args.id, args.baud)
            if args.command == 'backup':
                # Exclusive creation prevents accidentally destroying an original backup.
                with Path(args.file).open('x') as dest:
                    json.dump({'format': FORMAT, 'registers_hex': before.hex(),
                               'port': args.port, 'created_unix_s': time.time()}, dest, indent=2)
                    dest.write('\n')
                report['status'] = 'backed-up'
                print(f'Settings saved: {args.file}')
            elif args.command == 'verify':
                compare(before, expected)
                report['status'] = 'verified'
                print('Settings match; torque off, settings locked, no alarm.')
            else:
                require_factory(ser, args.id, before)
                print(f'Restore ID {expected[5]}, baud {BAUD_RATES[expected[6]]}, model 9.{expected[4]}.')
                print('Connect ONE servo. Use its own backup. This replaces its saved reset template.')
                if not args.yes and input('Type RESTORE to continue: ').strip() != 'RESTORE':
                    report['status'] = 'cancelled'
                    return 1
                fresh = bootloader.registers(ser, args.id)
                ready(fresh, args.id, args.baud)
                if persistent(fresh) != persistent(before):
                    raise RuntimeError('Settings changed since preflight; restart recovery')
                repair(Device(ser, args.id, report), expected, fresh, checkpoint)
                report['status'] = 'verified-after-restart'
                print('Settings restored and verified after restart. Torque remains off.')
                print('Power-cycle the servo, then run verify with the restored ID and baud.')
            return 0
    except KeyboardInterrupt:
        report['status'], report['error'] = 'interrupted', 'Interrupted; inspect report before retrying'
        print(report['error'], file=sys.stderr)
        return 130
    except (OSError, RuntimeError, ValueError, EOFError) as error:
        report['status'], report['error'] = 'failed', str(error)
        print(error, file=sys.stderr)
        return 1
    finally:
        report['finished_unix_s'] = time.time()
        save_report(directory, report)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    for name in ('backup', 'restore', 'verify'):
        command = commands.add_parser(name)
        command.add_argument('--port', required=True)
        command.add_argument('--id', required=True, type=int, choices=range(254), metavar='0..253')
        command.add_argument('--baud', type=int, choices=BAUD_RATES, default=1_000_000)
        command.add_argument('--file', required=True, type=Path, help='Settings backup or normal flash report')
        command.add_argument('--output', type=Path, default=Path(__file__).resolve().parents[2] / 'backups' / 'settings')
        if name == 'restore':
            command.add_argument('--yes', action='store_true', help='Skip RESTORE confirmation')
    args = parser.parse_args(argv)
    try:
        if args.command == 'backup' and args.file.exists():
            raise ValueError('Backup already exists; choose a new filename')
        expected = None if args.command == 'backup' else load_backup(args.file)
        return execute(args, expected)
    except (OSError, ValueError) as error:
        print(error, file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
