'use strict';

const {
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
} = require('./job-registry-configurator');
const { formatDiffEntry } = require('./job-registry-config-utils');

const ACTIONS = Object.freeze({
  STATUS: 'status',
  SET: 'set',
  UPDATE: 'update',
});

const MODULE_ENUM = Object.freeze({
  identity: 0,
  staking: 1,
  validation: 2,
  dispute: 3,
  reputation: 4,
  feePool: 5,
});

const TIMING_ENUM = Object.freeze({
  commitWindow: 0,
  revealWindow: 1,
  disputeWindow: 2,
});

const THRESHOLD_ENUM = Object.freeze({
  approvalThresholdBps: 0,
  quorumMin: 1,
  quorumMax: 2,
  feeBps: 3,
  slashBpsMax: 4,
});

function findAction(argv) {
  for (let i = 2; i < argv.length; i += 1) {
    const value = argv[i];
    if (typeof value !== 'string') {
      continue;
    }
    if (value.startsWith('--')) {
      if (!value.includes('=') && i + 1 < argv.length) {
        const next = argv[i + 1];
        if (typeof next === 'string' && !next.startsWith('--')) {
          i += 1; // skip paired value
        }
      }
      continue;
    }
    return value;
  }
  return null;
}

function parseConfigConsoleArgs(argv) {
  const parsed = parseConfiguratorArgs(argv);
  const rawAction = findAction(argv);
  const action = rawAction ? String(rawAction).toLowerCase() : ACTIONS.STATUS;
  return {
    ...parsed,
    action,
  };
}

function extractOverrideEntries(options) {
  const entries = [];
  if (options.modules) {
    for (const key of MODULE_KEYS) {
      const value = options.modules[key];
      if (value !== undefined && value !== null) {
        entries.push({ section: 'modules', key, value });
      }
    }
  }
  if (options.timings) {
    for (const key of TIMING_KEYS) {
      const value = options.timings[key];
      if (value !== undefined && value !== null) {
        entries.push({ section: 'timings', key, value });
      }
    }
  }
  if (options.thresholds) {
    for (const key of THRESHOLD_KEYS) {
      const value = options.thresholds[key];
      if (value !== undefined && value !== null) {
        entries.push({ section: 'thresholds', key, value });
      }
    }
  }
  return entries;
}

function buildSetPlans({ currentModules, currentTimings, currentThresholds, overrides, defaults }) {
  const modulesPlan = computeModulesPlan({
    current: currentModules,
    overrides: overrides.modules,
    defaults: defaults.modules,
  });
  const timingsPlan = computeTimingsPlan({
    current: currentTimings,
    overrides: overrides.timings,
    defaults: defaults.timings,
  });
  const thresholdsPlan = computeThresholdsPlan({
    current: currentThresholds,
    overrides: overrides.thresholds,
    defaults: defaults.thresholds,
  });

  return { modulesPlan, timingsPlan, thresholdsPlan };
}

function ensureSingleOverride(entries) {
  if (entries.length === 0) {
    throw new Error(
      'Update action requires exactly one override flag. Provide a single --modules.<key>, --timings.<key>, or --thresholds.<key> option.'
    );
  }
  if (entries.length > 1) {
    const labels = entries.map((entry) => `${entry.section}.${entry.key}`).join(', ');
    throw new Error(`Update action accepts only one override but received: ${labels}`);
  }
  return entries[0];
}

function validateModuleOverride({ key, value, currentModules }) {
  const label = `modules.${key}`;
  const normalized = normalizeAddress(value, label);
  if (normalized === '0x0000000000000000000000000000000000000000') {
    throw new Error(`${label} must not be the zero address`);
  }
  const previous = currentModules && currentModules[key] ? String(currentModules[key]) : null;
  if (previous && previous.toLowerCase() === normalized.toLowerCase()) {
    throw new Error(`${label} already equals the requested address`);
  }
  const index = MODULE_ENUM[key];
  if (index === undefined) {
    throw new Error(`Unknown module key "${key}"`);
  }
  return {
    method: 'updateModule',
    args: [index, normalized],
    summary: {
      section: 'modules',
      key,
      previous,
      next: normalized,
    },
  };
}

