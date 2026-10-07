"""Pin the read-only target storage fixture used by the power-cut model."""

from pathlib import Path
import hashlib
import json

base = Path("tests/fixtures/2026-09-25-target-storage-readback")
raw = base.with_suffix(".bin").read_bytes()
metadata = json.loads(base.with_suffix(".json").read_text())
assert len(raw) == metadata["length"] == 2048
assert hashlib.sha256(raw).hexdigest() == metadata["readback_sha256"]
assert all(item["sha256"] == metadata["readback_sha256"]
           for item in metadata["passes"])
assert metadata["selector_restored"] and not metadata["writes_to_flash"]
for index, page in enumerate(metadata["physical_pages"]):
    content = raw[index * 1024:(index + 1) * 1024]
    assert hashlib.sha256(content).hexdigest() == page["sha256"]
    assert sum(byte != 0xFF for byte in content) == page["non_ff_bytes"]
assert all(byte == 0xFF for byte in raw[:1024])
assert raw[1024:1026] == b"\x00\x00"
assert raw[1536:1538] == b"\xff\xff"
print("Read-only storage fixture: OK")
