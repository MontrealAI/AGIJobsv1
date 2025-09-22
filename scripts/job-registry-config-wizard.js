'use strict';

const readline = require('readline');

const JobRegistry = artifacts.require('JobRegistry');

const {
  parseConfiguratorArgs,
  MODULE_KEYS,
  TIMING_KEYS,
  THRESHOLD_KEYS,
  normalizeAddress,
  parsePositiveInteger,
  parseNonNegativeInteger,
  parseBps,
} = require('./lib/job-registry-configurator');
const {
  loadParamsConfig,
  extractNetwork,
  normalizeModuleStruct,
  normalizeNumericStruct,
  formatAddress,
  formatDiffEntry,
  toChecksum,
} = require('./lib/job-registry-config-utils');
const { resolveModuleDefaults } = require('./lib/job-registry-config-defaults');
const { buildSetPlans } = require('./lib/job-registry-config-console');
const { buildSetPlanSummary, writePlanSummary } = require('./lib/job-registry-plan-writer');

function printHelp() {
  console.log('AGI Jobs v1 — JobRegistry configuration wizard');
  console.log(
    'Usage: npx truffle exec scripts/job-registry-config-wizard.js --network <network> [options]'
  );
  console.log('');
  console.log('Options:');
  console.log('  --from <address>         Sender account (defaults to first unlocked account)');
  console.log('  --execute[=true|false]  Broadcast transactions instead of dry run');
  console.log('  --dry-run[=true|false]  Alias for --execute');
  console.log('  --params <path>         Override params JSON (timings/threshold defaults)');
  console.log('  --variant <name>        Environment label for plan summaries');
  console.log('  --plan-out <path>       Persist a Safe-ready plan summary to the provided path');
  console.log('  --modules.<key> <addr>  Prefill module override (identity, staking, validation, dispute, reputation, feePool)');
  console.log('  --timings.<key> <secs>  Prefill timing override (commitWindow, revealWindow, disputeWindow)');
  console.log('  --thresholds.<key> <v>  Prefill threshold override (approvalThresholdBps, quorumMin, quorumMax, feeBps, slashBpsMax)');
  console.log('  --help                  Show this message and exit');
  console.log('');
  console.log('During interactive runs the wizard prints the current JobRegistry configuration,');
  console.log('suggests defaults from local deployments and config/params.json, and validates');
  console.log('each override before building a Safe-ready execution plan. Dry runs emit the');
  console.log('transaction calldata so non-technical operators can forward the summary.');
}

function createPromptInterface() {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: Boolean(process.stdin.isTTY && process.stdout.isTTY),
  });
}

function askQuestion(rl, prompt) {
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      resolve(answer.trim());
    });
  });
}

async function askYesNo(rl, prompt, defaultValue = false) {
  const suffix = defaultValue ? ' [Y/n] ' : ' [y/N] ';
  const raw = rl ? await askQuestion(rl, `${prompt}${suffix}`) : '';
  if (!raw) {
    return Boolean(defaultValue);
  }
  const normalized = raw.trim().toLowerCase();
  if (['y', 'yes'].includes(normalized)) {
    return true;
  }
  if (['n', 'no'].includes(normalized)) {
    return false;
  }
  console.log('  Please answer with "y" or "n".');
  return askYesNo(rl, prompt, defaultValue);
}

function filterDefinedKeys(container, keys) {
  return keys.reduce((acc, key) => {
    const value = container && container[key];
    if (value !== undefined && value !== null) {
      acc[key] = value;
    }
    return acc;
  }, {});
}

function hasDefinedEntries(map) {
  return Object.keys(map || {}).length > 0;
}

function printSectionHeader(label) {
  console.log('');
  console.log(`=== ${label} ===`);
}

function printCurrentConfiguration({ modules, timings, thresholds }) {
  printSectionHeader('Current configuration');
  console.log('- Modules:');
  MODULE_KEYS.forEach((key) => {
    console.log(`    ${key}: ${formatAddress(modules[key])}`);
  });
  console.log('- Timings:');
  TIMING_KEYS.forEach((key) => {
    const value = timings[key];
    console.log(`    ${key}: ${value === null || value === undefined ? '(unset)' : `${value} seconds`}`);
  });
  console.log('- Thresholds:');
  THRESHOLD_KEYS.forEach((key) => {
    const value = thresholds[key];
    console.log(`    ${key}: ${value === null || value === undefined ? '(unset)' : value}`);
  });
  console.log('');
}

