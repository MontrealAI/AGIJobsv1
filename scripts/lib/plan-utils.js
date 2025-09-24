'use strict';

const fs = require('fs');
const path = require('path');

function serializeValue(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const valueType = typeof value;
  if (valueType === 'string' || valueType === 'boolean') {
    return value;
  }

  if (valueType === 'number') {
    return Number.isFinite(value) ? value : value.toString();
  }

  if (valueType === 'bigint') {
    return value.toString();
  }

  if (Array.isArray(value)) {
    return value.map((entry) => serializeValue(entry));
  }

  if (value && valueType === 'object') {
    if (typeof value.toString === 'function' && value.toString !== Object.prototype.toString) {
      const stringified = value.toString();
      if (stringified !== '[object Object]') {
        return stringified;
      }
    }

    return Object.entries(value).reduce((acc, [key, entry]) => {
      acc[key] = serializeValue(entry);
      return acc;
    }, {});
  }

  return String(value);
}

function normalizeDiffMap(diff) {
  if (!diff || typeof diff !== 'object') {
    return {};
  }

  return Object.entries(diff).reduce((acc, [key, entry]) => {
    const normalized = entry || {};
    const previous = normalized.previous === undefined ? null : normalized.previous;
    const next = normalized.next === undefined ? null : normalized.next;
    acc[key] = {
      previous: previous === null ? null : serializeValue(previous),
      next: next === null ? null : serializeValue(next),
    };
    return acc;
  }, {});
}

function buildContractCallStep({
  contract,
  method,
  args,
  contractName = 'Contract',
  diff,
  summary,
}) {
  if (!contract || !contract.contract || !contract.contract.methods) {
    throw new Error('Contract instance with ABI encoder is required to build plan steps');
  }

  const encoder = contract.contract.methods[method];
  if (typeof encoder !== 'function') {
    throw new Error(`${contractName}.${method} is not available on the provided contract instance`);
  }

  const encodedArgs = Array.isArray(args) ? args : [];
  const data = encoder(...encodedArgs).encodeABI();

  return {
    method,
    description: `${contractName}.${method}`,
    arguments: serializeValue(encodedArgs),
    diff: normalizeDiffMap(diff),
    summary: summary ? serializeValue(summary) : null,
    call: {
      to: contract.address,
      value: '0',
      data,
    },
  };
}

function writePlanSummary(plan, outputPath) {
  if (!outputPath || typeof outputPath !== 'string') {
    throw new Error('outputPath must be a non-empty string when writing plan summaries');
  }

  const resolvedPath = path.resolve(outputPath);
  const directory = path.dirname(resolvedPath);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(resolvedPath, `${JSON.stringify(plan, null, 2)}\n`, 'utf8');
  return resolvedPath;
}

module.exports = {
  serializeValue,
  normalizeDiffMap,
  buildContractCallStep,
  writePlanSummary,
};
