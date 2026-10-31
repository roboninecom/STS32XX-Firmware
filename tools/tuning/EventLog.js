'use strict';
const fs = require('node:fs/promises');

// Serial I/O must not wait for a disk flush. Bound queued bytes, surface write
// failures on the next append, and confirm durability before the port closes.
class EventLog {
  static async open(filename) { return new EventLog(await fs.open(filename, 'wx')); }
  constructor(file, maxPendingBytes = 8 * 1024 * 1024) {
    this.file = file; this.maxPendingBytes = maxPendingBytes;
    this.pendingBytes = 0; this.tail = Promise.resolve(); this.failure = null;
  }
  write(event) {
    if (this.failure) throw this.failure;
    const line = JSON.stringify(event) + '\n', bytes = Buffer.byteLength(line);
    if (this.pendingBytes + bytes > this.maxPendingBytes) throw new Error('Tuning log queue exceeded its byte limit');
    this.pendingBytes += bytes;
    this.tail = this.tail.then(async () => {
      if (!this.failure) await this.file.writeFile(line);
    }).catch(error => { this.failure ??= error; }).finally(() => { this.pendingBytes -= bytes; });
  }
  async flush() {
    await this.tail;
    if (this.failure) throw this.failure;
    await this.file.sync();
  }
  async close() { await this.tail; await this.file.close(); }
}
module.exports = { EventLog };
