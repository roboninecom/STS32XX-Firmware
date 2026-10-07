"""Verify the selected target artifact describes its own isolated profile."""
from pathlib import Path
import hashlib
import sys

folder = Path(sys.argv[1])
manifest = (folder / "manifest.txt").read_text().splitlines()
assert manifest[0] == f"profile={folder.name}"
assert any(line.startswith("compiler=") for line in manifest)
flags = next(line.removeprefix("flags=") for line in manifest if line.startswith("flags="))
expected = {
    "MOTOR_TEST": "motor-test" in folder.name,
    "TIMING_PROBE": "-timing" in folder.name,
    "ARM_TIMING_PROBE": "-timing-arm" in folder.name,
    "FLASH_DUMP": "-flash-dump" in folder.name,
}
for macro, enabled in expected.items():
    assert (f"-DFW_{macro}" in flags) == enabled, (folder, macro)
assert "REWRITE_" not in flags and "FLASH_PROBE" not in flags, (folder, flags)
assert "FW_MOTOR_ENABLED" not in flags, (folder, flags)
firmware = folder / "firmware.bin"
expected_hash = hashlib.sha256(firmware.read_bytes()).hexdigest()
assert any(line.startswith(expected_hash + "  ") for line in manifest)
print(f"Profile {folder.name}: flags and image hash OK")
