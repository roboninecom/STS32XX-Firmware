"""Settings recovery checks with persistent state, communication changes and faults."""
import contextlib
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import settings


def table():
    data = bytearray(87)
    data[:9] = bytes([3, 10, 0, 9, 3, 2, 0, 0, 1])
    data[55] = 1
    return data


class SimulatedDevice(settings.Device):
    def __init__(self, initial, fault=None):
        super().__init__(MagicMock(baudrate=settings.BAUD_RATES[initial[6]]), initial[5], {})
        self.live = bytearray(initial)
        self.saved = bytearray(initial)
        self.template = None
        self.calls = []
        self.fault = fault
        self.factory_header_valid = False

    def read(self):
        if self.id != self.live[5] or self.ser.baudrate != settings.BAUD_RATES[self.live[6]]:
            raise RuntimeError('Wrong connection')
        return bytes(self.live)

    def command(self, code, data=b'', delay=.25):
        self.calls.append((code, bytes(data)))
        if self.fault == (code, bytes(data)):
            self.fault = None
            raise RuntimeError('Injected command failure')
        if code == 3:
            address, value = data
            self.live[address] = value
            if address in settings.ADDRESSES and not self.live[55]:
                self.saved[address] = value
        elif code == 9:
            self.template = bytearray(self.live)
        elif code == 6:
            self.live = bytearray(self.template)
            self.saved = bytearray(self.template)
            self.factory_header_valid = True
        elif code == 8:
            if not self.factory_header_valid:
                raise RuntimeError('Unrepaired factory header')
            self.live = bytearray(self.saved)
            self.live[55] = 1


