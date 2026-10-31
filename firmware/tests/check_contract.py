"""Check register contract tables and preserve captured wire bytes exactly."""
import csv
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def checked_packet(raw: bytes, *, response: bool) -> bytes:
    assert len(raw) >= 6 and raw[:2] == b"\xff\xff"
    assert len(raw) == raw[3] + 4
    assert (sum(raw[2:]) & 0xFF) == 0xFF
    assert raw[2] == 2
    if response:
        assert raw[4] == 0
    return raw[5:-1]


def main() -> None:
    fixture = json.loads((ROOT / "tests/fixtures/initial-wire.json").read_text())
    rows = list(csv.DictReader((ROOT / "tests/fixtures/register-contract.csv").open(newline="")))
    assert len(rows) == 88
    assert [int(row["address_decimal"]) for row in rows] == list(range(88))
    assert all(row["access"] == "none" for row in rows[87:])
    assert all(row["access"] == "read" for row in rows[56:78])
    assert all(row["storage"] == "persistent" for row in rows[78:87])
    assert [int(row["persistence_mapping"]) for row in rows[78:87]] == list(range(40, 49))

    exchanges = fixture["exchanges"]
    assert [x["name"] for x in exchanges] == ["ping", "read_0_86"]
    assert checked_packet(bytes.fromhex(exchanges[0]["request_hex"]), response=False) == b""
    assert checked_packet(bytes.fromhex(exchanges[0]["response_hex"]), response=True) == b""
    assert checked_packet(bytes.fromhex(exchanges[1]["request_hex"]), response=False) == b"\x00\x57"
    values = checked_packet(bytes.fromhex(exchanges[1]["response_hex"]), response=True)
    assert len(values) == 87
    assert [row["preflash_observed_byte_hex"] for row in rows[:87]] == [f"0x{value:02x}" for value in values]
    print("Contract table and captured packets: OK")


if __name__ == "__main__":
    main()