async function collectModuleOverrides({ rl, currentModules, moduleDefaults, overrides }) {
  const finalOverrides = { ...overrides };
  const alreadyProvided = Object.keys(finalOverrides);
  if (alreadyProvided.length > 0) {
    console.log('Prefilled module overrides:');
    alreadyProvided.forEach((key) => {
      console.log(`  ${key}: ${formatAddress(finalOverrides[key])}`);
    });
    console.log('');
  }

  if (!rl) {
    return finalOverrides;
  }

  const shouldEdit = await askYesNo(rl, 'Update module addresses?', hasDefinedEntries(finalOverrides));
  if (!shouldEdit) {
    return finalOverrides;
  }

  console.log('Enter a new address, "default" to use the locally deployed module, or press Enter to keep the current value.');
  for (const key of MODULE_KEYS) {
    if (Object.prototype.hasOwnProperty.call(finalOverrides, key)) {
      continue;
    }

    const label = `modules.${key}`;
    const existing = currentModules[key];
    let promptValue = null;

    while (true) {
      const message = `${label} — current=${formatAddress(existing)} default=${formatAddress(moduleDefaults[key])} > `;
      promptValue = await askQuestion(rl, message);

      if (!promptValue) {
        delete finalOverrides[key];
        break;
      }

      if (promptValue.toLowerCase() === 'default') {
        const defaultAddress = moduleDefaults[key];
        if (!defaultAddress) {
          console.error('  Default deployment unavailable. Provide an explicit address.');
          const retry = await askYesNo(rl, '  Try again for this module?', true);
          if (!retry) {
            delete finalOverrides[key];
            break;
          }
          continue;
        }
        finalOverrides[key] = defaultAddress;
        break;
      }

      try {
        const normalized = normalizeAddress(promptValue, label);
        if (normalized === '0x0000000000000000000000000000000000000000') {
          throw new Error(`${label} must not be the zero address`);
        }
        finalOverrides[key] = normalized;
        break;
      } catch (error) {
        console.error(`  Error: ${error.message}`);
        const retry = await askYesNo(rl, '  Try again for this module?', true);
        if (!retry) {
          delete finalOverrides[key];
          break;
        }
      }
    }
  }

  return finalOverrides;
}

function parseTimingValue(input, key) {
  const label = `timings.${key}`;
  return parsePositiveInteger(input, label);
}

function parseThresholdValue(input, key) {
  const label = `thresholds.${key}`;
  if (key === 'approvalThresholdBps' || key === 'feeBps' || key === 'slashBpsMax') {
    return parseBps(input, label);
  }
  if (key === 'quorumMin') {
    return parsePositiveInteger(input, label);
  }
  return parseNonNegativeInteger(input, label);
}

async function collectNumericOverrides({
  rl,
  sectionLabel,
  keys,
  currentValues,
  defaults,
  overrides,
  parser,
  unit,
}) {
  const finalOverrides = { ...overrides };
  const providedKeys = Object.keys(finalOverrides);
  if (providedKeys.length > 0) {
    console.log(`Prefilled ${sectionLabel} overrides:`);
    providedKeys.forEach((key) => {
      console.log(`  ${key}: ${finalOverrides[key]}`);
    });
    console.log('');
  }

  if (!rl) {
    return finalOverrides;
  }

  const shouldEdit = await askYesNo(rl, `Update ${sectionLabel}?`, hasDefinedEntries(finalOverrides));
  if (!shouldEdit) {
    return finalOverrides;
  }

  console.log('Enter a new value, "default" to use config/params.json, or press Enter to keep the current value.');

  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(finalOverrides, key)) {
      continue;
    }

    while (true) {
      const currentValue = currentValues[key];
      const defaultValue = defaults[key];
      const prompt =
        `${sectionLabel}.${key} — current=${currentValue ?? '(unset)'}${unit ? ` ${unit}` : ''} default=${defaultValue} > `;
      const answer = await askQuestion(rl, prompt);

      if (!answer) {
        delete finalOverrides[key];
        break;
      }

      if (answer.toLowerCase() === 'default') {
        finalOverrides[key] = defaultValue;
        break;
      }

      try {
        finalOverrides[key] = parser(answer, key);
        break;
      } catch (error) {
        console.error(`  Error: ${error.message}`);
        const retry = await askYesNo(rl, '  Try again for this value?', true);
        if (!retry) {
          delete finalOverrides[key];
          break;
        }
      }
    }
  }

  return finalOverrides;
}

