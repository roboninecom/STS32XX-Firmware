"""Offline release and upload checks. All serial devices below are fakes."""

import argparse
import contextlib
import hashlib
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import bootloader
import flash
from serial_io import read_exact, read_until_ack


def release(data=bytes(range(80))):
    return {"format": flash.FORMAT, "release": "offline-test", "image": "example.enc",
            "size": len(data), "sha256": hashlib.sha256(data).hexdigest(),
            "target": "gd32f130-sts-ttl", "model_bytes": [[9, 8]],
            "extension": {"major": 9, "minor": 0}}


def table():
    data = bytearray(87)
    data[3:5] = bytes([9, 8])
    data[5], data[55] = 1, 1
    return bytes(data)


def status(servo_id=1, error=0, data=b""):
    size = len(data) + 2
    return (b"\xff\xff" + bytes([servo_id, size, error]) + data
            + bytes([bootloader.checksum(servo_id, size, error, data)]))


class Clock:
    def __init__(self):
        self.now = 0

    def monotonic(self):
        return self.now

    def sleep(self, seconds):
        self.now += seconds


class Port:
    def __init__(self, clock, arrivals=()):
        self.clock = clock
        self.arrivals = list(arrivals)
        self.buffer = bytearray()
        self.writes = []
        self.baudrate = 1_000_000

    @property
    def timeout(self):
        return 0

    @timeout.setter
    def timeout(self, value):
        raise AssertionError("Serial timeout was reconfigured")

    @property
    def in_waiting(self):
        while self.arrivals and self.arrivals[0][0] <= self.clock.now:
            self.buffer.extend(self.arrivals.pop(0)[1])
        return len(self.buffer)

    def read(self, size):
        count = min(size, self.in_waiting)
        result = bytes(self.buffer[:count])
        del self.buffer[:count]
        return result

    def write(self, data):
        self.writes.append(bytes(data))
        return len(data)

    def flush(self):
        pass

    def reset_input_buffer(self):
        self.buffer.clear()

    def reset_output_buffer(self):
        pass


class ManifestTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.file = self.root / "release.json"
        self.data = bytes(range(80))
        self.manifest = release(self.data)
        (self.root / "example.enc").write_bytes(self.data)

    def load(self, **changes):
        self.file.write_text(json.dumps({**self.manifest, **changes}))
        return flash.load_release(self.file)

    def test_payload_is_unchanged_even_with_bin_suffix(self):
        (self.root / "already-encoded.bin").write_bytes(self.data)
        _, image = self.load(image="already-encoded.bin")
        self.assertEqual(image, self.data)

    def test_malformed_or_unsupported_manifests(self):
        for changes in ({"size": 0}, {"size": 17}, {"size": 0x7010}, {"size": True},
                        {"image": "../outside.enc"}, {"image": "C:\\outside.enc"},
                        {"sha256": "bad"}, {"sha256": "0" * 64}, {"target": "other"},
                        {"format": "raw"}, {"model_bytes": []}, {"model_bytes": [[True, 8]]},
                        {"extension": {"major": 4, "minor": 0}}, {"extra": "ignored?"}):
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                self.load(**changes)

    def test_truncated_and_oversized_images(self):
        for data in (self.data[:-1], b"x" * (bootloader.MAX_IMAGE_SIZE + 1)):
            (self.root / "example.enc").write_bytes(data)
            with self.assertRaises(ValueError):
                self.load()

    def test_plain_vector_image_is_rejected_even_with_matching_hash(self):
        data = bytes.fromhex("00100020cd000008") + b"\0" * 72
        (self.root / "example.enc").write_bytes(data)
        self.manifest = release(data)
        with self.assertRaisesRegex(ValueError, "raw firmware"):
            self.load()

    def test_duplicate_manifest_keys(self):
        self.file.write_text('{"format":"a","format":"b"}')
        with self.assertRaisesRegex(ValueError, "Duplicate"):
            flash.load_release(self.file)

    def test_inspect_never_opens_serial(self):
        self.load()
        with patch("flash.serial.Serial") as factory, contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(flash.main(["inspect", "--manifest", str(self.file)]), 0)
            factory.assert_not_called()

    def test_bad_image_rejected_before_serial_and_output_creation(self):
        self.load()
        (self.root / "example.enc").write_bytes(b"truncated")
        with patch("flash.serial.Serial") as factory, contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(flash.main(["flash", "--manifest", str(self.file),
                                        "--port", "fake", "--id", "1", "--yes"]), 1)
            factory.assert_not_called()


