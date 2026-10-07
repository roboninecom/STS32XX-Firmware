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
# Check the enlarged compile-time stack reserve as well as the flash image.
symbol_text = subprocess.check_output([readelf_tool, "-sW", str(elf)], text=True)
symbols = {}
for line in symbol_text.splitlines():
    fields = line.split()
    if len(fields) >= 8 and fields[0].endswith(":") and re.fullmatch(r"[0-9a-fA-F]+", fields[1]):
        symbols[fields[7]] = int(fields[1], 16)
# Sensor acquisition runs in these IRQs in every image profile. Verify the
# actual vector contents, not merely that the handlers survived linking.
for slot, name in ((15, "SysTick_Handler"), (25, "DMA_Channel0_IRQHandler"),
                   (26, "DMA_Channel1_2_IRQHandler"), (39, "I2C0_EV_IRQHandler"),
                   (48, "I2C0_ER_IRQHandler")):
    vector = struct.unpack_from("<I", blob, slot * 4)[0]
    assert vector == symbols[name] | 1, (name, hex(vector))
    assert vector != symbols["Default_Handler"] | 1, name
assert symbols["_end"] + symbols["_min_stack"] <= 0x20001000
assert symbols["_min_stack"] >= 1280
print(f"Image: {len(blob)} bytes; SP=0x{stack:08x}, reset=0x{reset:08x}; bounds OK")
