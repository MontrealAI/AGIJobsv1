const fs = require('fs');
const path = require('path');

const JobRegistry = artifacts.require('JobRegistry');
const IdentityRegistry = artifacts.require('IdentityRegistry');
const StakeManager = artifacts.require('StakeManager');
const ValidationModule = artifacts.require('ValidationModule');
const DisputeModule = artifacts.require('DisputeModule');
const ReputationEngine = artifacts.require('ReputationEngine');
const FeePool = artifacts.require('FeePool');

const {
  parseConfiguratorArgs,
  computeModulesPlan,
  computeTimingsPlan,
  computeThresholdsPlan,
  MODULE_KEYS,
  TIMING_KEYS,
  THRESHOLD_KEYS,
} = require('./lib/job-registry-configurator');
const { resolveVariant } = require('./config-loader');

const MODULE_ARTIFACTS = {
  identity: IdentityRegistry,
  staking: StakeManager,
  validation: ValidationModule,
  dispute: DisputeModule,
  reputation: ReputationEngine,
  feePool: FeePool,
};

function extractNetwork(argv) {
  for (let i = 2; i < argv.length; i++) {
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
    : path.join(__dirname, '..', 'config', 'params.json');

  const raw = fs.readFileSync(resolvedPath, 'utf8');
  const parsed = JSON.parse(raw);
  return { path: resolvedPath, values: parsed };
}

function toChecksum(address) {
  if (!address) {
    return null;
  }

  try {
    return web3.utils.toChecksumAddress(address);
  } catch (error) {
    return address;
  }
}

function formatAddress(address) {
  const checksum = toChecksum(address);
  return checksum ? checksum : '(unset)';
}

function formatDiffEntry(previous, next, formatter = (value) => value) {
  const prevFormatted =
    previous === null || previous === undefined ? '(unset)' : formatter(previous);
  const nextFormatted = formatter(next);
  return `${prevFormatted} -> ${nextFormatted}`;
}

async function resolveModuleDefaults(overrides) {
  const defaults = {};

  for (const key of MODULE_KEYS) {
    if (overrides[key] !== undefined && overrides[key] !== null) {
      continue;
    }

    const artifact = MODULE_ARTIFACTS[key];
    if (!artifact) {
      continue;
    }

    try {
      const instance = await artifact.deployed();
      defaults[key] = instance.address;
    } catch (error) {
      throw new Error(
        `Unable to determine default deployment for modules.${key}. Provide an explicit override with --modules.${key}.`
      );
    }
  }

  return defaults;
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
      normalized[key] = Number(value.toString());
      return;
    }

    normalized[key] = Number(value);
  });
  return normalized;
}

function printSectionDiff(label, diff, formatter) {
  const entries = Object.entries(diff);
  if (entries.length === 0) {
    console.log(`- ${label}: no changes required.`);
    return;
  }

  console.log(`- ${label}:`);
  entries.forEach(([key, { previous, next }]) => {
    console.log(`    ${key}: ${formatDiffEntry(previous, next, formatter)}`);
  });
}

function printHelp() {
  console.log(
    `Usage: npx truffle exec scripts/configure-job-registry.js --network <network> [options]\n`
  );
  console.log('Options:');
  console.log('  --execute                     Send transactions instead of performing a dry run');
  console.log('  --dry-run=false               Alias for --execute');
  console.log('  --from <address>              Sender address for execution');
  console.log(
    '  --params <path>               Override params JSON path (defaults to config/params.json)'
  );
  console.log(
    '  --modules.<key> <address>     Override module address (identity, staking, validation, dispute, reputation, feePool)'
  );
  console.log(
    '  --timings.<key> <seconds>     Override lifecycle timing (commitWindow, revealWindow, disputeWindow)'
  );
  console.log(
    '  --thresholds.<key> <value>    Override economic threshold (approvalThresholdBps, quorumMin, quorumMax, feeBps, slashBpsMax)'
  );
  console.log('  --variant <name>              Explicit config variant hint for logging');
  console.log('  --help                        Show this help message');
}

