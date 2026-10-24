'use strict';
const { EventEmitter } = require('node:events');
const { PacketEncoder, Instruction } = require('../../../host/servo-driver');
const { MeasuredTransport } = require('../probe');
class FakePort extends EventEmitter {
  constructor() {
    super(); this.isOpen = false; this.writes = [];
    this.tables = new Map([1, 2].map(id => {
      const bytes = Buffer.alloc(87); bytes[5] = id; bytes[8] = 1; bytes[55] = 1; bytes[62] = 125; bytes[63] = 34;
      Buffer.from([3, 4, 5, 6]).copy(bytes, 51);
      return [id, bytes];
    }));
  }
  open(callback) { this.isOpen = true; callback(); }
  close(callback) { this.isOpen = false; callback(); this.emit('close'); }
  drain(callback) { setTimeout(callback, 2); }
  write(packet, callback) {
    this.writes.push(Buffer.from(packet));
    this.onRequest?.(packet);
    if (this.writeError) { callback(new Error(this.writeError)); return; }
    const id = packet[2], instruction = packet[4], table = this.tables.get(id);
    if (table && !this.silent) {
      if (instruction === Instruction.WRITE) packet.subarray(6, -1).copy(table, packet[5]);
      let data = instruction === Instruction.READ ? table.subarray(packet[5], packet[5] + packet[6]) : [];
      if (this.badReadback && instruction === Instruction.READ && this.writes.some(p => p[4] === Instruction.WRITE)) {
        data = Buffer.from(data); data[51] ^= 1;
      }
      const reply = PacketEncoder.frame(id, this.status ?? 0, data);
      if (this.corrupt) reply[reply.length - 1] ^= 1;
      this.emit('data', reply);
      if (this.duplicate) this.emit('data', reply); // Duplicate decoded response.
      // Response can precede the drain callback.
    }
    callback();
  }
}
const transportFor = port => new MeasuredTransport({ path: '/dev/fake', portFactory: () => port });

module.exports = { FakePort, transportFor };
