"""Capture both 1 KiB physical pages through a read-only test-firmware window."""

import argparse
import datetime
import hashlib
import json

import serial

from servo_bus import exchange, packet


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", required=True)
    parser.add_argument("--firmware", required=True,
                        help="exact flash-dump test image used for this capture")
    parser.add_argument("--output-bin", required=True)
    parser.add_argument("--output-json", required=True)
    parser.add_argument("--id", type=int, default=2)
    parser.add_argument("--allow-encoder-error", action="store_true")
    args = parser.parse_args()
    with open(args.firmware, "rb") as firmware:
        test_image_hash = hashlib.sha256(firmware.read()).hexdigest()
    operations = []
    allowed_status = (0, 2) if args.allow_encoder_error else (0,)

    with serial.Serial(args.port, 1000000, timeout=0.02) as port:
        def read(start, count):
            command = packet(args.id, 2, (start, count))
            response = exchange(port, command)
            assert response[2] == args.id and response[3] == count + 2
            assert response[4] in allowed_status, f"status {response[4]:02x}"
            return response[5:-1]

        def select(index):
            command = packet(args.id, 3, (50, index))
            response = exchange(port, command)
            assert response[2] == args.id and response[3] == 2
            assert response[4] in allowed_status, f"status {response[4]:02x}"

        original = read(50, 1)[0]
        try:
            captures = []
            for pass_number in range(2):
                data = bytearray()
                for index in range(147):
                    select(index)
                    block = read(73, 14)
                    assert len(block) == 14
                    data.extend(block)
                capture = bytes(data[:0x800])
                captures.append(capture)
                operations.append({"pass": pass_number,
                                   "sha256": hashlib.sha256(capture).hexdigest(),
                                   "length": len(capture)})
            assert captures[0] == captures[1], "repeat captures differ"
        finally:
            select(original)
            assert read(50, 1) == bytes((original,))

    with open(args.output_bin, "wb") as destination:
        destination.write(captures[0])
    result = {
        "captured_utc": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "port": args.port, "servo_id": args.id,
        "diagnostic_image_sha256": test_image_hash,
        "address_start": "0x08007000", "length": len(captures[0]),
        "readback_sha256": hashlib.sha256(captures[0]).hexdigest(),
        "passes": operations, "window_registers": "73..86",
        "selector_register": 50, "selector_restored": True,
        "writes_to_flash": False,
        "allowed_status": list(allowed_status),
        "physical_pages": [
            {"start": f"0x{0x08007000 + offset:08x}",
             "sha256": hashlib.sha256(captures[0][offset:offset + 1024]).hexdigest(),
             "non_ff_bytes": sum(byte != 0xFF for byte in
                                 captures[0][offset:offset + 1024])}
            for offset in (0, 1024)
        ],
    }
    with open(args.output_json, "w", encoding="utf-8") as destination:
        json.dump(result, destination, indent=2)
        destination.write("\n")
    print(json.dumps({"readback_sha256": result["readback_sha256"],
                      "passes_match": True, "selector_restored": True}))


if __name__ == "__main__":
    main()
