'use strict';

const fs = require('fs');
const path = require('path');

const { toChecksum } = require('./job-registry-config-utils');

const ACTIONS = Object.freeze({
  STATUS: 'status',
  SET: 'set',
});

const ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;

const BOOLEAN_TRUE_VALUES = new Set(['1', 'true', 't', 'yes', 'y', 'on', 'allow', 'allowed']);
const BOOLEAN_FALSE_VALUES = new Set(['0', 'false', 'f', 'no', 'n', 'off', 'revoke', 'revoked', 'deny', 'denied']);

function parseBoolean(value, label) {
  if (value === true || value === false) {
    return value;
  }

  if (value === null || value === undefined) {
    throw new Error(`Missing boolean value for ${label}`);
  }

  const normalized = String(value).trim().toLowerCase();
  if (BOOLEAN_TRUE_VALUES.has(normalized)) {
    return true;
  }
  if (BOOLEAN_FALSE_VALUES.has(normalized)) {
    return false;
  }

  throw new Error(`Unable to parse boolean value "${value}" for ${label}`);
}

function ensureAddress(address, label) {
  if (!address) {
    throw new Error(`${label} requires a 0x-prefixed address`);
  }

  const candidate = String(address).trim();
  if (!ADDRESS_REGEX.test(candidate)) {
    throw new Error(`${label} must be a valid 0x-prefixed address`);
  }

  return `0x${candidate.slice(2).toLowerCase()}`;
}

function normalizeAddressCandidate(candidate) {
  if (candidate === null || candidate === undefined) {
    return null;
  }

  if (typeof candidate === 'string') {
    const trimmed = candidate.trim();
    if (!trimmed) {
      return null;
    }

    if (trimmed.includes(',')) {
      return trimmed
        .split(',')
        .map((part) => normalizeAddressCandidate(part))
        .filter((value) => Boolean(value));
    }

    if (ADDRESS_REGEX.test(trimmed)) {
      return `0x${trimmed.slice(2).toLowerCase()}`;
    }

    throw new Error(`Invalid address candidate "${candidate}"`);
  }

  if (Array.isArray(candidate)) {
    return candidate
      .map((entry) => normalizeAddressCandidate(entry))
      .flat()
      .filter((value) => Boolean(value));
  }

  if (typeof candidate === 'object') {
    if ('address' in candidate) {
      return normalizeAddressCandidate(candidate.address);
    }
  }

  throw new Error(`Unsupported address candidate type: ${JSON.stringify(candidate)}`);
}

function flattenAddressInputs(inputs) {
  const accumulator = [];
  inputs.forEach((input) => {
    const normalized = normalizeAddressCandidate(input);
    if (Array.isArray(normalized)) {
      normalized.forEach((value) => accumulator.push(value));
    } else if (normalized) {
      accumulator.push(normalized);
    }
  });
  return accumulator;
}

function readLinesFromFile(filePath) {
  const resolved = path.resolve(filePath);
  const raw = fs.readFileSync(resolved, 'utf8');
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function parseAddressFile(filePath) {
  const resolved = path.resolve(filePath);
  const raw = fs.readFileSync(resolved, 'utf8');
  const trimmed = raw.trim();
  if (!trimmed) {
    return [];
  }

  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      return flattenAddressInputs(parsed);
    }

    if (typeof parsed === 'object' && parsed !== null) {
      if ('addresses' in parsed) {
        return flattenAddressInputs(parsed.addresses);
      }
      if ('address' in parsed) {
        return flattenAddressInputs([parsed.address]);
      }
    }
    throw new Error('JSON file must be an array or an object containing addresses');
  } catch (error) {
    if (error instanceof SyntaxError) {
      const lines = readLinesFromFile(resolved);
      return flattenAddressInputs(lines);
    }
    throw error;
  }
}

function dedupeAddresses(addresses) {
  const result = [];
  const seen = new Set();
  addresses.forEach((address) => {
    if (!address) {
      return;
    }
    const normalized = ensureAddress(address, 'Address');
    if (!seen.has(normalized)) {
      seen.add(normalized);
      result.push(normalized);
    }
  });
  return result;
}

function resolveCheckAddresses({ inline = [], filePath = null }) {
  const addresses = flattenAddressInputs(inline);
  if (filePath) {
    addresses.push(...parseAddressFile(filePath));
  }
  return dedupeAddresses(addresses);
}

