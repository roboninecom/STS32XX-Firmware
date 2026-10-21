'use strict';

const {
  StsServo, SerialTransport, PacketEncoder, Instruction, BROADCAST_ID,
} = require('../../../../host/servo-driver');
const { setTimeout: delay } = require('node:timers/promises');

const now = () => process.hrtime.bigint();
const ms = (start, end) => Number(end - start) / 1e6;

class TimedTransport extends SerialTransport {
  async write(data) {
    const trace = this.activeTrace;
    if (trace) trace.writeStarted = now();
    try {
      await super.write(data);
      if (trace) trace.drainCompleted = now();
    } catch (error) {
      if (trace) trace.writeError = error.name;
      throw error;
    }
  }
}

class Rig {
  constructor({ port, baudRate, factoryId, candidateId, timeoutMs = 180 }) {
    this.config = { port, baudRate, factoryId, candidateId, timeoutMs };
    this.transport = new TimedTransport({ path: port, baudRate });
    this.servo = new StsServo({ transport: this.transport });
    this.events = [];
  }

  async open() { await this.servo.open(); }
  async close() { await this.servo.close(); }

  async setHostBaud(baudRate) {
    const started = now();
    const previous = this.transport.config.baudRate;
    const record = { label: `host-baud:${previous}->${baudRate}`, kind: 'host',
      outcome: 'updated', baudRate };
    try {
      await this.transport.updateBaudRate(baudRate);
      this.servo.protocol.setBaudRate(baudRate);
    } catch (error) {
      record.outcome = 'error';
      record.error = { name: error.name, message: error.message };
      throw error;
    } finally {
      record.timingMs = { total: ms(started, now()) };
      this.events.push(record);
    }
  }

  async exchange(label, bytes, { kind = 'request', match, expectedIds, timeoutMs, strict = true } = {}) {
    const packet = Buffer.from(bytes);
    const queued = now();
    const record = {
      label, packet: packet.toString('hex'), kind, timeoutMs: timeoutMs ?? this.config.timeoutMs,
    };
    try {
      return await this.servo.scheduler.transaction(async wire => {
        const trace = { frames: [] };
        const started = now();
        const onData = chunk => { if (!trace.firstRx) trace.firstRx = now(); trace.rxBytes = (trace.rxBytes ?? 0) + chunk.length; };
        const onPacket = response => {
          const captured = {
            id: response.id,
            error: response.error,
            parameters: response.parameters.toString('hex'),
            at: now(),
          };
          trace.frames.push(captured);
          if (!trace.matched && match?.(response)) trace.matched = captured.at;
        };
        this.transport.activeTrace = trace;
        this.transport.prependListener('data', onData);
        this.servo.scheduler.decoder.on('packet', onPacket);
        try {
          let result;
          if (kind === 'send') result = await wire.send(packet);
          else if (kind === 'capture') {
            await wire.send(packet);
            await delay(record.timeoutMs);
            result = { frames: trace.frames.map(({ at, ...frame }) => ({
              ...frame, elapsedMs: ms(started, at),
            })) };
          }
          else if (kind === 'collect') result = await wire.collect(packet, {
            match, expectedIds, strict, timeoutMs: record.timeoutMs,
          });
          else result = await wire.request(packet, { match, timeoutMs: record.timeoutMs });
          record.outcome = kind === 'send' ? 'sent' :
            kind === 'capture' ? (trace.frames.length ? 'response' : 'silence') :
            kind === 'collect' && result.responses?.size === 0 ? 'silence' : 'response';
          return result;
        } catch (error) {
          record.outcome = error.name.includes('Timeout') || error.name.includes('MissingResponse')
            ? 'timeout' : 'error';
          record.error = { name: error.name, message: error.message };
          throw error;
        } finally {
          const finished = now();
          record.timingMs = {
            queue: ms(queued, started),
            total: ms(started, finished),
            writeDrain: trace.drainCompleted && trace.writeStarted
              ? ms(trace.writeStarted, trace.drainCompleted) : null,
            firstRx: trace.firstRx ? ms(started, trace.firstRx) : null,
            matchedFrame: trace.matched ? ms(started, trace.matched) : null,
          };
          record.rxBytes = trace.rxBytes ?? 0;
          record.frames = trace.frames.map(({ at, ...frame }) => ({
            ...frame, elapsedMs: ms(started, at),
          }));
          this.servo.scheduler.decoder.off('packet', onPacket);
          this.transport.off('data', onData);
          this.transport.activeTrace = null;
          this.events.push(record);
        }
      });
    } catch (error) {
      if (!this.events.includes(record)) this.events.push({ ...record, outcome: 'error', error: error.message });
      throw error;
    }
  }

