'use strict';

const MODULE_KEYS = Object.freeze([
  'identity',
  'staking',
  'validation',
  'dispute',
  'reputation',
  'feePool',
]);

const TIMING_KEYS = Object.freeze(['commitWindow', 'revealWindow', 'disputeWindow']);

const THRESHOLD_KEYS = Object.freeze([
  'approvalThresholdBps',
  'quorumMin',
  'quorumMax',
  'feeBps',
  'slashBpsMax',
]);

const BPS_DENOMINATOR = 10_000;

const IGNORED_FLAGS = new Set(['network']);

function cloneKeys(keys) {
  return keys.reduce((acc, key) => {
    acc[key] = undefined;
    return acc;
  }, {});
}

function createDefaultArgs() {
  return {
    execute: false,
    dryRun: true,
    from: null,
    paramsPath: null,
    variant: null,
    planOutPath: null,
    help: false,
    modules: cloneKeys(MODULE_KEYS),
    timings: cloneKeys(TIMING_KEYS),
    thresholds: cloneKeys(THRESHOLD_KEYS),
  };
}

function parseConfiguratorArgs(argv) {
  if (!Array.isArray(argv)) {
    throw new TypeError('argv must be an array');
  }

  const args = createDefaultArgs();

  for (let i = 2; i < argv.length; i++) {
    const raw = argv[i];
    if (typeof raw !== 'string' || !raw.startsWith('--')) {
      continue;
    }

    let key;
    let value;
    const eqIndex = raw.indexOf('=');
    if (eqIndex !== -1) {
      key = raw.slice(2, eqIndex);
      value = raw.slice(eqIndex + 1);
    } else {
      key = raw.slice(2);
      const peek = argv[i + 1];
      if (peek && typeof peek === 'string' && !peek.startsWith('--')) {
        value = peek;
        i += 1;
      } else {
        value = 'true';
      }
    }

    if (!key) {
      continue;
    }

    if (IGNORED_FLAGS.has(key)) {
      continue;
    }

    if (key === 'help' || key === 'h') {
      args.help = true;
      continue;
    }

    if (key === 'execute') {
      args.execute = parseBooleanFlag(value, true);
      continue;
    }

    if (key === 'dry-run') {
      args.dryRun = parseBooleanFlag(value, true);
      continue;
    }

    if (key === 'from') {
      args.from = value;
      continue;
    }

    if (key === 'params') {
      args.paramsPath = value;
      continue;
    }

    if (key === 'variant') {
      args.variant = value;
      continue;
    }

    if (key === 'plan-out') {
      if (!value || value === 'true' || value === 'false') {
        throw new Error('--plan-out requires a file path argument');
      }
      args.planOutPath = value;
      continue;
    }

    if (key.startsWith('modules.')) {
      assignSectionValue(args.modules, MODULE_KEYS, key.slice('modules.'.length), value, 'modules');
      continue;
    }

    if (key.startsWith('timings.')) {
      assignSectionValue(args.timings, TIMING_KEYS, key.slice('timings.'.length), value, 'timings');
      continue;
    }

    if (key.startsWith('thresholds.')) {
      assignSectionValue(
        args.thresholds,
        THRESHOLD_KEYS,
        key.slice('thresholds.'.length),
        value,
        'thresholds'
      );
      continue;
    }

    throw new Error(`Unsupported flag --${key}`);
  }

  if (args.execute) {
    args.dryRun = false;
  } else if (!args.dryRun) {
    args.execute = true;
  }

  return args;
}

function assignSectionValue(container, validKeys, key, value, sectionLabel) {
  if (!validKeys.includes(key)) {
    throw new Error(`Unknown ${sectionLabel} option "${key}"`);
  }

  container[key] = value;
}

function parseBooleanFlag(value, defaultValue) {
  if (value === undefined || value === null) {
    return Boolean(defaultValue);
  }

  if (typeof value === 'boolean') {
    return value;
  }

  const normalized = String(value).trim().toLowerCase();
  if (normalized.length === 0) {
    return Boolean(defaultValue);
  }

  if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) {
    return true;
  }

  if (['false', '0', 'no', 'n', 'off'].includes(normalized)) {
    return false;
  }

  throw new Error(`Unable to parse boolean flag value "${value}"`);
}

function normalizeAddress(value, label) {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== 'string') {
    throw new Error(`${label} must be a string`);
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error(`${label} must not be empty`);
  }

  if (!/^0x[0-9a-fA-F]{40}$/.test(trimmed)) {
    throw new Error(`${label} must be a valid 20-byte hexadecimal address`);
  }

  return trimmed.toLowerCase();
}

function parsePositiveInteger(value, label) {
  if (value === undefined || value === null) {
    throw new Error(`${label} is required`);
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
      throw new Error(`${label} must be a positive integer`);
    }
    return value;
  }

  const normalized = String(value).trim();
  if (!/^\d+$/.test(normalized)) {
    throw new Error(`${label} must be a positive integer`);
  }

  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }

  return parsed;
}

