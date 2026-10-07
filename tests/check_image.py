"""Check the phase-2 image against bootloader and memory boundaries."""
import re
import struct
import subprocess
import sys
from pathlib import Path

elf, binary = map(Path, sys.argv[1:3])
readelf_tool = sys.argv[3]
blob = binary.read_bytes()
assert len(blob) <= 0x7000, "application overlaps physical storage backup"
stack, reset = struct.unpack_from("<II", blob)
assert stack == 0x20001000, hex(stack)
assert reset & 1, f"reset handler must be a Thumb address: {reset:#x}"
reset_offset = (reset & ~1) - 0x08000000
assert 0xCC <= reset_offset < len(blob) - 1, hex(reset)
assert blob[reset_offset:reset_offset + 2] != b"\xff\xff"

readelf = subprocess.check_output([readelf_tool, "-S", str(elf)], text=True)
for forbidden in (".eeprom", ".boot"):
    assert not re.search(r"\]\s+" + forbidden + r"\s", readelf)
print(f"Image: {len(blob)} bytes; SP=0x{stack:08x}, reset=0x{reset:08x}; bounds OK")
