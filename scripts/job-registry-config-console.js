const JobRegistry = artifacts.require('JobRegistry');

const {
  ACTIONS,
  parseConfigConsoleArgs,
  buildSetPlans,
  buildUpdatePlan,
  formatPlanDiff,
} = require('./lib/job-registry-config-console');
const {
  extractNetwork,
  loadParamsConfig,
  toChecksum,
  formatAddress,
  formatDiffEntry,
  normalizeModuleStruct,
  normalizeNumericStruct,
} = require('./lib/job-registry-config-utils');
const { resolveModuleDefaults } = require('./lib/job-registry-config-defaults');
const { resolveVariant } = require('./config-loader');
const { TIMING_KEYS, THRESHOLD_KEYS } = require('./lib/job-registry-configurator');

function printHelp() {
  console.log('AGI Jobs v1 — JobRegistry configuration console');
  console.log(
    'Usage: npx truffle exec scripts/job-registry-config-console.js --network <network> [action] [options]'
  );
  console.log('');
  console.log('Actions:');
  console.log('  status   Display current configuration (default)');
  console.log(
    '  set      Align on-chain configuration with config files and overrides (uses setModules/setTimings/setThresholds)'
  );
  console.log(
    '  update   Update a single module/timing/threshold using updateModule/updateTiming/updateThreshold'
  );
  console.log('');
  console.log('Common options:');
  console.log('  --from <address>         Sender address (defaults to first unlocked account)');
  console.log('  --execute[=true|false]  Broadcast transaction instead of dry run');
  console.log('  --dry-run[=true|false]  Alias for --execute');
  console.log('  --params <path>         Override params JSON path (set action)');
  console.log('  --variant <name>        Optional environment hint for logging');
  console.log('  --help                  Show this message');
  console.log('');
  console.log('Set action overrides:');
  console.log('  --modules.<key> <address>     identity, staking, validation, dispute, reputation, feePool');
  console.log('  --timings.<key> <seconds>     commitWindow, revealWindow, disputeWindow');
  console.log(
    '  --thresholds.<key> <value>   approvalThresholdBps, quorumMin, quorumMax, feeBps, slashBpsMax'
  );
  console.log('');
  console.log('Update action example:');
  console.log(
    '  npx truffle exec scripts/job-registry-config-console.js --network mainnet update --thresholds.feeBps 275'
  );
}

function printSection(label, values, formatter) {
  console.log(`- ${label}:`);
  const entries = Object.entries(values || {});
  if (entries.length === 0) {
    console.log('    (no data)');
    return;
  }
  entries.forEach(([key, value]) => {
    if (value === null || value === undefined) {
      console.log(`    ${key}: (unset)`);
    } else {
      console.log(`    ${key}: ${formatter(value)}`);
    }
  });
}

