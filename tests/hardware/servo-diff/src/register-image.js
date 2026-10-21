'use strict';

function persistentBytes(bytes, omitOffset = false) {
  const values = [...bytes.subarray(4, 40), ...bytes.subarray(78, 87)];
  if (omitOffset) values.splice(31 - 4, 2);
  return values;
}

module.exports = { persistentBytes };