class SettingsTests(unittest.TestCase):
    def test_repairs_header_and_restores_after_restart(self):
        expected = table()
        expected[7], expected[31] = 4, 125
        device = SimulatedDevice(table())
        phases = []
        settings.repair(device, expected, table(), phases.append)
        settings.compare(device.read(), expected)
        self.assertEqual(phases, ['restoring-settings', 'saving-template', 'applying-template', 'restarting'])
        self.assertLess(device.calls.index((9,b'')),device.calls.index((6,b'')))
        self.assertTrue(device.factory_header_valid)
        self.assertEqual(device.live[40], 0)
        self.assertEqual(device.live[55], 1)
        self.assertFalse(any(code==3 and data[0]==40 for code,data in device.calls))

    def test_follows_id_baud_and_silent_response_level_last(self):
        expected = table()
        expected[7], expected[8], expected[5], expected[6] = 3, 0, 12, 1
        device = SimulatedDevice(table())
        settings.repair(device, expected, table(), lambda phase: None)
        self.assertEqual(device.id, 12)
        self.assertEqual(device.ser.baudrate, 500000)
        addresses = [data[0] for code,data in device.calls if code==3]
        self.assertEqual(addresses, [55,7,8,5,6,55])

    def test_template_failure_relocks_without_reset(self):
        for code in (9,6):
            with self.subTest(code=code):
                device = SimulatedDevice(table(), (code,b''))
                with self.assertRaisesRegex(RuntimeError,'Injected'):
                    settings.repair(device, table(), table(), lambda phase: None)
                self.assertEqual(device.live[55],1)
                self.assertNotIn((8,b''),device.calls)
                if code==9: self.assertNotIn((6,b''),device.calls)

    def test_write_failure_relocks_before_template(self):
        expected=table(); expected[7]=3
        device=SimulatedDevice(table(),(3,bytes([7,3])))
        with self.assertRaises(RuntimeError):
            settings.repair(device,expected,table(),lambda phase:None)
        self.assertEqual(device.live[55],1)
        self.assertNotIn((9,b''),device.calls)

    def test_readback_mismatch_prevents_saving_template(self):
        device=SimulatedDevice(table())
        expected=table(); expected[7]=2
        with patch.object(device,'write',return_value=bytes(table())):
            with self.assertRaisesRegex(RuntimeError,'Settings differ'):
                settings.repair(device,expected,table(),lambda phase:None)
        self.assertEqual(device.calls,[])

    def test_powered_unlocked_alarm_or_wrong_connection_refused(self):
        for address,value in ((40,1),(55,0),(65,4),(5,8),(6,1)):
            data=table(); data[address]=value
            with self.assertRaises(RuntimeError): settings.ready(data,2,1000000)

    def test_custom_and_missing_factory_reply_refused(self):
        ser=MagicMock(baudrate=1000000)
        for reply in ((2,0,b'\x00ARMC\x09\x00\x00\x01'),None,(4,0,b'')):
            with patch('settings.bootloader.send'),patch('settings.bootloader.receive',return_value=reply):
                with self.assertRaises(RuntimeError): settings.require_factory(ser,2,table())

    def test_factory_reply_and_silent_factory_reads(self):
        ser=MagicMock(baudrate=1000000)
        for response in (0,1):
            data=table(); data[8]=response
            with patch('settings.bootloader.send'),patch('settings.bootloader.receive',return_value=(2,0,b'') if response else None),patch('settings.bootloader.registers',return_value=bytes(data)):
                settings.require_factory(ser,2,data)

    def test_readonly_model_version_cannot_be_repaired(self):
        data=table(); data[1]=9
        with self.assertRaisesRegex(RuntimeError,'3.10'): settings.require_factory(MagicMock(),2,data)

    def test_template_ack_failure_prevents_next_instruction(self):
        for reply in (None, (2,4,b''), (1,0,b'')):
            device=settings.Device(MagicMock(),2,{})
            with patch.object(device,'read',return_value=bytes(table())),patch('settings.bootloader.send') as send,patch('settings.bootloader.receive',return_value=reply),patch('settings.time.sleep'):
                with self.assertRaisesRegex(RuntimeError,'not acknowledged'):
                    device.command(9)
                send.assert_called_once()

    def test_template_ack_and_response_zero(self):
        for response in (0,1):
            data=table(); data[8]=response
            device=settings.Device(MagicMock(),2,{})
            with patch.object(device,'read',return_value=bytes(data)),patch('settings.bootloader.send'),patch('settings.bootloader.receive',return_value=(2,0,b'')) as receive,patch('settings.time.sleep'):
                device.command(9)
                self.assertEqual(receive.call_count,response)

    def test_interrupt_during_template_relocks(self):
        device=SimulatedDevice(table())
        def checkpoint(phase):
            if phase=='saving-template': raise KeyboardInterrupt()
        with self.assertRaises(KeyboardInterrupt):
            settings.repair(device,table(),table(),checkpoint)
        self.assertEqual(device.live[55],1)
        self.assertNotIn((6,b''),device.calls)

    def test_cleanup_follows_changed_id_after_later_failure(self):
        expected=table(); expected[5]=12
        device=SimulatedDevice(table(),(9,b''))
        with self.assertRaises(RuntimeError):
            settings.repair(device,expected,table(),lambda phase:None)
        self.assertEqual(device.id,12)
        self.assertEqual(device.live[55],1)
        self.assertEqual(device.report['connection']['id'],12)

    def test_backup_and_flash_report_inputs(self):
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'backup.json'
            for data in ({'format':settings.FORMAT,'registers_hex':table().hex()}, {'mode':'flash','before_registers_hex':table().hex()}):
                path.write_text(json.dumps(data))
                self.assertEqual(settings.load_backup(path),table())
            for data in ({'mode':'recover','before_registers_hex':table().hex()}, {'format':settings.FORMAT,'registers_hex':'zz'*87}, [], {'format':settings.FORMAT,'registers_hex':'00'*87}):
                path.write_text(json.dumps(data))
                with self.assertRaises(ValueError):settings.load_backup(path)
            path.write_text('{"format":"a","format":"b"}')
            with self.assertRaises(ValueError):settings.load_backup(path)

    def test_invalid_backup_and_existing_output_never_open_serial(self):
        with tempfile.TemporaryDirectory() as folder, patch('settings.serial.Serial') as serial, contextlib.redirect_stderr(io.StringIO()):
            path=Path(folder)/'backup.json'; path.write_text('{}')
            for command in ('backup','restore','verify'):
                self.assertEqual(settings.main([command,'--port','fake','--id','2','--file',str(path)]),1)
            serial.assert_not_called()

    def test_verify_mismatch_saves_failure_and_closes(self):
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'backup.json'
            expected=table(); expected[7]=4
            path.write_text(json.dumps({'format':settings.FORMAT,'registers_hex':expected.hex()}))
            with patch('settings.serial.Serial') as serial,patch('settings.bootloader.registers',return_value=bytes(table())),patch('settings.time.sleep'),contextlib.redirect_stdout(io.StringIO()),contextlib.redirect_stderr(io.StringIO()):
                result=settings.main(['verify','--port','fake','--id','2','--file',str(path),'--output',folder])
                self.assertEqual(result,1)
                serial.return_value.__exit__.assert_called_once()
            report=json.loads(next(Path(folder).glob('settings-*/report.json')).read_text())
            self.assertEqual(report['status'],'failed')
            self.assertIn('registers: [7]',report['error'])

    def test_cancellation_never_writes(self):
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'backup.json'
            path.write_text(json.dumps({'format':settings.FORMAT,'registers_hex':table().hex()}))
            with patch('settings.serial.Serial'),patch('settings.bootloader.registers',return_value=bytes(table())),patch('settings.require_factory'),patch('settings.repair') as repair,patch('builtins.input',return_value='cancel'),patch('settings.time.sleep'),contextlib.redirect_stdout(io.StringIO()):
                result=settings.main(['restore','--port','fake','--id','2','--file',str(path),'--output',folder])
                self.assertEqual(result,1)
                repair.assert_not_called()


if __name__=='__main__': unittest.main()
