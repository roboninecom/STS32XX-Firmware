'use strict';
const { setTimeout: delay } = require('node:timers/promises');
const { SerialTransport, RequestScheduler } = require('../servo-driver');
const now = () => process.hrtime.bigint();
const ms = (from, to = now()) => Number(to - from) / 1e6;

class MeasuredTransport extends SerialTransport {
  async write(packet) {
    this.emit('writeStarted', now());
    await super.write(packet);
    this.emit('writeDrained', now());
  }
}

class Probe {
  constructor(transport, timeoutMs) {
    this.transport = transport;
    this.timeoutMs = timeoutMs;
    this.scheduler = new RequestScheduler(transport);
    this.idleFrames = [];
    this.lastRx = now();
    transport.on('data', () => { this.lastRx = now(); });
    this.scheduler.on('unsolicitedPacket', frame => {
      if (!this.active) this.idleFrames.push({ at: new Date().toISOString(),
        id: frame.id, status: frame.error, data: frame.parameters.toString('hex') });
    });
  }

  async measure(id, packet, responseBytes) {
    const trace = { txHex: packet.toString('hex'), unexpectedFrames: 0, duplicateFrames: 0, diagnostics: [], rxChunks: [], frames: [] };
    const entered = now();
    let started = entered, firstRx, matched, drained, response;
    const writeStarted = at => { started = at; };
    const writeDrained = at => { drained = at; };
    const data = chunk => { firstRx ??= now(); trace.rxChunks.push(chunk.toString('hex')); };
    const matches = frame => frame.id === id && frame.parameters.length === responseBytes;
    const frame = value => {
      trace.frames.push({ id: value.id, status: value.error, parameters: value.parameters.toString('hex'), atMs: ms(started) });
      if (matches(value)) {
        if (matched) ++trace.duplicateFrames;
        else matched = now();
      }
      else ++trace.unexpectedFrames;
    };
    const diagnostic = value => trace.diagnostics.push(value);
    this.active = true;
    this.transport.on('writeStarted', writeStarted);
    this.transport.on('writeDrained', writeDrained);
    this.transport.prependListener('data', data);
    this.scheduler.decoder.on('packet', frame);
    this.scheduler.on('diagnostic', diagnostic);
    try {
      response = await this.scheduler.request(packet, { match: matches, timeoutMs: this.timeoutMs });
      trace.outcome = response.error ? 'status-error' : 'ok';
      trace.status = response.error;
      trace.rxParameters = response.parameters.toString('hex');
    } catch (error) {
      trace.outcome = error.name === 'RequestTimeoutError' ? 'timeout' : 'transport-error';
      trace.error = { name: error.name, message: error.message };
    } finally {
      trace.latencyMs = response && matched ? ms(started, matched) : null;
      trace.firstRxMs = firstRx ? ms(started, firstRx) : null;
      trace.writeDrainMs = drained ? ms(started, drained) : null;
      trace.transactionMs = ms(entered);
      this.transport.off('writeStarted', writeStarted);
      this.transport.off('writeDrained', writeDrained);
      this.transport.off('data', data);
      this.scheduler.decoder.off('packet', frame);
      this.scheduler.off('diagnostic', diagnostic);
      this.active = false;
    }
    return trace;
  }

  async recover() {
    // No sequence numbers on this protocol. Require a full timeout of silence
    // before issuing another request; never count an automatic retry as success.
    for (let attempt = 0; attempt < 4; attempt++) {
      await delay(this.timeoutMs);
      if (ms(this.lastRx) >= this.timeoutMs) {
        this.scheduler.decoder.reset();
        return;
      }
    }
    throw new Error('Bus did not become quiet after timeout; stopping to avoid stale replies');
  }
}
module.exports = { Probe, MeasuredTransport };