module.exports = async function (callback) {
  try {
    const parsedArgs = parseConfiguratorArgs(process.argv);
    if (parsedArgs.help) {
      printHelp();
      callback();
      return;
    }

    const networkName =
      extractNetwork(process.argv) || process.env.NETWORK || process.env.TRUFFLE_NETWORK || null;

    let resolvedVariant = null;
    if (parsedArgs.variant || networkName) {
      try {
        resolvedVariant = resolveVariant(parsedArgs.variant || networkName);
      } catch (error) {
        console.warn(
          `Warning: unable to resolve variant for "${parsedArgs.variant || networkName}": ${error.message}`
        );
      }
    }

    const paramsConfig = loadParamsConfig(parsedArgs.paramsPath);

    const jobRegistry = await JobRegistry.deployed();
    const jobRegistryAddress = toChecksum(jobRegistry.address);
    const owner = toChecksum(await jobRegistry.owner());

    const accounts = await web3.eth.getAccounts();
    const senderOverride = parsedArgs.from || process.env.CONFIGURE_REGISTRY_FROM || null;
    const sender = senderOverride
      ? toChecksum(senderOverride)
      : accounts[0]
        ? toChecksum(accounts[0])
        : null;

    if (!sender) {
      throw new Error(
        'Unable to determine sender account. Provide --from <address> or set CONFIGURE_REGISTRY_FROM.'
      );
    }

    const moduleDefaults = await resolveModuleDefaults(parsedArgs.modules);
    const currentModules = normalizeModuleStruct(await jobRegistry.modules());
    const currentTimings = normalizeNumericStruct(await jobRegistry.timings(), TIMING_KEYS);
    const currentThresholds = normalizeNumericStruct(
      await jobRegistry.thresholds(),
      THRESHOLD_KEYS
    );

    const modulesPlan = computeModulesPlan({
      current: currentModules,
      overrides: parsedArgs.modules,
      defaults: moduleDefaults,
    });

    const timingsPlan = computeTimingsPlan({
      current: currentTimings,
      overrides: parsedArgs.timings,
      defaults: paramsConfig.values,
    });

    const thresholdsPlan = computeThresholdsPlan({
      current: currentThresholds,
      overrides: parsedArgs.thresholds,
      defaults: paramsConfig.values,
    });

    console.log('AGIJobsv1 — JobRegistry configuration planner');
    console.log(
      `Network: ${networkName || '(unspecified)'}${resolvedVariant ? ` (variant: ${resolvedVariant})` : ''}`
    );
    console.log(`Params file: ${paramsConfig.path}`);
    console.log(`JobRegistry: ${jobRegistryAddress}`);
    console.log(`Owner: ${owner || '(unknown)'}`);
    console.log(`Sender: ${sender}`);

    if (owner && owner.toLowerCase() !== sender.toLowerCase()) {
      console.warn(
        `Warning: sender ${sender} is not the JobRegistry owner. Transactions will likely revert unless forwarded through the owner account.`
      );
    }

    console.log('\nPlanned updates:');
    printSectionDiff('Modules', modulesPlan.diff, (value) => formatAddress(value));
    printSectionDiff('Timings', timingsPlan.diff, (value) => `${value} seconds`);
    printSectionDiff('Thresholds', thresholdsPlan.diff, (value) => `${value}`);

    const actions = [];
    if (modulesPlan.changed) {
      actions.push(async () => {
        console.log('Executing setModules…');
        const receipt = await jobRegistry.setModules(modulesPlan.desired, { from: sender });
        console.log(`  ✓ setModules tx: ${receipt.tx}`);
      });
    }

    if (timingsPlan.changed) {
      actions.push(async () => {
        console.log('Executing setTimings…');
        const { commitWindow, revealWindow, disputeWindow } = timingsPlan.desired;
        const receipt = await jobRegistry.setTimings(commitWindow, revealWindow, disputeWindow, {
          from: sender,
        });
        console.log(`  ✓ setTimings tx: ${receipt.tx}`);
      });
    }

    if (thresholdsPlan.changed) {
      actions.push(async () => {
        console.log('Executing setThresholds…');
        const { approvalThresholdBps, quorumMin, quorumMax, feeBps, slashBpsMax } =
          thresholdsPlan.desired;
        const receipt = await jobRegistry.setThresholds(
          approvalThresholdBps,
          quorumMin,
          quorumMax,
          feeBps,
          slashBpsMax,
          { from: sender }
        );
        console.log(`  ✓ setThresholds tx: ${receipt.tx}`);
      });
    }

    if (actions.length === 0) {
      console.log('\nAll sections already match the desired configuration.');
      callback();
      return;
    }

    if (!parsedArgs.execute) {
      console.log('\nDry run complete — re-run with --execute to broadcast the above changes.');
      callback();
      return;
    }

    for (const action of actions) {
      await action();
    }

    console.log('\nConfiguration updates applied successfully.');
    callback();
  } catch (error) {
    callback(error);
  }
};
