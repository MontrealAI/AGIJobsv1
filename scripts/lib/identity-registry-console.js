'use strict';

const fs = require('fs');
const path = require('path');
const { hash: computeNamehash, normalize: normalizeEnsName } = require('eth-ens-namehash');
const Web3Utils = require('web3-utils');

const { configPath, readConfig, resolveVariant } = require('../config-loader');
const { toChecksum, formatDiffEntry } = require('./job-registry-config-utils');

const ACTIONS = Object.freeze({
  STATUS: 'status',
  SET: 'set',
});

const HEX_32_REGEX = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS_REGEX = /^0x[0-9a-fA-F]{40}$/;
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const ZERO_BYTES32 = '0x0000000000000000000000000000000000000000000000000000000000000000';
const ALPHA_PREFIX = 'alpha.';
const ALPHA_LABEL_HASH = Web3Utils.keccak256('alpha');

function parseBooleanFlag(value, defaultValue = false) {
  if (value === undefined || value === null) {
    return defaultValue;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 't', 'yes', 'y', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'f', 'no', 'n', 'off'].includes(normalized)) {
    return false;
  }

  throw new Error(`Unable to parse boolean flag from "${value}"`);
}

function normalizeKey(key) {
  return key.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

function parseIdentityConsoleArgs(argv) {
  const result = {
    action: ACTIONS.STATUS,
    execute: false,
    from: null,
    configPath: null,
    variant: null,
    overrides: {},
    help: false,
  };

  const assignOption = (key, rawValue) => {
    const value = rawValue === undefined ? true : rawValue;
    switch (key) {
      case 'help':
        result.help = true;
        return;
      case 'execute':
        result.execute = parseBooleanFlag(value, true);
        return;
      case 'dry-run':
        result.execute = !parseBooleanFlag(value, true);
        return;
      case 'from':
        if (value && typeof value === 'string') {
          result.from = value;
        }
        return;
      case 'config':
      case 'config-path':
        if (!value) {
          throw new Error('--config requires a path argument');
        }
        result.configPath = value;
        return;
      case 'variant':
        if (value && typeof value === 'string') {
          result.variant = value;
        }
        return;
      default:
        if (key.startsWith('ens.')) {
          const subKey = normalizeKey(key.slice(4));
          if (!subKey) {
            throw new Error(`Unrecognized ENS override flag "${key}"`);
          }
          result.overrides[subKey] = value;
        }
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

function loadEnsConfig({ explicitPath, variant }) {
  if (explicitPath) {
    const resolvedPath = path.resolve(process.cwd(), explicitPath);
    const raw = fs.readFileSync(resolvedPath, 'utf8');
    const parsed = JSON.parse(raw);
    return { path: resolvedPath, variant: null, values: parsed };
  }

  const resolvedVariant = resolveVariant(variant);
  const configFilePath = configPath('ens', resolvedVariant);
  const values = readConfig('ens', resolvedVariant);
  return { path: configFilePath, variant: resolvedVariant, values };
}

function ensureAddress(value, label) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const candidate = String(value).trim();
  if (!ADDRESS_REGEX.test(candidate)) {
    throw new Error(`${label} must be a valid 0x-prefixed address`);
  }

  return candidate;
}

function ensureHash(value, label) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const candidate = String(value).trim();
  if (!HEX_32_REGEX.test(candidate)) {
    throw new Error(`${label} must be a 32-byte hex string`);
  }

  return `0x${candidate.slice(2).toLowerCase()}`;
}

function normalizeAddressForCompare(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const candidate = String(value).trim();
  if (candidate.length === 0) {
    return null;
  }

  if (candidate.toLowerCase() === ZERO_ADDRESS) {
    return null;
  }

  return candidate.toLowerCase();
}

function formatAddressOrUnset(value) {
  if (!value) {
    return '(unset)';
  }
  const candidate = String(value);
  if (candidate.toLowerCase() === ZERO_ADDRESS) {
    return '(unset)';
  }
  const checksum = toChecksum(candidate);
  return checksum || candidate;
}

function ensureEnsHashFromName(value, label) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const candidate = String(value).trim();
  if (candidate.length === 0) {
    throw new Error(`${label} must not be empty`);
  }

  try {
    const normalized = normalizeEnsName(candidate);
    return computeNamehash(normalized);
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    throw new Error(`Invalid ENS name for ${label}: ${message}`);
  }
}

function deriveDesiredConfig(baseValues, overrides = {}) {
  const deriveAlphaAgentRootName = () => {
    if (baseValues.alphaAgentRoot) {
      return baseValues.alphaAgentRoot;
    }
    if (!baseValues.agentRoot) {
      return null;
    }

    try {
      const normalizedAgent = normalizeEnsName(String(baseValues.agentRoot));
      if (normalizedAgent.startsWith(ALPHA_PREFIX)) {
        return normalizedAgent;
      }
      return `${ALPHA_PREFIX}${normalizedAgent}`;
    } catch (error) {
      const message = error && error.message ? error.message : String(error);
      throw new Error(`Invalid ENS name for agentRoot: ${message}`);
    }
  };

  const alphaAgentRootName = deriveAlphaAgentRootName();

  const desired = {
    registry: ensureAddress(baseValues.registry, 'registry'),
    nameWrapper: ensureAddress(baseValues.nameWrapper, 'nameWrapper'),
    agentRootHash:
      ensureHash(baseValues.agentRootHash, 'agentRootHash') ||
      ensureEnsHashFromName(baseValues.agentRoot, 'agentRoot'),
    clubRootHash:
      ensureHash(baseValues.clubRootHash, 'clubRootHash') ||
      ensureEnsHashFromName(baseValues.clubRoot, 'clubRoot'),
    alphaClubRootHash:
      ensureHash(baseValues.alphaClubRootHash, 'alphaClubRootHash') ||
      ensureEnsHashFromName(baseValues.alphaClubRoot, 'alphaClubRoot'),
    alphaEnabled:
      baseValues.alphaEnabled === undefined ? false : Boolean(baseValues.alphaEnabled),
    alphaAgentRootHash:
      ensureHash(baseValues.alphaAgentRootHash, 'alphaAgentRootHash') ||
      ensureEnsHashFromName(alphaAgentRootName, 'alphaAgentRoot'),
    alphaAgentEnabled:
      baseValues.alphaAgentEnabled === undefined || baseValues.alphaAgentEnabled === null
        ? undefined
        : Boolean(baseValues.alphaAgentEnabled),
  };

  const applyOverride = (key, rawValue) => {
    if (rawValue === undefined || rawValue === null) {
      return;
    }

    switch (key) {
      case 'registry':
        desired.registry = ensureAddress(rawValue, 'ens.registry');
        break;
      case 'nameWrapper':
      case 'name-wrapper':
        desired.nameWrapper = ensureAddress(rawValue, 'ens.nameWrapper');
        break;
      case 'agentRootHash':
      case 'agent-root-hash':
        desired.agentRootHash = ensureHash(rawValue, 'ens.agentRootHash');
        break;
      case 'clubRootHash':
      case 'club-root-hash':
        desired.clubRootHash = ensureHash(rawValue, 'ens.clubRootHash');
        break;
      case 'alphaClubRootHash':
      case 'alpha-club-root-hash':
        desired.alphaClubRootHash = ensureHash(rawValue, 'ens.alphaClubRootHash');
        break;
      case 'agentRoot':
      case 'agent-root':
        desired.agentRootHash = ensureEnsHashFromName(rawValue, 'ens.agentRoot');
        break;
      case 'clubRoot':
      case 'club-root':
        desired.clubRootHash = ensureEnsHashFromName(rawValue, 'ens.clubRoot');
        break;
      case 'alphaClubRoot':
      case 'alpha-club-root':
        desired.alphaClubRootHash = ensureEnsHashFromName(rawValue, 'ens.alphaClubRoot');
        break;
      case 'alphaEnabled':
      case 'alpha-enabled':
        desired.alphaEnabled = parseBooleanFlag(rawValue, true);
        break;
      case 'alphaAgentRootHash':
      case 'alpha-agent-root-hash':
        desired.alphaAgentRootHash = ensureHash(rawValue, 'ens.alphaAgentRootHash');
        break;
      case 'alphaAgentRoot':
      case 'alpha-agent-root':
        desired.alphaAgentRootHash = ensureEnsHashFromName(rawValue, 'ens.alphaAgentRoot');
        break;
      case 'alphaAgentEnabled':
      case 'alpha-agent-enabled':
        desired.alphaAgentEnabled = parseBooleanFlag(rawValue, true);
        break;
      default:
        break;
    }
  };

  Object.entries(overrides).forEach(([key, value]) => applyOverride(key, value));

  if (desired.alphaAgentRootHash && desired.alphaAgentEnabled === undefined) {
    desired.alphaAgentEnabled = true;
  }
  if (desired.alphaAgentEnabled === undefined) {
    desired.alphaAgentEnabled = false;
  }
  if (desired.alphaAgentEnabled && (!desired.alphaAgentRootHash || desired.alphaAgentRootHash === ZERO_BYTES32)) {
    throw new Error('alphaAgentEnabled=true requires alphaAgentRootHash to be non-zero');
  }

  if (!desired.registry || desired.registry === ZERO_ADDRESS) {
    throw new Error('IdentityRegistry.configureEns requires a non-zero registry address');
  }
  if (!desired.agentRootHash) {
    throw new Error('IdentityRegistry.configureEns requires agentRootHash to be set');
  }
  if (!desired.clubRootHash) {
    throw new Error('IdentityRegistry.configureEns requires clubRootHash to be set');
  }
  if (desired.alphaEnabled && (!desired.alphaClubRootHash || desired.alphaClubRootHash === ZERO_ADDRESS)) {
    throw new Error('alphaEnabled=true requires alphaClubRootHash to be non-zero');
  }

  return desired;
}

function normalizeHashForCompare(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const candidate = String(value).trim().toLowerCase();
  if (candidate === ZERO_BYTES32) {
    return null;
  }

  if (!HEX_32_REGEX.test(candidate)) {
    return candidate;
  }

  return candidate;
}

function formatHashOrUnset(value) {
  if (!value) {
    return '(unset)';
  }
  const candidate = String(value);
  return candidate.toLowerCase() === ZERO_BYTES32 ? '(unset)' : candidate;
}

function deriveAlphaAgentHashFromRoot(agentRootHash) {
  if (!agentRootHash || agentRootHash === ZERO_BYTES32) {
    return ZERO_BYTES32;
  }
  return Web3Utils.soliditySha3(
    { type: 'bytes32', value: agentRootHash },
    { type: 'bytes32', value: ALPHA_LABEL_HASH }
  );
}

function buildAlphaAgentPlan({ current, desired }) {
  const expectedRoot = deriveAlphaAgentHashFromRoot(desired.agentRootHash);
  const expectedEnabled = expectedRoot !== ZERO_BYTES32;

  const targetRoot = desired.alphaAgentRootHash || expectedRoot;
  const targetEnabled =
    desired.alphaAgentEnabled === undefined || desired.alphaAgentEnabled === null
      ? expectedEnabled
      : Boolean(desired.alphaAgentEnabled);

  const normalizedCurrentRoot = normalizeHashForCompare(current.alphaAgentRootHash);
  const normalizedTargetRoot = normalizeHashForCompare(targetRoot);
  const normalizedExpectedRoot = normalizeHashForCompare(expectedRoot);
  const currentEnabled = Boolean(current.alphaAgentEnabled);

  const requiresOverride =
    normalizedTargetRoot !== normalizedExpectedRoot || Boolean(targetEnabled) !== expectedEnabled;

  const diff = {};
  if (requiresOverride) {
    if (normalizedTargetRoot !== normalizedCurrentRoot) {
      diff.alphaAgentRootHash = { previous: current.alphaAgentRootHash || null, next: targetRoot };
    }
    if (Boolean(targetEnabled) !== currentEnabled) {
      diff.alphaAgentEnabled = { previous: currentEnabled, next: Boolean(targetEnabled) };
    }
  }

  return {
    expected: { rootHash: expectedRoot, enabled: expectedEnabled },
    target: { rootHash: targetRoot || ZERO_BYTES32, enabled: Boolean(targetEnabled) },
    changed: requiresOverride,
    diff,
    args: [targetRoot || ZERO_BYTES32, Boolean(targetEnabled)],
  };
}

function computeSetDiff(current, desired) {
  const diff = {};

  const compareAddress = (key, next) => {
    const previousNormalized = normalizeAddressForCompare(current[key]);
    const nextNormalized = normalizeAddressForCompare(next);
    if ((previousNormalized || null) !== (nextNormalized || null)) {
      diff[key] = { previous: current[key] || null, next };
    }
  };

  const compareHash = (key, next) => {
    const previousNormalized = normalizeHashForCompare(current[key]);
    const nextNormalized = normalizeHashForCompare(next);
    if ((previousNormalized || null) !== (nextNormalized || null)) {
      diff[key] = { previous: current[key] || null, next };
    }
  };

  const compareBoolean = (key, next) => {
    const previous = Boolean(current[key]);
    if (previous !== Boolean(next)) {
      diff[key] = { previous, next: Boolean(next) };
    }
  };

  compareAddress('registry', desired.registry);
  compareAddress('nameWrapper', desired.nameWrapper);
  compareHash('agentRootHash', desired.agentRootHash);
  compareHash('clubRootHash', desired.clubRootHash);
  compareHash('alphaClubRootHash', desired.alphaClubRootHash);
  compareBoolean('alphaEnabled', desired.alphaEnabled);

  return diff;
}

function buildSetPlan({ current, baseConfig, overrides }) {
  const desired = deriveDesiredConfig(baseConfig, overrides);
  const diff = computeSetDiff(current, desired);
  const configureChanged = Object.keys(diff).length > 0;
  const alphaAgent = buildAlphaAgentPlan({ current, desired });
  const changed = configureChanged || alphaAgent.changed;

  const args = [
    desired.registry,
    desired.nameWrapper || ZERO_ADDRESS,
    desired.agentRootHash,
    desired.clubRootHash,
    desired.alphaClubRootHash || ZERO_ADDRESS,
    Boolean(desired.alphaEnabled),
  ];

  return {
    desired,
    diff,
    configureChanged,
    alphaAgent,
    changed,
    args,
  };
}

function formatStatusLines(current) {
  return [
    'On-chain IdentityRegistry configuration:',
    `  registry: ${formatAddressOrUnset(current.registry)}`,
    `  nameWrapper: ${formatAddressOrUnset(current.nameWrapper)}`,
    `  agentRootHash: ${formatHashOrUnset(current.agentRootHash)}`,
    `  clubRootHash: ${formatHashOrUnset(current.clubRootHash)}`,
    `  alphaClubRootHash: ${formatHashOrUnset(current.alphaClubRootHash)}`,
    `  alphaEnabled: ${Boolean(current.alphaEnabled)}`,
    `  alphaAgentRootHash: ${formatHashOrUnset(current.alphaAgentRootHash)}`,
    `  alphaAgentEnabled: ${Boolean(current.alphaAgentEnabled)}`,
  ];
}

function formatPlanLines(plan) {
  const lines = [];
  lines.push('Planned IdentityRegistry.configureEns update:');
  Object.entries(plan.diff).forEach(([key, { previous, next }]) => {
    let formatter;
    if (key === 'registry' || key === 'nameWrapper') {
      formatter = (value) => formatAddressOrUnset(value);
    } else if (key === 'alphaEnabled') {
      formatter = (value) => (value ? 'true' : 'false');
    } else {
      formatter = (value) => formatHashOrUnset(value);
    }
    lines.push(`  ${key}: ${formatDiffEntry(previous, next, formatter)}`);
  });
  if (lines.length === 1) {
    lines.push('  (no changes)');
  }
  if (plan.alphaAgent && plan.alphaAgent.changed) {
    lines.push('Alpha agent alias adjustments:');
    if (plan.alphaAgent.diff.alphaAgentRootHash) {
      lines.push(
        `  alphaAgentRootHash: ${formatDiffEntry(
          plan.alphaAgent.diff.alphaAgentRootHash.previous,
          plan.alphaAgent.diff.alphaAgentRootHash.next,
          (value) => formatHashOrUnset(value)
        )}`
      );
    }
    if (plan.alphaAgent.diff.alphaAgentEnabled !== undefined) {
      lines.push(
        `  alphaAgentEnabled: ${formatDiffEntry(
          plan.alphaAgent.diff.alphaAgentEnabled.previous,
          plan.alphaAgent.diff.alphaAgentEnabled.next,
          (value) => (value ? 'true' : 'false')
        )}`
      );
    }
  }
  return lines;
}

async function collectCurrentConfig(identity) {
  const [
    registry,
    nameWrapper,
    agentRootHash,
    clubRootHash,
    alphaClubRootHash,
    alphaEnabled,
    alphaAgentRootHash,
    alphaAgentEnabled,
  ] =
    await Promise.all([
      identity.ensRegistry(),
      identity.ensNameWrapper(),
      identity.agentRootHash(),
      identity.clubRootHash(),
      identity.alphaClubRootHash(),
      identity.alphaEnabled(),
      identity.alphaAgentRootHash(),
      identity.alphaAgentEnabled(),
    ]);

  return {
    registry: registry || null,
    nameWrapper: nameWrapper || null,
    agentRootHash: agentRootHash || null,
    clubRootHash: clubRootHash || null,
    alphaClubRootHash: alphaClubRootHash || null,
    alphaEnabled: Boolean(alphaEnabled),
    alphaAgentRootHash: alphaAgentRootHash || null,
    alphaAgentEnabled: Boolean(alphaAgentEnabled),
  };
}

module.exports = {
  ACTIONS,
  parseBooleanFlag,
  parseIdentityConsoleArgs,
  loadEnsConfig,
  deriveDesiredConfig,
  buildSetPlan,
  formatStatusLines,
  formatPlanLines,
  collectCurrentConfig,
};
