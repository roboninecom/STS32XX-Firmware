"""Read the timing-profile RX high-water and response-timeout counters."""
import argparse
import datetime
import hashlib
import json
import time

import serial

from servo_bus import exchange, packet


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', required=True)
    parser.add_argument('--firmware', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--id', type=int, default=2)
    args = parser.parse_args()
    image_hash = hashlib.sha256(open(args.firmware, 'rb').read()).hexdigest()
    result = {'captured_utc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
              'diagnostic_image_sha256': image_hash, 'port': args.port,
              'servo_id': args.id, 'operations': []}
    with serial.Serial(args.port, 1000000, timeout=0.02) as bus:
        for attempt in range(3):
            try:
                exchange(bus, packet(args.id, 1, ()))
                break
            except TimeoutError:
                if attempt == 2:
                    raise
                time.sleep(0.1)
        def command(instruction, params, label):
            request = packet(args.id, instruction, params)
            response = exchange(bus, request)
            assert response[2] == args.id and response[4] == 0, (label, response.hex())
            result['operations'].append({'label': label, 'tx_hex': request.hex(),
                                         'rx_hex': response.hex()})
            return response[5:-1]

        original = command(2, (50, 1), 'selector_before')[0]
        try:
            command(3, (50, 201), 'select_occupancy')
            data = command(2, (56, 22), 'counters')
            u16 = lambda i: int.from_bytes(data[i:i + 2], 'little')
            result['max_rx_occupancy_bytes'] = u16(11)
            result['response_timeouts'] = u16(13)
            result['max_pair_latency_us'] = u16(15)
            result['max_timer_late_us'] = u16(17)
            result['uart_overflows'] = data[21]
        finally:
            command(3, (50, original), 'restore_selector')
        result['restored'] = command(2, (50, 1), 'selector_restored') == bytes((original,))
    with open(args.output, 'w') as output:
        json.dump(result, output, indent=2)
        output.write('\n')
    assert result['restored']
    print(json.dumps({key: result[key] for key in (
        'max_rx_occupancy_bytes', 'response_timeouts',
        'max_pair_latency_us', 'max_timer_late_us', 'uart_overflows')}))


if __name__ == '__main__':
    main()
