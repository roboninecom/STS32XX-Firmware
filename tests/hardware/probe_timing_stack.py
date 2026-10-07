"""Latch a diagnostic stack watermark after traffic and record status bytes."""

import argparse
import datetime
import hashlib
import json
import time

import serial

from servo_bus import exchange, packet


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", required=True)
    parser.add_argument("--firmware", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--id", type=int, default=2)
    args = parser.parse_args()
    with open(args.firmware, "rb") as image:
        image_hash = hashlib.sha256(image.read()).hexdigest()
    with serial.Serial(args.port, 1000000, timeout=0.02) as port:
        # The first request after opening this USB bridge can be lost.
        for attempt in range(3):
            try:
                exchange(port, packet(args.id, 1, ()))
                break
            except TimeoutError:
                if attempt == 2:
                    raise
                time.sleep(0.1)
        read_selector = packet(args.id, 2, (50, 1))
        before = exchange(port, read_selector)
        original = before[5]
        select = packet(args.id, 3, (50, 200))
        try:
            selected = exchange(port, select)
            read_status = packet(args.id, 2, (56, 22))
            status = exchange(port, read_status)
            assert selected[4] == 0 and status[4] in (0, 0x02)
        finally:
            restore = packet(args.id, 3, (50, original))
            restored = exchange(port, restore)
            assert restored[4] in (0, 0x02)
    data = status[5:-1]
    assert len(data) == 22
    u16 = lambda index: int.from_bytes(data[index:index + 2], "little")
    result = {"captured_utc": datetime.datetime.now(datetime.timezone.utc).isoformat(),
              "diagnostic_image_sha256": image_hash, "port": args.port,
              "servo_id": args.id, "select_tx_hex": select.hex(),
              "select_rx_hex": selected.hex(), "read_tx_hex": read_status.hex(),
              "read_rx_hex": status.hex(), "restore_tx_hex": restore.hex(),
              "restore_rx_hex": restored.hex(), "stack_used_upper_bound_bytes": u16(4),
              "rejected_pairs": u16(11), "last_rejected_raw": u16(13),
              "max_pair_latency_us": u16(15), "max_timer_late_us": u16(17),
              "completed_pairs_mod_65536": u16(19), "uart_overflow": data[21]}
    with open(args.output, "w", encoding="utf-8") as destination:
        json.dump(result, destination, indent=2)
        destination.write("\n")
    print(json.dumps({key: result[key] for key in (
        "stack_used_upper_bound_bytes", "rejected_pairs", "last_rejected_raw",
        "max_pair_latency_us", "max_timer_late_us", "uart_overflow")}))


if __name__ == "__main__":
    main()