function parseModificationCandidate(candidate) {
  if (candidate === null || candidate === undefined) {
    return [];
  }

  if (typeof candidate === 'string') {
    const trimmed = candidate.trim();
    if (!trimmed) {
      return [];
    }

    const parts = trimmed.split(/[\s,]+/).filter((part) => part.length > 0);
    if (parts.length === 1) {
      return parseModificationCandidate({ address: parts[0], allowed: true });
    }
    if (parts.length >= 2) {
      return [
        {
          address: ensureAddress(parts[0], 'Emergency modification entry'),
          allowed: parseBoolean(parts[1], `emergency modification for ${parts[0]}`),
        },
      ];
    }
    return [];
  }

  if (Array.isArray(candidate)) {
    return candidate.map((entry) => parseModificationCandidate(entry)).flat();
  }

  if (typeof candidate === 'object') {
    const addressValue = candidate.address || candidate.account || candidate.target;
    if (!addressValue) {
      throw new Error(`Emergency modification entry is missing an address: ${JSON.stringify(candidate)}`);
    }

    const allowedValue =
      candidate.allowed !== undefined
        ? candidate.allowed
        : candidate.allow !== undefined
        ? candidate.allow
        : candidate.authorized !== undefined
        ? candidate.authorized
        : candidate.enable !== undefined
        ? candidate.enable
        : candidate.value !== undefined
        ? candidate.value
        : candidate.status !== undefined
        ? candidate.status
        : candidate.state !== undefined
        ? candidate.state
        : null;

    if (allowedValue === null) {
      throw new Error(
        `Emergency modification entry for ${addressValue} is missing an allowed flag: ${JSON.stringify(candidate)}`
      );
    }

    return [
      {
        address: ensureAddress(addressValue, 'Emergency modification entry'),
        allowed: parseBoolean(allowedValue, `emergency modification for ${addressValue}`),
      },
    ];
  }

  throw new Error(`Unsupported emergency modification entry: ${JSON.stringify(candidate)}`);
}

function parseModificationFile(filePath) {
  const resolved = path.resolve(filePath);
  const raw = fs.readFileSync(resolved, 'utf8');
  const trimmed = raw.trim();
  if (!trimmed) {
    return [];
  }

  try {
    const parsed = JSON.parse(trimmed);
    return parseModificationCandidate(parsed);
  } catch (error) {
    if (error instanceof SyntaxError) {
      const lines = readLinesFromFile(resolved);
      return lines.map((line) => parseModificationCandidate(line)).flat();
    }
    throw error;
  }
}

function dedupeModifications(entries) {
  const deduped = new Map();
  entries.forEach((entry) => {
    const normalizedAddress = ensureAddress(entry.address, 'Emergency modification entry');
    deduped.set(normalizedAddress, {
      address: normalizedAddress,
      allowed: Boolean(entry.allowed),
    });
  });
  return Array.from(deduped.values());
}

function resolveModificationEntries({ allowList = [], revokeList = [], batch = [], filePath = null }) {
  const entries = [];

  allowList.forEach((candidate) => {
    const addresses = normalizeAddressCandidate(candidate);
    const flattened = Array.isArray(addresses) ? addresses : [addresses];
    flattened
      .filter((value) => Boolean(value))
      .forEach((address) => entries.push({ address, allowed: true }));
  });

  revokeList.forEach((candidate) => {
    const addresses = normalizeAddressCandidate(candidate);
    const flattened = Array.isArray(addresses) ? addresses : [addresses];
    flattened
      .filter((value) => Boolean(value))
      .forEach((address) => entries.push({ address, allowed: false }));
  });

  batch.forEach((candidate) => {
    parseModificationCandidate(candidate).forEach((entry) => entries.push(entry));
  });

  if (filePath) {
    parseModificationFile(filePath).forEach((entry) => entries.push(entry));
  }

  return dedupeModifications(entries);
}