  ping(id) {
    return this.exchange(`ping:${id}`, PacketEncoder.frame(id, Instruction.PING), {
      match: response => response.id === id && response.parameters.length === 0,
    });
  }

  read(id, address, length) {
    return this.exchange(`read:${id}:${address}:${length}`,
      PacketEncoder.frame(id, Instruction.READ, [address, length]), {
        match: response => response.id === id && response.parameters.length === length,
      }).then(response => response.parameters);
  }

  write(id, address, data) {
    return this.exchange(`write:${id}:${address}`,
      PacketEncoder.frame(id, Instruction.WRITE, [address, ...data]), {
        match: response => response.id === id && response.parameters.length === 0,
      });
  }

  command(id, instruction, parameters = [], options = {}) {
    return this.exchange(`command:${id}:${instruction.toString(16)}`,
      PacketEncoder.frame(id, instruction, parameters), {
        match: response => response.id === id && response.parameters.length === 0,
        ...options,
      });
  }

  async reset(id, recoveryId = id) {
    await this.exchange(`system-reset:${id}`, PacketEncoder.frame(id, Instruction.SYSTEM_RESET),
      { kind: 'send' });
    const deadline = Date.now() + 3000;
    let lastError;
    // The device is deliberately offline while booting. Keep those expected
    // probes separate from ordinary PING timing/timeout measurements.
    await delay(750);
    while (Date.now() < deadline) {
      try {
        return await this.exchange(`reset-recovery-ping:${id}->${recoveryId}`,
          PacketEncoder.frame(recoveryId, Instruction.PING), {
            match: response => response.id === recoveryId && response.parameters.length === 0,
          });
      }
      catch (error) { lastError = error; }
      await delay(50);
    }
    throw new Error(`servo ${id} did not recover as ID ${recoveryId} after reset: ${lastError?.message}`);
  }

  setOffset(id, position) {
    if (!Number.isInteger(position) || position < -4095 || position > 4095) {
      throw new RangeError('offset target must be an integer from -4095 to 4095');
    }
    const value = position & 0xffff;
    return this.command(id, Instruction.POSITION_CALIBRATE, [value & 0xff, value >> 8]);
  }

  async expectSilence(label, bytes, id, timeoutMs = 55) {
    const result = await this.exchange(label, bytes, {
      kind: 'collect', expectedIds: [id], strict: false, timeoutMs,
      match: response => response.id === id,
    });
    return result.responses.size === 0;
  }

  syncRead(ids, address, length, options = {}) {
    return this.exchange(`sync-read:${ids.join(',')}:${address}:${length}`,
      PacketEncoder.syncRead(Instruction.SYNC_READ, ids, address, length), {
        kind: 'collect', expectedIds: options.expectedIds ?? ids,
        match: response => ids.includes(response.id) && response.parameters.length === (options.replyLength ?? length),
        timeoutMs: options.timeoutMs ?? this.config.timeoutMs,
        strict: options.strict ?? true,
      });
  }

  syncWrite(address, dataLength, id, data) {
    const params = Buffer.concat([Buffer.from([address, dataLength, id]), Buffer.from(data)]);
    return this.exchange(`sync-write:${id}:${address}:${dataLength}`,
      PacketEncoder.frame(BROADCAST_ID, Instruction.SYNC_WRITE, params), { kind: 'send' });
  }

  async health(ids = [this.config.factoryId, this.config.candidateId]) {
    for (const id of ids) await this.ping(id);
  }
}

module.exports = { Rig, TimedTransport };