function parseNonNegativeInteger(value, label) {
  if (value === undefined || value === null) {
    throw new Error(`${label} is required`);
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
      throw new Error(`${label} must be a non-negative integer`);
    }
    return value;
  }

  const normalized = String(value).trim();
  if (!/^\d+$/.test(normalized)) {
    throw new Error(`${label} must be a non-negative integer`);
  }

  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }

  return parsed;
}

function computeDiff(current, desired, keys) {
  const diff = {};
  let changed = false;

  keys.forEach((key) => {
    const currentValue = current && current[key] !== undefined ? current[key] : null;
    const desiredValue = desired[key];
    if (currentValue === null || currentValue === undefined) {
      if (desiredValue !== null && desiredValue !== undefined) {
        changed = true;
        diff[key] = { previous: currentValue, next: desiredValue };
      }
      return;
    }

    if (typeof currentValue === 'string' && typeof desiredValue === 'string') {
      if (currentValue.toLowerCase() !== desiredValue.toLowerCase()) {
        changed = true;
        diff[key] = { previous: currentValue, next: desiredValue };
      }
      return;
    }

    if (Number(currentValue) !== Number(desiredValue)) {
      changed = true;
      diff[key] = { previous: Number(currentValue), next: Number(desiredValue) };
    }
  });

  return { diff, changed };
}

function computeModulesPlan({ current = {}, overrides = {}, defaults = {} }) {
  const desired = {};

  MODULE_KEYS.forEach((key) => {
    const candidate = overrides[key] ?? defaults[key];
    const label = `modules.${key}`;
    const normalized = normalizeAddress(candidate, label);
    desired[key] = normalized;
  });

  const preparedCurrent = MODULE_KEYS.reduce((acc, key) => {
    const value = current[key];
    if (value === undefined || value === null || value === '') {
      acc[key] = null;
    } else {
      acc[key] = String(value).toLowerCase();
    }
    return acc;
  }, {});

  const { diff, changed } = computeDiff(preparedCurrent, desired, MODULE_KEYS);

  return { desired, diff, changed };
}

function computeTimingsPlan({ current = {}, overrides = {}, defaults = {} }) {
  const desired = {};

  TIMING_KEYS.forEach((key) => {
    const candidate = overrides[key] ?? defaults[key] ?? current[key];
    desired[key] = parsePositiveInteger(candidate, `timings.${key}`);
  });

  const normalizedCurrent = TIMING_KEYS.reduce((acc, key) => {
    if (current[key] === undefined || current[key] === null) {
      acc[key] = null;
    } else {
      acc[key] = Number(current[key]);
    }
    return acc;
  }, {});

  const { diff, changed } = computeDiff(normalizedCurrent, desired, TIMING_KEYS);

  return { desired, diff, changed };
}

function computeThresholdsPlan({ current = {}, overrides = {}, defaults = {} }) {
  const desired = {};

  THRESHOLD_KEYS.forEach((key) => {
    const candidate = overrides[key] ?? defaults[key] ?? current[key];
    const label = `thresholds.${key}`;
    if (key === 'approvalThresholdBps' || key === 'feeBps' || key === 'slashBpsMax') {
      desired[key] = parseBps(candidate, label);
    } else {
      desired[key] = parseNonNegativeInteger(candidate, label);
    }
  });

  if (desired.quorumMin <= 0) {
    throw new Error('thresholds.quorumMin must be greater than zero');
  }

  if (desired.quorumMax < desired.quorumMin) {
    throw new Error('thresholds.quorumMax must be greater than or equal to thresholds.quorumMin');
  }

  const normalizedCurrent = THRESHOLD_KEYS.reduce((acc, key) => {
    if (current[key] === undefined || current[key] === null) {
      acc[key] = null;
    } else {
      acc[key] = Number(current[key]);
    }
    return acc;
  }, {});

  const { diff, changed } = computeDiff(normalizedCurrent, desired, THRESHOLD_KEYS);

  return { desired, diff, changed };
}

function parseBps(value, label) {
  const parsed = parseNonNegativeInteger(value, label);
  if (parsed > BPS_DENOMINATOR) {
    throw new Error(`${label} must not exceed ${BPS_DENOMINATOR}`);
  }
  return parsed;
}

module.exports = {
  parseConfiguratorArgs,
  computeModulesPlan,
  computeTimingsPlan,
  computeThresholdsPlan,
  normalizeAddress,
  parsePositiveInteger,
  parseNonNegativeInteger,
  parseBps,
  MODULE_KEYS,
  TIMING_KEYS,
  THRESHOLD_KEYS,
  BPS_DENOMINATOR,
};
