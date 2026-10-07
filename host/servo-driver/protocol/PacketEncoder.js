'use strict';

const { BROADCAST_ID } = require('./constants');
const { InvalidPacketError } = require('./errors');

const MAX_PARAMETERS = 0xFD;

function checksum(buffer, start = 2, end = buffer.length) {
  let sum = 0;
  for (let index = start; index < end; index += 1) sum = (sum + buffer[index]) & 0xFF;
  return (~sum) & 0xFF;
}

function frame(id, instruction, parameters = Buffer.alloc(0)) {
  const params = Buffer.isBuffer(parameters) ? parameters : Buffer.from(parameters);
  if (!Number.isInteger(id) || id < 0 || id > BROADCAST_ID) {
    throw new InvalidPacketError(`Invalid STS ID ${id}`);
  }
  if (!Number.isInteger(instruction) || instruction < 0 || instruction > 0xFF) {
    throw new InvalidPacketError(`Invalid STS instruction ${instruction}`);
  }
  if (params.length > MAX_PARAMETERS) {
    throw new InvalidPacketError(`STS packet has ${params.length} parameter bytes; maximum is ${MAX_PARAMETERS}`);
  }

  const packet = Buffer.allocUnsafe(params.length + 6);
  packet[0] = 0xFF;
  packet[1] = 0xFF;
  packet[2] = id;
  packet[3] = params.length + 2;
  packet[4] = instruction;
  params.copy(packet, 5);
  packet[packet.length - 1] = checksum(packet, 2, packet.length - 1);
  return packet;
}

function syncRead(instruction, ids, address, length) {
  const parameters = Buffer.allocUnsafe(ids.length + 2);
  parameters[0] = address;
  parameters[1] = length;
  for (let index = 0; index < ids.length; index += 1) parameters[index + 2] = ids[index];
  return frame(BROADCAST_ID, instruction, parameters);
}

function syncWrite(instruction, address, entries) {
  const dataLength = entries[0].data.length;
  const parameters = Buffer.allocUnsafe(2 + entries.length * (dataLength + 1));
  parameters[0] = address;
  parameters[1] = dataLength;
  let offset = 2;
  for (const { id, data } of entries) {
    parameters[offset] = id;
    data.copy(parameters, offset + 1);
    offset += dataLength + 1;
  }
  return frame(BROADCAST_ID, instruction, parameters);
}

module.exports = { checksum, frame, syncRead, syncWrite, MAX_PARAMETERS };