function validateTimingOverride({ key, value, currentTimings }) {
  const label = `timings.${key}`;
  const parsedValue = parsePositiveInteger(value, label);
  const previous = currentTimings && currentTimings[key] !== undefined ? currentTimings[key] : null;
  if (previous !== null && Number(previous) === Number(parsedValue)) {
    throw new Error(`${label} already equals the requested value`);
  }
  const index = TIMING_ENUM[key];
  if (index === undefined) {
    throw new Error(`Unknown timing key "${key}"`);
  }
  return {
    method: 'updateTiming',
    args: [index, String(parsedValue)],
    summary: {
      section: 'timings',
      key,
      previous,
      next: parsedValue,
    },
  };
}

function ensureThresholdInvariant({ key, value, currentThresholds }) {
  const currentMin =
    currentThresholds && currentThresholds.quorumMin !== null
      ? Number(currentThresholds.quorumMin)
      : null;
  const currentMax =
    currentThresholds && currentThresholds.quorumMax !== null
      ? Number(currentThresholds.quorumMax)
      : null;

  if (key === 'quorumMin') {
    const nextMin = Number(value);
    if (nextMin <= 0) {
      throw new Error('thresholds.quorumMin must be greater than zero');
    }
    if (currentMax !== null && nextMin > currentMax) {
      throw new Error(
        `thresholds.quorumMin (${nextMin}) must not exceed the current quorumMax (${currentMax})`
      );
    }
  }

  if (key === 'quorumMax') {
    if (currentThresholds && currentThresholds.quorumMin === null) {
      throw new Error('thresholds.quorumMin must be configured before updating quorumMax');
    }
    const baseMin = currentThresholds ? Number(currentThresholds.quorumMin) : null;
    const nextMax = Number(value);
    if (baseMin !== null && nextMax < baseMin) {
      throw new Error(
        `thresholds.quorumMax (${nextMax}) must be greater than or equal to thresholds.quorumMin (${baseMin})`
      );
    }
  }
}

function validateThresholdOverride({ key, value, currentThresholds }) {
  const label = `thresholds.${key}`;
  let parsedValue;
  if (key === 'approvalThresholdBps' || key === 'feeBps' || key === 'slashBpsMax') {
    parsedValue = parseBps(value, label);
  } else if (key === 'quorumMin') {
    parsedValue = parsePositiveInteger(value, label);
  } else if (key === 'quorumMax') {
    parsedValue = parseNonNegativeInteger(value, label);
  } else {
    throw new Error(`Unknown threshold key "${key}"`);
  }

  ensureThresholdInvariant({ key, value: parsedValue, currentThresholds });

  const previous = currentThresholds && currentThresholds[key] !== undefined ? currentThresholds[key] : null;
  if (previous !== null && Number(previous) === Number(parsedValue)) {
    throw new Error(`${label} already equals the requested value`);
  }

  const index = THRESHOLD_ENUM[key];
  return {
    method: 'updateThreshold',
    args: [index, String(parsedValue)],
    summary: {
      section: 'thresholds',
      key,
      previous,
      next: parsedValue,
    },
  };
}

function buildUpdatePlan({ overrides, currentModules, currentTimings, currentThresholds }) {
  const entries = extractOverrideEntries(overrides);
  const override = ensureSingleOverride(entries);

  if (override.section === 'modules') {
    return validateModuleOverride({ key: override.key, value: override.value, currentModules });
  }
  if (override.section === 'timings') {
    return validateTimingOverride({ key: override.key, value: override.value, currentTimings });
  }
  if (override.section === 'thresholds') {
    if (!currentThresholds) {
      throw new Error('Threshold configuration is unavailable on-chain');
    }
    return validateThresholdOverride({
      key: override.key,
      value: override.value,
      currentThresholds,
    });
  }

  throw new Error(`Unsupported override section "${override.section}"`);
}

function formatPlanDiff(summary, formatter = (value) => value) {
  return formatDiffEntry(summary.previous, summary.next, formatter);
}

module.exports = {
  ACTIONS,
  MODULE_ENUM,
  TIMING_ENUM,
  THRESHOLD_ENUM,
  parseConfigConsoleArgs,
  extractOverrideEntries,
  buildSetPlans,
  buildUpdatePlan,
  formatPlanDiff,
};
