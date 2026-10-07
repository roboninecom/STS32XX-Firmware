"""Small checksum-validating STS bus helpers shared by hardware probes."""

import time


def packet(device_id, instruction, params):
    body = bytes((device_id, len(params) + 2, instruction)) + bytes(params)
    return b"\xff\xff" + body + bytes((~sum(body) & 0xFF,))


def exchange(port, command, timeout=0.2):
    port.reset_input_buffer()
    port.write(command)
    port.flush()
    deadline = time.monotonic() + timeout
    data = bytearray()
    while time.monotonic() < deadline:
        data.extend(port.read(128))
        marker = data.find(b"\xff\xff")
        if marker >= 0 and len(data) >= marker + 4:
            total = data[marker + 3] + 4
            if len(data) >= marker + total:
                response = bytes(data[marker:marker + total])
                if (sum(response[2:]) & 0xFF) != 0xFF:
                    raise ValueError(f"bad checksum: {response.hex()}")
                return response
    raise TimeoutError(f"no complete reply: {data.hex()}")


def extended_exchange(port, command, timeout=3.0):
    """Flash commits can exceed the ordinary protocol response timeout."""
    return exchange(port, command, timeout)