function describePlan(plan, formatter) {
  const entries = Object.entries(plan.diff || {});
  if (entries.length === 0) {
    return;
  }
  entries.forEach(([key, diff]) => {
    console.log(`  ${key}: ${formatDiffEntry(diff.previous, diff.next, formatter)}`);
  });
}

async function confirmExecution({ rl, executeRequested }) {
  if (!executeRequested) {
    return false;
  }

  if (!rl) {
    return true;
  }

  return askYesNo(rl, 'Broadcast the transaction plan now?', true);
}

module.exports = async function (callback) {
  let rl = null;
  try {
    const options = parseConfiguratorArgs(process.argv);
    if (options.help) {
      printHelp();
      callback();
      return;
    }

    const networkName =
      extractNetwork(process.argv) || process.env.NETWORK || process.env.TRUFFLE_NETWORK || null;

    let jobRegistry;
    try {
      jobRegistry = await JobRegistry.deployed();
    } catch (error) {
      throw new Error('JobRegistry deployment not found on the selected network. Run migrations before invoking the wizard.');
    }
    const jobRegistryAddress = toChecksum(jobRegistry.address);

    const accounts = await web3.eth.getAccounts();
    const sender = options.from || process.env.CONFIGURE_REGISTRY_FROM || accounts[0] || null;
    if (!sender) {
      throw new Error('No sender account available. Provide --from or unlock an account.');
    }

    const owner = toChecksum(await jobRegistry.owner());
    const senderChecksum = toChecksum(sender);

    const [modules, timings, thresholds, configurationStatus] = await Promise.all([
      jobRegistry.modules(),
      jobRegistry.timings(),
      jobRegistry.thresholds(),
      jobRegistry.configurationStatus(),
    ]);

    const currentModules = normalizeModuleStruct(modules);
    const currentTimings = normalizeNumericStruct(timings, TIMING_KEYS);
    const currentThresholds = normalizeNumericStruct(thresholds, THRESHOLD_KEYS);
    const configuration = {
      modules: Boolean(configurationStatus[0]),
      timings: Boolean(configurationStatus[1]),
      thresholds: Boolean(configurationStatus[2]),
    };

    const paramsConfig = loadParamsConfig(options.paramsPath);
    let moduleDefaults = {};
    try {
      moduleDefaults = await resolveModuleDefaults(options.modules);
    } catch (error) {
      console.warn(`Warning: ${error.message}`);
      moduleDefaults = {};
    }

    const moduleOverrides = filterDefinedKeys(options.modules, MODULE_KEYS);
    const timingOverrides = filterDefinedKeys(options.timings, TIMING_KEYS);
    const thresholdOverrides = filterDefinedKeys(options.thresholds, THRESHOLD_KEYS);

    const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY);
    rl = interactive ? createPromptInterface() : null;

    console.log('AGIJobsv1 — JobRegistry configuration wizard');
    console.log(`Network: ${networkName || '(unspecified)'}`);
    console.log(`JobRegistry: ${jobRegistryAddress}`);
    console.log(`Owner: ${owner || '(unknown)'}`);
    console.log(`Sender: ${senderChecksum}`);
    console.log(
      `Configuration flags: modules=${configuration.modules ? '✓' : '✗'} timings=${
        configuration.timings ? '✓' : '✗'
      } thresholds=${configuration.thresholds ? '✓' : '✗'}`
    );

    printCurrentConfiguration({ modules: currentModules, timings: currentTimings, thresholds: currentThresholds });

    if (!interactive && !hasDefinedEntries(moduleOverrides) && !hasDefinedEntries(timingOverrides) && !hasDefinedEntries(thresholdOverrides)) {
      console.warn('Warning: stdin/stdout are not TTYs. Provide explicit overrides via CLI flags to use the wizard non-interactively.');
    }

    const finalModuleOverrides = await collectModuleOverrides({
      rl,
      currentModules,
      moduleDefaults,
      overrides: moduleOverrides,
    });

    const finalTimingOverrides = await collectNumericOverrides({
      rl,
      sectionLabel: 'timings',
      keys: TIMING_KEYS,
      currentValues: currentTimings,
      defaults: paramsConfig.values,
      overrides: timingOverrides,
      parser: parseTimingValue,
      unit: 'seconds',
    });

    const finalThresholdOverrides = await collectNumericOverrides({
      rl,
      sectionLabel: 'thresholds',
      keys: THRESHOLD_KEYS,
      currentValues: currentThresholds,
      defaults: paramsConfig.values,
      overrides: thresholdOverrides,
      parser: parseThresholdValue,
    });

    const plans = buildSetPlans({
      currentModules,
      currentTimings,
      currentThresholds,
      overrides: {
        modules: finalModuleOverrides,
        timings: finalTimingOverrides,
        thresholds: finalThresholdOverrides,
      },
      defaults: {
        modules: currentModules,
        timings: currentTimings,
        thresholds: currentThresholds,
      },
    });

    const anyChanges =
      (plans.modulesPlan && plans.modulesPlan.changed) ||
      (plans.timingsPlan && plans.timingsPlan.changed) ||
      (plans.thresholdsPlan && plans.thresholdsPlan.changed);

    if (!anyChanges) {
      console.log('No configuration changes detected. The JobRegistry already matches the desired state.');
      callback();
      return;
    }

    printSectionHeader('Planned updates');
    if (plans.modulesPlan && plans.modulesPlan.changed) {
      console.log('- Modules:');
      describePlan(plans.modulesPlan, (value) => formatAddress(value));
    }
    if (plans.timingsPlan && plans.timingsPlan.changed) {
      console.log('- Timings:');
      describePlan(plans.timingsPlan, (value) => `${value} seconds`);
    }
    if (plans.thresholdsPlan && plans.thresholdsPlan.changed) {
      console.log('- Thresholds:');
      describePlan(plans.thresholdsPlan, (value) => `${value}`);
    }

    const planSummary = buildSetPlanSummary({
      jobRegistry,
      jobRegistryAddress,
      sender: senderChecksum,
      plans,
      configuration: {
        modules: currentModules,
        timings: currentTimings,
        thresholds: currentThresholds,
      },
      variant: options.variant || networkName,
      dryRun: !options.execute,
    });

    console.log('');
    console.log('Safe-ready plan summary:');
    console.log(JSON.stringify(planSummary, null, 2));

    if (options.planOutPath) {
      const destination = writePlanSummary(planSummary, options.planOutPath);
      console.log(`Plan written to ${destination}`);
    }

    const shouldExecute = await confirmExecution({ rl, executeRequested: options.execute });
    if (!shouldExecute) {
      console.log('Dry run complete. Re-run with --execute to broadcast the transactions.');
      callback();
      return;
    }

    if (!owner || owner.toLowerCase() !== senderChecksum.toLowerCase()) {
      throw new Error(`Sender ${senderChecksum} is not the JobRegistry owner (${owner}).`);
    }

    const receipts = [];
    if (plans.modulesPlan && plans.modulesPlan.changed) {
      const receipt = await jobRegistry.setModules(plans.modulesPlan.desired, { from: senderChecksum });
      receipts.push({ method: 'setModules', hash: receipt.tx });
    }
    if (plans.timingsPlan && plans.timingsPlan.changed) {
      const { commitWindow, revealWindow, disputeWindow } = plans.timingsPlan.desired;
      const receipt = await jobRegistry.setTimings(commitWindow, revealWindow, disputeWindow, {
        from: senderChecksum,
      });
      receipts.push({ method: 'setTimings', hash: receipt.tx });
    }
    if (plans.thresholdsPlan && plans.thresholdsPlan.changed) {
      const { approvalThresholdBps, quorumMin, quorumMax, feeBps, slashBpsMax } =
        plans.thresholdsPlan.desired;
      const receipt = await jobRegistry.setThresholds(
        approvalThresholdBps,
        quorumMin,
        quorumMax,
        feeBps,
        slashBpsMax,
        { from: senderChecksum }
      );
      receipts.push({ method: 'setThresholds', hash: receipt.tx });
    }

    console.log('Transactions broadcast successfully:');
    receipts.forEach((entry) => {
      console.log(`  ${entry.method}: ${entry.hash}`);
    });
    callback();
  } catch (error) {
    if (error) {
      console.error(error.message || error);
    }
    callback(error);
  } finally {
    if (rl) {
      rl.close();
    }
  }
};