function printDiffSection(label, diff, formatter) {
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

function describeConfigurationStatus(status) {
  const icons = (value) => (value ? '✓' : '✗');
  return `modules=${icons(status.modules)} timings=${icons(status.timings)} thresholds=${icons(status.thresholds)}`;
}

module.exports = async function (callback) {
  try {
    const options = parseConfigConsoleArgs(process.argv);
    if (options.help) {
      printHelp();
      callback();
      return;
    }

    const action = options.action || ACTIONS.STATUS;
    if (!Object.values(ACTIONS).includes(action)) {
      throw new Error(`Unsupported action "${options.action}". Use status, set, or update.`);
    }

    const networkName =
      extractNetwork(process.argv) || process.env.NETWORK || process.env.TRUFFLE_NETWORK || null;

    let resolvedVariant = null;
    if (options.variant || networkName) {
      try {
        resolvedVariant = resolveVariant(options.variant || networkName);
      } catch (error) {
        console.warn(
          `Warning: unable to resolve variant for "${options.variant || networkName}": ${error.message}`
        );
      }
    }

    const jobRegistry = await JobRegistry.deployed();
    const jobRegistryAddress = toChecksum(jobRegistry.address);
    const owner = toChecksum(await jobRegistry.owner());

    const accounts = await web3.eth.getAccounts();
    const senderOverride = options.from || process.env.CONFIGURE_REGISTRY_FROM || null;
    const sender = senderOverride
      ? toChecksum(senderOverride)
      : accounts[0]
        ? toChecksum(accounts[0])
        : null;

    if (!sender) {
      throw new Error('No sender account is available. Specify --from or unlock an account.');
    }

    const [modules, timings, thresholds, configStatus] = await Promise.all([
      jobRegistry.modules(),
      jobRegistry.timings(),
      jobRegistry.thresholds(),
      jobRegistry.configurationStatus(),
    ]);

    const currentModules = normalizeModuleStruct(modules);
    const currentTimings = normalizeNumericStruct(timings, TIMING_KEYS);
    const currentThresholds = normalizeNumericStruct(thresholds, THRESHOLD_KEYS);
    const configuration = {
      modules: Boolean(configStatus[0]),
      timings: Boolean(configStatus[1]),
      thresholds: Boolean(configStatus[2]),
    };

    console.log('AGIJobsv1 — JobRegistry configuration console');
    console.log(`Action: ${action}`);
    console.log(
      `Network: ${networkName || '(unspecified)'}${resolvedVariant ? ` (variant: ${resolvedVariant})` : ''}`
    );
    console.log(`JobRegistry: ${jobRegistryAddress}`);
    console.log(`Owner: ${owner || '(unknown)'}`);
    console.log(`Sender: ${sender}`);
    console.log(`Configuration: ${describeConfigurationStatus(configuration)}`);
    console.log('');

    if (action === ACTIONS.STATUS) {
      printSection('Modules', currentModules, (value) => formatAddress(value));
      console.log('');
      printSection('Timings', currentTimings, (value) => `${value} seconds`);
      console.log('');
      printSection('Thresholds', currentThresholds, (value) => `${value}`);
      callback();
      return;
    }

    const shouldExecute = Boolean(options.execute);
    if (owner && owner.toLowerCase() !== sender.toLowerCase()) {
      console.warn(
        `Warning: sender ${sender} is not the JobRegistry owner (${owner}). Transactions may revert unless forwarded through the owner.`
      );
    }

    if (action === ACTIONS.SET) {
      const paramsConfig = loadParamsConfig(options.paramsPath);
      const moduleDefaults = await resolveModuleDefaults(options.modules);
      const plans = buildSetPlans({
        currentModules,
        currentTimings,
        currentThresholds,
        overrides: {
          modules: options.modules,
          timings: options.timings,
          thresholds: options.thresholds,
        },
        defaults: {
          modules: moduleDefaults,
          timings: paramsConfig.values,
          thresholds: paramsConfig.values,
        },
      });

      console.log(`Params file: ${paramsConfig.path}`);
      console.log('');
      console.log('Planned updates:');
      printDiffSection('Modules', plans.modulesPlan.diff, (value) => formatAddress(value));
      printDiffSection('Timings', plans.timingsPlan.diff, (value) => `${value} seconds`);
      printDiffSection('Thresholds', plans.thresholdsPlan.diff, (value) => `${value}`);

      const actions = [];
      if (plans.modulesPlan.changed) {
        actions.push(async () => {
          console.log('Executing setModules…');
          const receipt = await jobRegistry.setModules(plans.modulesPlan.desired, { from: sender });
          console.log(`  ✓ setModules tx: ${receipt.tx}`);
        });
      }
      if (plans.timingsPlan.changed) {
        actions.push(async () => {
          console.log('Executing setTimings…');
          const { commitWindow, revealWindow, disputeWindow } = plans.timingsPlan.desired;
          const receipt = await jobRegistry.setTimings(commitWindow, revealWindow, disputeWindow, {
            from: sender,
          });
          console.log(`  ✓ setTimings tx: ${receipt.tx}`);
        });
      }
      if (plans.thresholdsPlan.changed) {
        actions.push(async () => {
          console.log('Executing setThresholds…');
          const { approvalThresholdBps, quorumMin, quorumMax, feeBps, slashBpsMax } =
            plans.thresholdsPlan.desired;
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

      if (!shouldExecute) {
        console.log('\nDry run complete — re-run with --execute to broadcast the above changes.');
        callback();
        return;
      }

      for (const actionFn of actions) {
        await actionFn();
      }

      console.log('\nConfiguration updates applied successfully.');
      callback();
      return;
    }

    if (action === ACTIONS.UPDATE) {
      const plan = buildUpdatePlan({
        overrides: {
          modules: options.modules,
          timings: options.timings,
          thresholds: options.thresholds,
        },
        currentModules,
        currentTimings,
        currentThresholds,
      });

      const formatter = plan.summary.section === 'modules'
        ? (value) => formatAddress(value)
        : plan.summary.section === 'timings'
          ? (value) => `${value} seconds`
          : (value) => `${value}`;

      console.log('Planned single-field update:');
      console.log(
        `- ${plan.summary.section}.${plan.summary.key}: ${formatPlanDiff(plan.summary, formatter)}`
      );

      const callData = jobRegistry.contract.methods[plan.method](...plan.args).encodeABI();

      if (!shouldExecute) {
        console.log('Dry run: transaction not broadcast.');
        console.log(
          JSON.stringify(
            {
              to: jobRegistry.address,
              from: sender,
              data: callData,
              value: '0',
              description: `JobRegistry.${plan.method}`,
              arguments: plan.args,
            },
            null,
            2
          )
        );
        callback();
        return;
      }

      if (!owner || owner.toLowerCase() !== sender.toLowerCase()) {
        throw new Error(`Sender ${sender} is not the JobRegistry owner (${owner}).`);
      }

      const receipt = await jobRegistry[plan.method](...plan.args, { from: sender });
      console.log(`Transaction broadcast. Hash: ${receipt.tx}`);
      callback();
      return;
    }

    throw new Error(`Unhandled action: ${action}`);
  } catch (error) {
    callback(error);
  }
};
