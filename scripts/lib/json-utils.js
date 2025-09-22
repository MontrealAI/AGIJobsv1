'use strict';

function serializeForJson(value) {
  if (value === null || value === undefined) {
    return value;
  }

  const valueType = typeof value;
  if (valueType === 'string' || valueType === 'number' || valueType === 'boolean') {
    return value;
  }

  if (valueType === 'bigint') {
    return value.toString();
  }

  if (Array.isArray(value)) {
    return value.map((entry) => serializeForJson(entry));
  }

  if (valueType === 'object') {
    if (value && typeof value.toString === 'function' && value.toString !== Object.prototype.toString) {
      const stringified = value.toString();
      if (stringified !== '[object Object]') {
        return stringified;
      }
    }

    return Object.entries(value).reduce((acc, [key, entry]) => {
      acc[key] = serializeForJson(entry);
      return acc;
    }, {});
  }

  return String(value);
}

module.exports = {
  serializeForJson,
};
