'use strict';

const fs = require('fs');
const path = require('path');

const { MODULE_KEYS, TIMING_KEYS, THRESHOLD_KEYS } = require('./job-registry-configurator');

function extractNetwork(argv) {
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (typeof arg !== 'string' || !arg.startsWith('--')) {
      continue;
    }

    const trimmed = arg.slice(2);
    if (trimmed === 'network') {
      const next = argv[i + 1];
      if (next && typeof next === 'string' && !next.startsWith('--')) {
        return next;
      }
    } else if (trimmed.startsWith('network=')) {
      return trimmed.slice('network='.length);
    }
  }

  return undefined;
}

function loadParamsConfig(paramsPath) {
  const resolvedPath = paramsPath
    ? path.resolve(paramsPath)
    : path.join(__dirname, '..', '..', 'config', 'params.json');

  const raw = fs.readFileSync(resolvedPath, 'utf8');
  const parsed = JSON.parse(raw);
  return { path: resolvedPath, values: parsed };
}

function toChecksum(address, web3Instance) {
  if (!address) {
    return null;
  }

  const candidate = String(address);
  const web3Ref =
    web3Instance || (typeof web3 !== 'undefined' && web3 && web3.utils ? web3 : null);

  if (web3Ref && web3Ref.utils && typeof web3Ref.utils.toChecksumAddress === 'function') {
    try {
      return web3Ref.utils.toChecksumAddress(candidate);
    } catch (error) {
      return candidate;
    }
  }

  return candidate;
}

function formatAddress(address, web3Instance) {
  const checksum = toChecksum(address, web3Instance);
  return checksum ? checksum : '(unset)';
}

function formatDiffEntry(previous, next, formatter = (value) => value) {
  const prevFormatted =
    previous === null || previous === undefined ? '(unset)' : formatter(previous);
  const nextFormatted = formatter(next);
  return `${prevFormatted} -> ${nextFormatted}`;
}

function normalizeModuleStruct(struct) {
  const normalized = {};
  MODULE_KEYS.forEach((key, index) => {
    let value = struct[key];
    if (value === undefined) {
      value = struct[index];
    }
    if (value === undefined || value === null || value === '') {
      normalized[key] = null;
    } else {
      normalized[key] = String(value);
    }
  });
  return normalized;
}

function normalizeNumericStruct(struct, keys) {
  const normalized = {};
  keys.forEach((key, index) => {
    let value = struct[key];
    if (value === undefined) {
      value = struct[index];
    }

    if (value === undefined || value === null) {
      normalized[key] = null;
      return;
    }

    if (typeof value === 'number') {
      normalized[key] = value;
      return;
    }

    if (typeof value.toNumber === 'function') {
      normalized[key] = value.toNumber();
      return;
    }

    if (typeof value.toString === 'function') {
      const asString = value.toString();
      if (/^\d+$/.test(asString)) {
        normalized[key] = Number(asString);
        return;
      }
      normalized[key] = asString;
      return;
    }

    normalized[key] = Number(value);
  });
  return normalized;
}

function collectConfigurationSnapshot(struct) {
  return {
    modules: normalizeModuleStruct(struct.modules),
    timings: normalizeNumericStruct(struct.timings, TIMING_KEYS),
    thresholds: normalizeNumericStruct(struct.thresholds, THRESHOLD_KEYS),
  };
}

module.exports = {
  extractNetwork,
  loadParamsConfig,
  toChecksum,
  formatAddress,
  formatDiffEntry,
  normalizeModuleStruct,
  normalizeNumericStruct,
  collectConfigurationSnapshot,
};
