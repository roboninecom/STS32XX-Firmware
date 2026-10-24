'use strict';

const { EventEmitter } = require('node:events');
const { frame, syncRead: encodeSyncRead, syncWrite: encodeSyncWrite } = require('./PacketEncoder');
const { BROADCAST_ID, DeviceAlarm, MAX_SERVO_ID, Instruction } = require('./constants');
const { InvalidPacketError, ServoStatusError } = require('./errors');
const { BusTimeouts } = require('../session/BusTimeouts');
const { Priority } = require('../session/RequestScheduler');

class StsProtocol extends EventEmitter {
  constructor(scheduler, {
    baudRate = 1_000_000,
    timing,
    discoveryTimeoutMs,
    discoverySilenceMs = 3,
  } = {}) {
    super();
    if (!scheduler?.request || !scheduler?.collect) throw new TypeError('A request scheduler is required');
    this.scheduler = scheduler;
    this.options = { baudRate, timing, discoveryTimeoutMs, discoverySilenceMs };
    this.timeouts = new BusTimeouts({ baudRate, ...timing });
    this.discoveryTimeoutMs = discoveryTimeoutMs;
    this.discoverySilenceMs = discoverySilenceMs;
  }

  async ping(id = BROADCAST_ID, options = {}) {
    assertId(id, true);
    const packet = frame(id, Instruction.PING);
    if (id === BROADCAST_ID) {
      const result = await this.scheduler.collect(packet, {
        match: response => response.id <= MAX_SERVO_ID && response.parameters.length === 0,
        timeoutMs: options.timeoutMs ?? this.discoveryTimeoutMs ?? this.timeouts.discovery(),
        // Factory broadcast-ping replies are slotted by numeric servo ID. A
        // short quiet gap is therefore not evidence that discovery is done.
        silenceMs: options.silenceMs ?? null,
        strict: false,
      }, { priority: options.priority ?? Priority.NORMAL });
      const alarms = new Map();
      for (const response of result.responses.values()) {
        if (response.error) alarms.set(response.id, decodeDeviceAlarms(response.error));
      }
      return { ...result, ids: [...result.responses.keys()], alarms, statusErrors: alarms };
    }
    const response = await this.#request(id, packet, 0, options);
    return statusResult(response);
  }

  async read(id, address, length = 1, options = {}) {
    assertId(id);
    assertByte(address, 'address');
    assertLength(length);
    assertRegisterRange(address, length);
    const packet = frame(id, Instruction.READ, Buffer.from([address, length]));
    const response = await this.#request(id, packet, length, options);
    options.onStatus?.(statusResult(response));
    return response.parameters;
  }

  async syncRead(ids, address, length = 1, options = {}) {
    const normalizedIds = normalizeIds(ids);
    assertByte(address, 'address');
    assertLength(length);
    assertRegisterRange(address, length);
    const packet = encodeSyncRead(Instruction.SYNC_READ, normalizedIds, address, length);
    const result = await this.scheduler.collect(packet, {
      expectedIds: normalizedIds,
      match: response => normalizedIds.includes(response.id) &&
        response.parameters.length === length,
      strict: options.strict ?? true,
      timeoutMs: options.timeoutMs ?? this.timeouts.multiple(packet.length, normalizedIds.length, length),
    }, {
      priority: options.priority ?? Priority.NORMAL,
      coalesceKey: options.coalesceKey,
    });

    const responses = new Map();
    const alarms = new Map();
    for (const [servoId, response] of result.responses) {
      checkStatus(response, options);
      if (response.error) alarms.set(servoId, decodeDeviceAlarms(response.error));
      responses.set(servoId, response.parameters);
    }
    return { ...result, responses, alarms };
  }

