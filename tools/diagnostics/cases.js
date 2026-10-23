'use strict';
const { PacketEncoder, Instruction } = require('../../host/servo-driver');

function cases(readOnly = false) {
  const result = [{ name: 'ping', packet: id => PacketEncoder.frame(id, Instruction.PING), responseBytes: 0 }];
  for (const length of [1, 2, 4, 8, 16, 32, 64, 87]) result.push({
    name: `read-table-${length}`, responseBytes: length,
    packet: id => PacketEncoder.frame(id, Instruction.READ, [0, length]),
  });
  for (const length of [2, 8, 22, 31]) result.push({
    name: `read-telemetry-${length}`, responseBytes: length,
    packet: id => PacketEncoder.frame(id, Instruction.READ, [56, length]),
  });
  if (!readOnly) for (const length of [1, 2, 4]) for (const pattern of ['zero', 'alternating', 'counter']) {
    const payload = iteration => Buffer.from(Array.from({ length }, (_, index) =>
      pattern === 'zero' ? 0 : pattern === 'alternating' ? ((iteration + index) % 2 ? 0x55 : 0xaa)
        : (iteration + index) % 0xfe)); // Avoid embedded FF FF resynchronization, tested elsewhere.
    result.push({ name: `write-ram-${length}-${pattern}`, responseBytes: 0, writes: true, payload,
      packet: (id, iteration) => PacketEncoder.frame(id, Instruction.WRITE, [51, ...payload(iteration)]) });
  }
  return result;
}
module.exports = { cases };