function parseEmergencyConsoleArgs(argv) {
  const result = {
    action: ACTIONS.STATUS,
    help: false,
    execute: false,
    from: null,
    planOut: null,
    check: [],
    checkFile: null,
    allow: [],
    revoke: [],
    batch: [],
    batchFile: null,
  };

  const assignOption = (key, rawValue) => {
    const value = rawValue === undefined ? true : rawValue;
    switch (key) {
      case 'help':
        result.help = true;
        return;
      case 'execute':
        result.execute = value === true ? true : value === false ? false : parseBoolean(value, '--execute flag');
        return;
      case 'dry-run':
        result.execute = !(value === true ? true : parseBoolean(value, '--dry-run flag'));
        return;
      case 'from':
        if (value && typeof value === 'string') {
          result.from = value;
        }
        return;
      case 'plan-out':
      case 'planOut':
        if (!value || typeof value !== 'string') {
          throw new Error('--plan-out requires a file path');
        }
        result.planOut = value;
        return;
      case 'file':
      case 'check-file':
        if (!value || typeof value !== 'string') {
          throw new Error('--file requires a path argument');
        }
        result.checkFile = value;
        return;
      case 'check':
      case 'address':
      case 'addresses':
        result.check.push(value);
        return;
      case 'allow':
        result.allow.push(value);
        return;
      case 'revoke':
      case 'deny':
        result.revoke.push(value);
        return;
      case 'batch':
      case 'changes':
        result.batch.push(value);
        return;
      case 'batch-file':
      case 'changes-file':
        if (!value || typeof value !== 'string') {
          throw new Error('--batch-file requires a path argument');
        }
        result.batchFile = value;
        return;
      default:
        break;
    }
  };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (typeof arg !== 'string') {
      continue;
    }

    if (arg.startsWith('--')) {
      const trimmed = arg.slice(2);
      if (trimmed.includes('=')) {
        const [key, rawValue] = trimmed.split(/=(.+)/);
        assignOption(key, rawValue);
      } else {
        const next = argv[i + 1];
        if (next === undefined || (typeof next === 'string' && next.startsWith('--'))) {
          assignOption(trimmed);
        } else {
          assignOption(trimmed, next);
          i += 1;
        }
      }
      continue;
    }

    if (!result.action || result.action === ACTIONS.STATUS) {
      const candidate = arg.toLowerCase();
      if (candidate === ACTIONS.STATUS || candidate === ACTIONS.SET) {
        result.action = candidate;
        continue;
      }
    }
  }

  return result;
}

function formatStatusLines(statusEntries) {
  if (!Array.isArray(statusEntries) || statusEntries.length === 0) {
    return ['No addresses provided. Use --check <address> or --file <path> to specify entries.'];
  }

  const lines = ['Emergency access status:'];
  statusEntries.forEach((entry) => {
    const checksum = toChecksum(entry.address);
    lines.push(`  - ${checksum}: ${entry.allowed ? 'allowed' : 'revoked'}`);
  });
  return lines;
}

function formatPlanLines(planEntries) {
  if (!Array.isArray(planEntries) || planEntries.length === 0) {
    return ['No emergency access changes detected.'];
  }

  const lines = ['Planned IdentityRegistry.setEmergencyAccess updates:'];
  planEntries.forEach((entry) => {
    const checksum = toChecksum(entry.address);
    lines.push(`  - ${entry.allowed ? 'allow' : 'revoke'} ${checksum}`);
  });
  return lines;
}

async function collectEmergencyStatus(identity, addresses) {
  if (!identity) {
    throw new Error('IdentityRegistry instance is required');
  }

  const normalized = dedupeAddresses(addresses);
  const results = [];
  for (let i = 0; i < normalized.length; i += 1) {
    const address = normalized[i];
    // eslint-disable-next-line no-await-in-loop
    const allowed = await identity.hasEmergencyAccess(address);
    results.push({ address, allowed: Boolean(allowed) });
  }
  return results;
}

function buildEmergencyPlanEntries(modifications) {
  if (!Array.isArray(modifications)) {
    return [];
  }

  return modifications.map((entry) => ({
    action: entry.allowed ? 'allow' : 'revoke',
    method: 'setEmergencyAccess',
    args: [entry.address, entry.allowed],
    address: entry.address,
    allowed: entry.allowed,
  }));
}

function enrichPlanEntriesWithCalldata(identity, planEntries) {
  if (!identity || !identity.contract || !identity.contract.methods) {
    throw new Error('IdentityRegistry contract instance with ABI is required to build calldata');
  }

  return planEntries.map((entry) => {
    const callData = identity.contract.methods[entry.method](...entry.args).encodeABI();
    return {
      ...entry,
      callData,
      call: {
        to: identity.address,
        data: callData,
        value: '0',
      },
    };
  });
}

function buildPlanSummary({ identityAddress, owner, sender, planEntries }) {
  return {
    identityRegistry: identityAddress,
    owner: owner || null,
    sender: sender || null,
    steps: planEntries.map((entry) => ({
      action: entry.action,
      address: toChecksum(entry.address),
      allowed: entry.allowed,
      method: entry.method,
      args: entry.args,
      call: entry.call,
    })),
  };
}

function writePlanSummary(summary, outputPath) {
  if (!outputPath) {
    return null;
  }

  const resolved = path.resolve(outputPath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  return resolved;
}

module.exports = {
  ACTIONS,
  parseEmergencyConsoleArgs,
  resolveCheckAddresses,
  resolveModificationEntries,
  formatStatusLines,
  formatPlanLines,
  collectEmergencyStatus,
  buildEmergencyPlanEntries,
  enrichPlanEntriesWithCalldata,
  buildPlanSummary,
  writePlanSummary,
};