class WireTests(unittest.TestCase):
    def setUp(self):
        self.clock = Clock()
        for name in ("sleep", "monotonic"):
            mocked = patch(f"bootloader.time.{name}", getattr(self.clock, name))
            mocked.start()
            self.addCleanup(mocked.stop)

    def test_packet_matches_previous_uploader_and_wraps_sequence(self):
        data = bytes(range(64))
        self.assertEqual(bootloader.block_packet(1, data),
                         bytes.fromhex("01fe06") + data + bytes.fromhex("64fd06"))
        self.assertEqual(bootloader.block_packet(256, data, True),
                         bytes.fromhex("00ff04") + data + bytes.fromhex("5eeb04"))
        self.assertEqual(bootloader.block_packet(1, b"x", True)[3:67], b"x" + b"\xff" * 63)

    def test_fragmented_reply_has_one_deadline_and_keeps_uart_unchanged(self):
        packet = status(data=b"ab")
        port = Port(self.clock, [(0.002, packet[:2]), (0.006, packet[2:4]), (0.012, packet[4:])])
        self.assertIsNone(bootloader.receive(port, 0.01))
        self.assertAlmostEqual(self.clock.now, 0.01)
        port = Port(self.clock, [(0.012, packet[:2]), (0.016, packet[2:])])
        self.assertEqual(bootloader.receive(port, 0.01), (1, 0, b"ab"))

    def test_corrupt_packet_and_invalid_length(self):
        for data in (status()[:-1] + b"\0", b"\xff\xff\x01\x01", status(254)):
            with self.subTest(data=data):
                self.assertIsNone(bootloader.receive(Port(self.clock, [(0, data)])))

    def test_exchange_rejects_wrong_id_length_and_alarm(self):
        port = Port(self.clock)
        for reply in ((2, 0, b""), (1, 0, b"x"), (1, 4, b""), None):
            with patch("bootloader.receive", return_value=reply), self.assertRaises(RuntimeError):
                bootloader.exchange(port, 1, 1, b"", 0, attempts=1)

    def test_fragmented_ack_and_partial_reads(self):
        port = Port(self.clock, [(0, b"\x43"), (0.004, b"\0\x06")])
        self.assertEqual(read_until_ack(port, 0.01), (True, b"\x43\0\x06"))
        port = Port(self.clock, [(0.004, b"ab"), (0.02, b"c")])
        self.assertEqual(read_exact(port, 3, 0.005), b"ab")

    def test_transfer_retries_identical_block_and_preserves_padding(self):
        port = Port(self.clock)
        progress = []
        with patch("bootloader.read_exact", side_effect=[b"\x15", b"\x06", b"\x06"]):
            bootloader.transfer(port, bytes(range(80)), lambda *x: progress.append(x))
        self.assertEqual(port.writes[0], port.writes[1])
        self.assertEqual(port.writes[-1][2], 4)
        self.assertEqual(port.writes[-1][3:67], bytes(range(64, 80)) + b"\xff" * 48)
        self.assertEqual(progress, [(1, 2), (2, 2)])

    def test_transfer_timeout_and_serial_write_timeout_are_bounded(self):
        for write_timeout in (False, True):
            port = Port(self.clock)
            with patch("bootloader.read_exact", return_value=b""), \
                    patch.object(port, "write", side_effect=bootloader.serial.SerialTimeoutException()
                                 if write_timeout else None, return_value=70) as write:
                with self.assertRaisesRegex(RuntimeError, "after 3 attempts"):
                    bootloader.transfer(port, bytes(range(64)))
                self.assertEqual(write.call_count, 3)

    def test_invalid_direct_upload_never_resets_device(self):
        port = Port(self.clock)
        with self.assertRaises(ValueError):
            bootloader.upload(port, 1, b"bad")
        self.assertEqual(port.writes, [])

    def test_normal_and_recovery_share_transfer_but_only_normal_sends_reset(self):
        for servo_id, reset_packet in ((1, "ffff010208f4"), (6, "ffff060208ef")):
            for recovery in (False, True):
                with self.subTest(servo_id=servo_id, recovery=recovery):
                    port = Port(self.clock)
                    with patch("bootloader.acquire") as acquire, patch("bootloader.transfer") as transfer:
                        image = bytes(range(64))
                        bootloader.upload(port, servo_id, image, recovery)
                        acquire.assert_called_once_with(port, recovery)
                        self.assertEqual(transfer.call_args.args[:2], (port, image))
                    self.assertEqual(len(port.writes), 0 if recovery else 1)
                    if not recovery:
                        self.assertEqual(port.writes[0], bytes.fromhex(reset_packet))
                        self.assertEqual(port.baudrate, 500_000)

    def test_handshake_reacquires_magic_and_times_out(self):
        port = Port(self.clock)
        with patch("bootloader.read_until_ack", side_effect=[(True, b"\x06"), (False, b""),
                                                            (True, b"\x06"), (True, b"\x06")]):
            bootloader.acquire(port)
        self.assertEqual(port.writes, [bootloader.MAGIC] * 3 + [b"\1"] +
                         [bootloader.MAGIC] * 3 + [b"\1"])
        port.writes.clear()
        with patch("bootloader.read_until_ack", return_value=(False, b"")), self.assertRaises(RuntimeError):
            bootloader.acquire(port)
        self.assertEqual(len(port.writes), 30)


class WorkflowTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.output = Path(temporary.name)
        self.args = argparse.Namespace(command="flash", port="fake", id=1, baud=1_000_000,
                                       output=self.output, yes=True)

    def execute(self, snapshots=None, caps=b"\0ARMC\x09\0\0\x01", upload_error=None):
        existing = set(self.output.glob("*/report.json"))
        with patch("flash.serial.Serial") as factory, patch("flash.time.sleep"), \
                patch("bootloader.registers", side_effect=snapshots or [table()] * 3), \
                patch("bootloader.exchange", return_value=caps), \
                patch("bootloader.upload", side_effect=upload_error) as upload, \
                contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            result = flash.execute(self.args, release(), bytes(range(80)))
        created = set(self.output.glob("*/report.json")) - existing
        self.assertEqual(len(created), 1)
        report = json.loads(created.pop().read_text())
        return result, report, factory, upload

    def test_normal_upload_checks_settings_and_capabilities(self):
        result, report, factory, upload = self.execute()
        self.assertEqual(result, 0)
        self.assertEqual(report["status"], "verified")
        self.assertEqual(report["settings_verification"], "unchanged")
        self.assertEqual(report["before_registers_hex"], report["after_registers_hex"])
        self.assertEqual(factory.call_args.kwargs["timeout"], 0)
        self.assertEqual(factory.call_args.kwargs["baudrate"], 1_000_000)
        upload.assert_called_once()
        factory.return_value.__exit__.assert_called_once()

    def test_recovery_marks_settings_unverified_and_opens_boot_baud(self):
        self.args.command = "recover"
        result, report, factory, upload = self.execute([table()])
        self.assertEqual(result, 0)
        self.assertNotIn("before_registers_hex", report)
        self.assertEqual(report["settings_verification"], "unavailable in recovery")
        self.assertEqual(factory.call_args.kwargs["baudrate"], 500_000)
        self.assertTrue(upload.call_args.args[3])

    def test_preflight_refuses_power_alarm_wrong_model_baud_or_unlocked(self):
        for address, value in ((40, 1), (55, 0), (65, 1), (3, 99), (6, 1)):
            with self.subTest(address=address):
                data = bytearray(table()); data[address] = value
                _, _, _, upload = self.execute([bytes(data)])
                upload.assert_not_called()

    def test_setting_change_during_confirmation_prevents_reset(self):
        changed = bytearray(table()); changed[21] = 99
        result, _, _, upload = self.execute([table(), bytes(changed)])
        self.assertEqual(result, 1)
        upload.assert_not_called()

    def test_post_upload_setting_change_is_failure_with_both_snapshots(self):
        changed = bytearray(table()); changed[21] = 99
        result, report, _, _ = self.execute([table(), table(), bytes(changed)])
        self.assertEqual(result, 1)
        self.assertTrue(report["transfer_complete"])
        self.assertNotEqual(report["before_registers_hex"], report["after_registers_hex"])

    def test_wrong_extension_is_not_success(self):
        result, report, _, _ = self.execute(caps=b"\0ARMC\x04\0\0\x01")
        self.assertEqual(result, 1)
        self.assertIn("capabilities", report["error"])

    def test_transfer_failure_and_interrupt_preserve_report_and_close(self):
        for error, code in ((RuntimeError("lost ACK"), 1), (KeyboardInterrupt(), 130)):
            result, _, factory, _ = self.execute(upload_error=error)
            self.assertEqual(result, code)
            factory.return_value.__exit__.assert_called_once()

    def test_cancel_does_not_upload(self):
        self.args.yes = False
        with patch("builtins.input", return_value="cancel"):
            result, _, _, upload = self.execute([table()])
        self.assertEqual(result, 1)
        upload.assert_not_called()


if __name__ == "__main__":
    unittest.main()
