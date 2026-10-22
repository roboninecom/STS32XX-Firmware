"""Bounded reads without changing serial settings during a transaction.

Open ports with timeout=0. Deadlines belong to the protocol, not to the UART:
on macOS, assigning pyserial's timeout can reapply the custom baud rate while
the response is already arriving. No private pyserial overrides are needed.
"""

import time

POLL_INTERVAL = 0.001


def read_exact(ser, size, timeout):
    """Read up to size bytes before a monotonic deadline; return partial data."""
    deadline = time.monotonic() + timeout
    data = bytearray()
    while len(data) < size:
        chunk = ser.read(size - len(data))
        data.extend(chunk)
        if len(data) == size:
            break
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            break
        if not chunk:
            time.sleep(min(POLL_INTERVAL, remaining))
    return bytes(data)


def read_until_ack(ser, timeout):
    """Collect bootloader bytes until ACK (0x06) or the deadline, without reset."""
    deadline = time.monotonic() + timeout
    data = bytearray()
    while True:
        chunk = ser.read(max(1, ser.in_waiting))
        data.extend(chunk)
        if 0x06 in chunk:
            return True, bytes(data)
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            return False, bytes(data)
        time.sleep(min(POLL_INTERVAL, remaining))
