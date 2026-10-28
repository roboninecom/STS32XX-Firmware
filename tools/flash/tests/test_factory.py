"""Factory bundle, application detection and recovery checks without hardware."""

import argparse
import contextlib
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import flash
import settings

MANIFEST = Path(__file__).resolve().parents[1] / "factory" / "release.json"


def table(servo_id=2, baud_selector=0, response_level=1):
    data = bytearray(87)
    data[:9] = bytes([3, 10, 0, 9, 3, servo_id, baud_selector, 0, response_level])
    data[55] = 1
    return bytes(data)


class FactoryTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.output = Path(temporary.name)
        self.manifest, self.image = flash.load_release(MANIFEST)
        self.args = argparse.Namespace(command="flash", port="fake", id=2, baud=1_000_000,
                                       output=self.output, yes=True)

    def execute(self, snapshots=None, reply=(2, 0, b""), upload_error=None):
        existing = set(self.output.glob("*/report.json"))
        with patch("flash.serial.Serial") as serial, patch("flash.time.sleep"), \
                patch("bootloader.registers", side_effect=snapshots or [table()] * 4) as reads, \
                patch("bootloader.send") as send, patch("bootloader.receive", return_value=reply), \
                patch("bootloader.upload", side_effect=upload_error) as upload, \
                contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            result = flash.execute(self.args, self.manifest, self.image)
        report_path, = set(self.output.glob("*/report.json")) - existing
        return result, json.loads(report_path.read_text()), report_path, serial, upload, reads, send

    def test_bundled_image_and_inspect_without_hardware(self):
        self.assertEqual(len(self.image), 16816)
        self.assertEqual(self.manifest["sha256"],
                         "1e267ff0117eff318d30d8ba6c29651a567fa55da3849d5af616dae0a7256a35")
        self.assertEqual(self.manifest["factory"], {"major": 3, "minor": 10})
        with patch("flash.serial.Serial") as serial, contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(flash.main(["inspect", "--manifest", str(MANIFEST)]), 0)
        serial.assert_not_called()

    def test_bad_factory_manifest_or_corrupt_image_never_opens_port(self):
        (self.output / self.manifest["image"]).write_bytes(self.image)
        path = self.output / "release.json"
        variants = [dict(self.manifest, factory={"major": 3, "minor": 11}),
                    dict(self.manifest, factory={"major": True, "minor": 10}),
                    dict(self.manifest, extension={"major": 9, "minor": 0}),
                    dict(self.manifest, sha256="0" * 64)]
        for manifest in variants:
            with self.subTest(manifest=manifest):
                path.write_text(json.dumps(manifest))
                with patch("flash.serial.Serial") as serial, \
                        contextlib.redirect_stderr(io.StringIO()):
                    self.assertEqual(flash.main(["flash", "--manifest", str(path),
                                                 "--port", "fake", "--id", "2"]), 1)
                serial.assert_not_called()

    def test_flash_and_recover_select_application_from_manifest(self):
        # Both release types use the same CLI and transport entry point.
        custom = dict(self.manifest)
        del custom["factory"]
        custom["extension"] = {"major": 9, "minor": 0}
        (self.output / self.manifest["image"]).write_bytes(self.image)
        path = self.output / "release.json"
        for manifest in (self.manifest, custom):
            path.write_text(json.dumps(manifest))
            for command in ("flash", "recover"):
                with self.subTest(application=manifest, command=command), \
                        patch("flash.execute", return_value=0) as execute:
                    self.assertEqual(flash.main([command, "--manifest", str(path),
                                                 "--port", "fake", "--id", "2"]), 0)
                    args, selected, image = execute.call_args.args
                    self.assertEqual((args.command, args.port, args.id), (command, "fake", 2))
                    self.assertEqual((selected, image), (manifest, self.image))

    def test_manifest_is_required_for_every_command_before_opening_port(self):
        for command in ("inspect", "flash", "recover"):
            arguments = [command] if command == "inspect" else [command, "--port", "fake", "--id", "2"]
            with self.subTest(command=command), patch("flash.serial.Serial") as serial, \
                    contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
                flash.main(arguments)
            serial.assert_not_called()

    def test_normal_flash_preserves_snapshot_and_uploads_exact_encoded_bytes(self):
        result, report, path, serial, upload, _, send = self.execute()
        self.assertEqual(result, 0)
        self.assertEqual(report["status"], "verified")
        self.assertTrue(report["application_verified"])
        self.assertEqual(report["settings_verification"], "unchanged")
        self.assertNotIn("capabilities_hex", report)
        self.assertEqual(settings.load_backup(path), table())
        self.assertEqual(upload.call_args.args[1:4], (2, self.image, False))
        # Application verification sends only an extension read, no settings writes.
        self.assertEqual(send.call_args.args[1:], (2, 0x90, bytes([0x90, 8])))
        serial.return_value.__exit__.assert_called_once()

    def test_factory_default_id_and_baud_fallback_preserves_restorable_backup(self):
        self.args.baud = 500_000
        before, after = table(2, 1), table(1)
        result, report, path, _, _, reads, _ = self.execute(
            [before, before, RuntimeError("No response"), after, after], reply=(1, 0, b""))
        self.assertEqual(result, 2)
        self.assertEqual(report["status"], "settings-recovery-required")
        self.assertEqual(report["connection"], {"id": 1, "baud": 1_000_000})
        self.assertTrue(report["application_verified"])
        self.assertEqual(report["settings_verification"], "changed")
        self.assertEqual(settings.load_backup(path), before)
        self.assertEqual([call.args[1] for call in reads.call_args_list], [2, 2, 2, 1, 1])

    def test_changed_settings_at_original_connection_are_not_reported_unchanged(self):
        after = bytearray(table()); after[21] = 42
        result, report, _, _, _, _, _ = self.execute([table(), table(), bytes(after), bytes(after)])
        self.assertEqual(result, 2)
        self.assertEqual(report["settings_verification"], "changed")

    def test_recovery_opens_bootloader_baud_without_claiming_settings_restored(self):
        self.args.command = "recover"
        result, report, _, serial, upload, _, _ = self.execute([table(), table()])
        self.assertEqual(result, 0)
        self.assertEqual(serial.call_args.kwargs["baudrate"], 500_000)
        self.assertTrue(upload.call_args.args[3])
        self.assertNotIn("before_registers_hex", report)
        self.assertEqual(report["settings_verification"], "unavailable in recovery")

    def test_custom_extension_and_bad_factory_responses_are_rejected(self):
        for level in (0, 1):
            for reply in ((2, 0, b"\x00ARMC\x09\0\0\x01"), (1, 0, b""), (2, 4, b"")):
                with self.subTest(level=level, reply=reply):
                    result, report, _, _, _, _, _ = self.execute([table(response_level=level)] * 4, reply)
                    self.assertEqual(result, 1)
                    self.assertNotIn("application_verified", report)
        result, _, _, _, _, _, _ = self.execute(reply=None)
        self.assertEqual(result, 1)

    def test_silent_factory_requires_response_level_zero_and_fresh_read(self):
        snapshots = [table(response_level=0)] * 4
        result, _, _, _, _, _, _ = self.execute(snapshots, reply=None)
        self.assertEqual(result, 0)
        result, _, _, _, _, _, _ = self.execute(snapshots[:3] + [RuntimeError("Lost connection")], None)
        self.assertEqual(result, 1)

    def test_wrong_firmware_version_or_changing_safety_state_is_rejected(self):
        for address, value in ((1, 11), (40, 1), (55, 0), (65, 4), (21, 99)):
            changed = bytearray(table()); changed[address] = value
            snapshots = [table(), table(), bytes(changed)] if address == 1 else [table()] * 3 + [bytes(changed)]
            with self.subTest(address=address):
                result, report, _, _, _, _, _ = self.execute(snapshots)
                self.assertEqual(result, 1)
                self.assertTrue(report["transfer_complete"])
                self.assertNotIn("application_verified", report)

    def test_verification_search_is_bounded_and_does_not_retry_transfer(self):
        result, report, _, _, upload, reads, _ = self.execute(
            [table(), table(), RuntimeError("No response"), RuntimeError("No response")])
        self.assertEqual(result, 1)
        self.assertEqual(reads.call_count, 4)
        upload.assert_called_once()
        self.assertTrue(report["transfer_complete"])

    def test_cancel_and_preflight_failures_do_not_upload(self):
        self.args.yes = False
        with patch("builtins.input", return_value="cancel"):
            result, _, _, _, upload, _, _ = self.execute([table()])
        self.assertEqual(result, 1)
        upload.assert_not_called()
        self.args.yes = True
        for address, value in ((40, 1), (55, 0), (65, 4), (4, 8)):
            data = bytearray(table()); data[address] = value
            with self.subTest(address=address):
                result, _, _, _, upload, _, _ = self.execute([bytes(data)])
                self.assertEqual(result, 1)
                upload.assert_not_called()

    def test_transfer_failure_and_interrupt_leave_report_and_close_port(self):
        for error, code in ((RuntimeError("Lost ACK"), 1), (KeyboardInterrupt(), 130)):
            result, report, _, serial, upload, _, _ = self.execute(upload_error=error)
            self.assertEqual(result, code)
            self.assertNotIn("transfer_complete", report)
            upload.assert_called_once()
            serial.return_value.__exit__.assert_called_once()


if __name__ == "__main__":
    unittest.main()