  async write(id, address, data, options = {}) {
    assertId(id, true);
    assertByte(address, 'address');
    const bytes = normalizeData(data, 127);
    assertRegisterRange(address, bytes.length);
    const parameters = Buffer.allocUnsafe(bytes.length + 1);
    parameters[0] = address;
    bytes.copy(parameters, 1);
    const packet = frame(id, Instruction.WRITE, parameters);
    const expectResponse = options.expectResponse ?? id !== BROADCAST_ID;
    if (!expectResponse) return this.scheduler.send(packet, { priority: options.priority ?? Priority.NORMAL });
    return statusResult(await this.#request(id, packet, 0, options));
  }

  syncWrite(address, entries, options = {}) {
    assertByte(address, 'address');
    const normalized = normalizeEntries(entries);
    assertRegisterRange(address, normalized[0].data.length);
    const packet = encodeSyncWrite(Instruction.SYNC_WRITE, address, normalized);
    return this.scheduler.send(packet, { priority: options.priority ?? Priority.MOTION });
  }

  async regWrite(id, address, data, options = {}) {
    assertId(id);
    assertByte(address, 'address');
    const bytes = normalizeData(data, 127);
    assertRegisterRange(address, bytes.length);
    const parameters = Buffer.allocUnsafe(bytes.length + 1);
    parameters[0] = address;
    bytes.copy(parameters, 1);
    const packet = frame(id, Instruction.REG_WRITE, parameters);
    if (options.expectResponse === false) {
      return this.scheduler.send(packet, { priority: options.priority ?? Priority.NORMAL });
    }
    return statusResult(await this.#request(id, packet, 0, options));
  }

  async action(id = BROADCAST_ID, options = {}) {
    assertId(id, true);
    const packet = frame(id, Instruction.ACTION);
    if (id === BROADCAST_ID || options.expectResponse === false) {
      return this.scheduler.send(packet, { priority: options.priority ?? Priority.MOTION });
    }
    return statusResult(await this.#request(id, packet, 0, options));
  }

  async factoryReset(id, options = {}) {
    assertId(id);
    this.emit('reset', id);
    const packet = frame(id, Instruction.FACTORY_RESET);
    const expectResponse = options.expectResponse ?? true;
    if (!expectResponse) {
      return this.scheduler.send(packet, { priority: options.priority ?? Priority.NORMAL });
    }
    return statusResult(await this.#request(id, packet, 0, options));
  }

  systemReset(id, options = {}) {
    assertId(id, options.allowBroadcast === true);
    this.emit('reset', id);
    return this.scheduler.send(frame(id, Instruction.SYSTEM_RESET), {
      priority: options.priority ?? Priority.NORMAL,
    });
  }

  reboot(id, options = {}) {
    return this.systemReset(id, options);
  }

  saveResetTemplate(id, options = {}) {
    return this.#statusCommand(id, Instruction.SAVE_RESET_TEMPLATE, Buffer.alloc(0), options);
  }

  encoderHome(id, options = {}) {
    return this.#statusCommand(id, Instruction.ENCODER_HOME, Buffer.alloc(0), options);
  }

  calibratePosition(id, desiredPosition = 0x0800, options = {}) {
    assertId(id);
    if (!Number.isInteger(desiredPosition) || desiredPosition < -4095 || desiredPosition > 4095) {
      throw new InvalidPacketError('desiredPosition must be between -4095 and 4095');
    }
    const parameters = Buffer.allocUnsafe(2);
    parameters.writeInt16LE(desiredPosition);
    return this.#statusCommand(id, Instruction.POSITION_CALIBRATE, parameters, options);
  }

  transaction(operation, options) {
    if (typeof operation !== 'function') throw new TypeError('transaction operation must be a function');
    return this.scheduler.transaction(
      wire => {
        const protocol = new StsProtocol(wire, this.options);
        protocol.on('reset', id => this.emit('reset', id));
        return operation(protocol);
      },
      options
    );
  }

  setBaudRate(baudRate) {
    if (!Number.isInteger(baudRate) || baudRate <= 0) {
      throw new RangeError('baudRate must be a positive integer');
    }
    this.options.baudRate = baudRate;
    this.timeouts = new BusTimeouts({ baudRate, ...this.options.timing });
  }

  async #request(id, packet, parameterLength, options, allowExtensionRejection = false) {
    const response = await this.scheduler.request(packet, {
      match: candidate => candidate.id === id &&
        (candidate.parameters.length === parameterLength ||
          (allowExtensionRejection && candidate.parameters.length === 1 &&
            candidate.parameters[0] !== 0)),
      timeoutMs: options.timeoutMs ?? this.timeouts.single(packet.length, parameterLength),
    }, { priority: options.priority ?? Priority.NORMAL,
         deadlineMs: options.deadlineMs });
    checkStatus(response, options);
    return response;
  }

  async #statusCommand(id, instruction, parameters, options) {
    assertId(id);
    const packet = frame(id, instruction, parameters);
    if (options.expectResponse === false) {
      return this.scheduler.send(packet, { priority: options.priority ?? Priority.NORMAL });
    }
    return statusResult(await this.#request(id, packet, 0, options));
  }

  async armCommand(id, instruction, parameters = Buffer.alloc(0), options = {}) {
    assertId(id, instruction === Instruction.ARM_TARGETS);
    if (!Number.isInteger(instruction) || instruction < Instruction.ARM_READ ||
        instruction > Instruction.ARM_TARGETS || instruction === 0x92 ||
        (instruction >= 0x93 && instruction <= 0x98)) {
      throw new InvalidPacketError('Invalid arm instruction');
    }
    if (!Buffer.isBuffer(parameters) || parameters.length > 80) {
      throw new InvalidPacketError('Arm parameters must be a Buffer of at most 80 bytes');
    }
    const expectedDataLength = options.expectedDataLength ?? 0;
    if (!Number.isInteger(expectedDataLength) || expectedDataLength < 0 || expectedDataLength > 80) {
      throw new InvalidPacketError('Expected arm data length must be between 0 and 80');
    }
    const packet = frame(id, instruction, parameters);
    if (id === BROADCAST_ID) {
      return this.scheduler.send(packet, {
        priority: options.priority ?? Priority.MOTION,
        deadlineMs: options.deadlineMs,
      });
    }
    // Failed extension reads contain only the extension status, with no data.
    // A short success is still malformed and must not satisfy the request.
    const response = await this.#request(id, packet,
        1 + expectedDataLength, options, true);
    const status = response.parameters[0];
    if (status !== 0) throw new InvalidPacketError(
      `Arm extension rejected command with status ${status}`,
      { id, instruction, extensionStatus: status });
    return response.parameters.subarray(1);
  }
}

function decodeDeviceAlarms(status) {
  const flags = [];
  for (const [name, mask] of Object.entries(DeviceAlarm)) if (status & mask) flags.push(name);
  return flags;
}

function decodeResponseError(status) {
  return decodeDeviceAlarms(status);
}

function statusResult(response) {
  return {
    id: response.id,
    status: response.error,
    alarms: decodeDeviceAlarms(response.error),
  };
}

function checkStatus(response, options = {}) {
  if (response.error && options.rejectOnAlarm === true) throw new ServoStatusError(
    response.id,
    response.error,
    decodeDeviceAlarms(response.error)
  );
}

function assertId(id, allowBroadcast = false) {
  const maximum = allowBroadcast ? BROADCAST_ID : MAX_SERVO_ID;
  if (!Number.isInteger(id) || id < 0 || id > maximum) {
    throw new InvalidPacketError(`Invalid STS ID ${id}`);
  }
}

function assertByte(value, name) {
  if (!Number.isInteger(value) || value < 0 || value > 0xFF) {
    throw new InvalidPacketError(`${name} must be a byte`);
  }
}

function assertLength(length) {
  if (!Number.isInteger(length) || length < 1 || length > 0x57) {
    throw new InvalidPacketError('length must be between 1 and 87');
  }
}

function assertRegisterRange(address, length) {
  if (address > 0x56 || address + length > 0x57) {
    throw new InvalidPacketError('register range must stay within 0x00..0x56');
  }
}

function normalizeData(data, maximumLength = 0xFD) {
  if (!Buffer.isBuffer(data) && !(data instanceof Uint8Array)) {
    throw new InvalidPacketError('data must be a Buffer or Uint8Array');
  }
  const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
  if (!buffer.length) throw new InvalidPacketError('data cannot be empty');
  if (buffer.length > maximumLength) {
    throw new InvalidPacketError(`data cannot exceed ${maximumLength} bytes`);
  }
  return buffer;
}

function normalizeIds(ids) {
  if (!Array.isArray(ids) || !ids.length) throw new InvalidPacketError('ids must be a non-empty array');
  for (const id of ids) assertId(id);
  if (new Set(ids).size !== ids.length) throw new InvalidPacketError('ids must be unique');
  return [...ids];
}

function normalizeEntries(entries) {
  if (!Array.isArray(entries) || !entries.length) {
    throw new InvalidPacketError('entries must be a non-empty array');
  }
  const normalized = entries.map(({ id, data } = {}) => {
    assertId(id);
    return { id, data: normalizeData(data, 125) };
  });
  const length = normalized[0].data.length;
  if (normalized.some(entry => entry.data.length !== length)) {
    throw new InvalidPacketError('sync-write entries must have equal data lengths');
  }
  if (new Set(normalized.map(entry => entry.id)).size !== normalized.length) {
    throw new InvalidPacketError('sync-write IDs must be unique');
  }
  return normalized;
}

module.exports = { StsProtocol, decodeDeviceAlarms, decodeResponseError };
