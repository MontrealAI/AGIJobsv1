'use strict';

const { task, types } = require('hardhat/config');

const {
  collectOwnerStatus,
  buildOwnerTxPlan,
  formatStatusLines,
  formatTxPlanLines,
  buildOwnerCallSummary,
  writeOwnerCallSummary,
} = require('../scripts/lib/job-registry-owner');
const {
  buildSetPlans,
  buildUpdatePlan,
  formatPlanDiff,
} = require('../scripts/lib/job-registry-config-console');
const {
  loadParamsConfig,
  formatAddress,
  formatDiffEntry,
  normalizeModuleStruct,
  normalizeNumericStruct,
} = require('../scripts/lib/job-registry-config-utils');
const { resolveModuleDefaults } = require('../scripts/lib/job-registry-config-defaults');
const {
  buildSetPlanSummary,
  buildUpdatePlanSummary,
  writePlanSummary,
} = require('../scripts/lib/job-registry-plan-writer');
const { TIMING_KEYS, THRESHOLD_KEYS } = require('../scripts/lib/job-registry-configurator');
const { serializeForJson } = require('../scripts/lib/json-utils');

async function resolveRegistry(hre, registryAddress) {
  const JobRegistry = hre.artifacts.require('JobRegistry');
  if (registryAddress) {
    return JobRegistry.at(registryAddress);
  }
  return JobRegistry.deployed();
}

async function resolveSender(hre, explicit) {
  if (explicit) {
    return explicit;
  }

  const accounts = await hre.web3.eth.getAccounts();
  if (!accounts || accounts.length === 0) {
    throw new Error('No unlocked accounts are available. Specify --from explicitly.');
  }

  return accounts[0];
}

function ensureOwner(sender, owner) {
  if (!owner) {
    throw new Error('JobRegistry owner is not configured on-chain.');
  }

  if (sender.toLowerCase() !== owner.toLowerCase()) {
    throw new Error(
      `Sender ${sender} is not the JobRegistry owner (${owner}). ` +
        'Provide --from with the owner account or forward the generated plan through the owner multisig.',
    );
  }
}

function printLines(lines) {
  lines.forEach((line) => {
    console.log(line);
  });
}

function ensurePlainObject(label, value) {
  if (value === undefined || value === null) {
    return {};
  }

  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} overrides must be provided as a JSON object`);
  }

  return value;
}

function parseOverrideArgs(args) {
  return {
    modules: ensurePlainObject('modules', args.modules),
    timings: ensurePlainObject('timings', args.timings),
    thresholds: ensurePlainObject('thresholds', args.thresholds),
  };
}

async function collectConfigurationSnapshot(registry) {
  const [modules, timings, thresholds, status] = await Promise.all([
    registry.modules(),
    registry.timings(),
    registry.thresholds(),
    registry.configurationStatus(),
  ]);

  return {
    modules: normalizeModuleStruct(modules),
    timings: normalizeNumericStruct(timings, TIMING_KEYS),
    thresholds: normalizeNumericStruct(thresholds, THRESHOLD_KEYS),
    status: {
      modules: Boolean(status[0]),
      timings: Boolean(status[1]),
      thresholds: Boolean(status[2]),
    },
  };
}

function describeConfigurationStatus(status) {
  const icon = (value) => (value ? '✓' : '✗');
  return `modules=${icon(status.modules)} timings=${icon(status.timings)} thresholds=${icon(status.thresholds)}`;
}

function printPlanDiffSection(label, plan, formatter) {
  if (!plan || !plan.changed) {
    console.log(`- ${label}: no changes required.`);
    return;
  }

  console.log(`- ${label}:`);
  Object.entries(plan.diff).forEach(([key, diff]) => {
    console.log(`    ${key}: ${formatDiffEntry(diff.previous, diff.next, formatter)}`);
  });
}

function hasSetPlanChanges(plans) {
  return Boolean(
    (plans.modulesPlan && plans.modulesPlan.changed) ||
      (plans.timingsPlan && plans.timingsPlan.changed) ||
      (plans.thresholdsPlan && plans.thresholdsPlan.changed)
  );
}

function printTransactionSteps(steps) {
  if (!Array.isArray(steps) || steps.length === 0) {
    console.log('No transactions are required — configuration already matches the desired state.');
    return;
  }

  console.log('Planned transactions:');
  steps.forEach((step, index) => {
    console.log(`  [${index + 1}] ${step.description}`);
    console.log(`      args: ${JSON.stringify(step.arguments)}`);
    console.log(`      to: ${step.call.to}`);
    console.log(`      data: ${step.call.data}`);
  });
}

function selectDiffFormatter(section, web3Instance) {
  if (section === 'modules') {
    return (value) => formatAddress(value, web3Instance);
  }

  if (section === 'timings') {
    return (value) => `${value} seconds`;
  }

  return (value) => `${value}`;
}

async function handleOwnerAction(hre, args, action) {
  if (!args.job) {
    throw new Error('The --job parameter is required for JobRegistry owner actions.');
  }

  const registry = await resolveRegistry(hre, args.registry);
  const owner = await registry.owner();
  const sender = await resolveSender(hre, args.from);

  const planOptions = {
    action,
    jobId: args.job,
  };

  if (action === 'extend') {
    planOptions.commitExtension = args.commitExtension;
    planOptions.revealExtension = args.revealExtension;
    planOptions.disputeExtension = args.disputeExtension;
  } else if (action === 'finalize') {
    planOptions.success = args.success;
  } else if (action === 'timeout') {
    planOptions.slashAmount = args.slashAmount;
  } else if (action === 'resolve') {
    planOptions.slashWorker = args.slashWorker;
    planOptions.slashAmount = args.slashAmount;
    planOptions.reputationDelta = args.reputationDelta;
  }

  const plan = await buildOwnerTxPlan({ registry, web3: hre.web3, options: planOptions });
  const callData = registry.contract.methods[plan.method](...plan.args).encodeABI();
  const formatted = formatTxPlanLines(plan, callData, { to: registry.address });
  printLines(formatted);

  const summary = buildOwnerCallSummary(plan, callData, {
    to: registry.address,
    from: sender,
  });

  if (args.planOut) {
    const writtenPath = writeOwnerCallSummary(summary, args.planOut);
    console.log(`Plan summary written to ${writtenPath}`);
  }

  if (!args.execute) {
    console.log('Dry run: transaction not broadcast. Use --execute to submit the transaction.');
    console.log(JSON.stringify(summary.call, null, 2));
    return;
  }

  ensureOwner(sender, owner);
  const receipt = await registry[plan.method](...plan.args, { from: sender });
  console.log(`Transaction broadcast. Hash: ${receipt.tx}`);
}

function registerOwnerTask({ name, description, action, params = [] }) {
  const ownerTask = task(name, description)
    .addOptionalParam('registry', 'JobRegistry contract address')
    .addParam('job', 'Target job identifier')
    .addOptionalParam('from', 'Sender address', undefined, types.string)
    .addFlag('execute', 'Broadcast the transaction instead of performing a dry run')
    .addOptionalParam('planOut', 'Write a transaction summary JSON to the specified path', undefined, types.string);

  params.forEach((param) => {
    ownerTask.addOptionalParam(param.name, param.description, param.defaultValue, param.type);
  });

  ownerTask.setAction(async (args, hre) => handleOwnerAction(hre, args, action));
}

registerOwnerTask({
  name: 'job-registry:extend',
  description: "Extend a job's commit/reveal/dispute deadlines",
  action: 'extend',
  params: [
    { name: 'commitExtension', description: 'Additional commit window seconds', defaultValue: '0', type: types.string },
    { name: 'revealExtension', description: 'Additional reveal window seconds', defaultValue: '0', type: types.string },
    { name: 'disputeExtension', description: 'Additional dispute window seconds', defaultValue: '0', type: types.string },
  ],
});

registerOwnerTask({
  name: 'job-registry:finalize',
  description: 'Finalize a revealed job and settle stake',
  action: 'finalize',
  params: [
    { name: 'success', description: 'Whether the job succeeded', defaultValue: true, type: types.boolean },
  ],
});

registerOwnerTask({
  name: 'job-registry:timeout',
  description: 'Timeout a stalled job after the dispute window elapses',
  action: 'timeout',
  params: [
    { name: 'slashAmount', description: 'Stake amount to slash on timeout', defaultValue: '0', type: types.string },
  ],
});

registerOwnerTask({
  name: 'job-registry:resolve',
  description: 'Resolve an active dispute with optional slashing and reputation update',
  action: 'resolve',
  params: [
    { name: 'slashWorker', description: 'Slash the worker when resolving the dispute', defaultValue: false, type: types.boolean },
    { name: 'slashAmount', description: 'Amount of stake to slash from the worker', defaultValue: '0', type: types.string },
    { name: 'reputationDelta', description: 'Signed reputation delta applied to the worker', defaultValue: '0', type: types.string },
  ],
});

task('job-registry:status', 'Inspect JobRegistry configuration and optional job state')
  .addOptionalParam('registry', 'JobRegistry contract address')
  .addOptionalParam('job', 'Optional job identifier to inspect', undefined, types.string)
  .addFlag('json', 'Emit JSON instead of the human-readable summary')
  .setAction(async (args, hre) => {
    const registry = await resolveRegistry(hre, args.registry);
    const owner = await registry.owner();
    const status = await collectOwnerStatus({
      registry,
      web3: hre.web3,
      owner,
      jobId: args.job || null,
    });

    if (args.json) {
      console.log(JSON.stringify(serializeForJson(status), null, 2));
      return;
    }

    console.log('AGIJobsv1 — Hardhat JobRegistry status');
    console.log(`Contract: ${registry.address}`);
    console.log('');
    printLines(formatStatusLines(status));
  });

task('job-registry:set-config', 'Align JobRegistry configuration using repository defaults and optional overrides')
  .addOptionalParam('registry', 'JobRegistry contract address')
  .addOptionalParam('from', 'Sender address', undefined, types.string)
  .addOptionalParam('modules', 'JSON object of module overrides keyed by module name', undefined, types.json)
  .addOptionalParam('timings', 'JSON object of timing overrides keyed by lifecycle window', undefined, types.json)
  .addOptionalParam('thresholds', 'JSON object of threshold overrides keyed by governance field', undefined, types.json)
  .addOptionalParam('params', 'Path to params.json providing timing/threshold defaults', undefined, types.string)
  .addOptionalParam('variant', 'Optional configuration variant label for plan metadata', undefined, types.string)
  .addOptionalParam('planOut', 'Write the generated plan summary JSON to the specified path', undefined, types.string)
  .addFlag('execute', 'Broadcast the transactions instead of performing a dry run')
  .setAction(async (args, hre) => {
    const registry = await resolveRegistry(hre, args.registry);
    const owner = await registry.owner();
    const sender = await resolveSender(hre, args.from);

    const overrides = parseOverrideArgs(args);
    const snapshot = await collectConfigurationSnapshot(registry);
    const paramsConfig = loadParamsConfig(args.params);
    const moduleDefaults = await resolveModuleDefaults(overrides.modules);

    const plans = buildSetPlans({
      currentModules: snapshot.modules,
      currentTimings: snapshot.timings,
      currentThresholds: snapshot.thresholds,
      overrides,
      defaults: {
        modules: moduleDefaults,
        timings: paramsConfig.values,
        thresholds: paramsConfig.values,
      },
    });

    console.log('AGIJobsv1 — Hardhat JobRegistry set-config');
    console.log(`Contract: ${registry.address}`);
    console.log(`Owner: ${owner || '(unknown)'}`);
    console.log(`Sender: ${sender}`);
    console.log(`Configuration: ${describeConfigurationStatus(snapshot.status)}`);
    console.log('');

    printPlanDiffSection('Modules', plans.modulesPlan, (value) => formatAddress(value, hre.web3));
    printPlanDiffSection('Timings', plans.timingsPlan, (value) => `${value} seconds`);
    printPlanDiffSection('Thresholds', plans.thresholdsPlan, (value) => `${value}`);
    console.log('');

    const summary = buildSetPlanSummary({
      jobRegistry: registry,
      jobRegistryAddress: registry.address,
      sender,
      plans,
      configuration: snapshot.status,
      variant: args.variant || null,
      dryRun: !args.execute,
    });

    if (args.planOut) {
      const writtenPath = writePlanSummary(summary, args.planOut);
      console.log(`Plan summary written to ${writtenPath}`);
    }

    if (!hasSetPlanChanges(plans)) {
      console.log('No configuration changes required.');
      return;
    }

    if (owner && owner.toLowerCase() !== sender.toLowerCase()) {
      console.warn(
        `Warning: sender ${sender} is not the JobRegistry owner (${owner}). Transactions may revert unless forwarded through the owner account.`
      );
    }

    printTransactionSteps(summary.steps);

    if (!args.execute) {
      console.log('Dry run complete — re-run with --execute to broadcast the planned transactions.');
      return;
    }

    ensureOwner(sender, owner);

    if (plans.modulesPlan.changed) {
      const receipt = await registry.setModules(plans.modulesPlan.desired, { from: sender });
      console.log(`✓ setModules tx: ${receipt.tx}`);
    }

    if (plans.timingsPlan.changed) {
      const { commitWindow, revealWindow, disputeWindow } = plans.timingsPlan.desired;
      const receipt = await registry.setTimings(commitWindow, revealWindow, disputeWindow, { from: sender });
      console.log(`✓ setTimings tx: ${receipt.tx}`);
    }

    if (plans.thresholdsPlan.changed) {
      const { approvalThresholdBps, quorumMin, quorumMax, feeBps, slashBpsMax } = plans.thresholdsPlan.desired;
      const receipt = await registry.setThresholds(
        approvalThresholdBps,
        quorumMin,
        quorumMax,
        feeBps,
        slashBpsMax,
        { from: sender }
      );
      console.log(`✓ setThresholds tx: ${receipt.tx}`);
    }
  });

task('job-registry:update-config', 'Update a single JobRegistry module, timing, or threshold value')
  .addOptionalParam('registry', 'JobRegistry contract address')
  .addOptionalParam('from', 'Sender address', undefined, types.string)
  .addOptionalParam('modules', 'JSON object containing the module override to apply', undefined, types.json)
  .addOptionalParam('timings', 'JSON object containing the timing override to apply', undefined, types.json)
  .addOptionalParam('thresholds', 'JSON object containing the threshold override to apply', undefined, types.json)
  .addOptionalParam('variant', 'Optional configuration variant label for plan metadata', undefined, types.string)
  .addOptionalParam('planOut', 'Write the generated plan summary JSON to the specified path', undefined, types.string)
  .addFlag('execute', 'Broadcast the transaction instead of performing a dry run')
  .setAction(async (args, hre) => {
    const registry = await resolveRegistry(hre, args.registry);
    const owner = await registry.owner();
    const sender = await resolveSender(hre, args.from);

    const overrides = parseOverrideArgs(args);
    const snapshot = await collectConfigurationSnapshot(registry);
    const plan = buildUpdatePlan({
      overrides,
      currentModules: snapshot.modules,
      currentTimings: snapshot.timings,
      currentThresholds: snapshot.thresholds,
    });

    console.log('AGIJobsv1 — Hardhat JobRegistry update-config');
    console.log(`Contract: ${registry.address}`);
    console.log(`Owner: ${owner || '(unknown)'}`);
    console.log(`Sender: ${sender}`);
    console.log(`Configuration: ${describeConfigurationStatus(snapshot.status)}`);
    console.log('');

    const formatter = selectDiffFormatter(plan.summary.section, hre.web3);
    console.log(
      `- ${plan.summary.section}.${plan.summary.key}: ${formatPlanDiff(plan.summary, formatter)}`
    );
    console.log('');

    const summary = buildUpdatePlanSummary({
      jobRegistry: registry,
      jobRegistryAddress: registry.address,
      sender,
      plan,
      configuration: snapshot.status,
      variant: args.variant || null,
      dryRun: !args.execute,
    });

    if (args.planOut) {
      const writtenPath = writePlanSummary(summary, args.planOut);
      console.log(`Plan summary written to ${writtenPath}`);
    }

    if (owner && owner.toLowerCase() !== sender.toLowerCase()) {
      console.warn(
        `Warning: sender ${sender} is not the JobRegistry owner (${owner}). Transactions may revert unless forwarded through the owner account.`
      );
    }

    printTransactionSteps(summary.steps);

    if (!args.execute) {
      console.log('Dry run complete — re-run with --execute to submit the transaction.');
      return;
    }

    ensureOwner(sender, owner);
    const receipt = await registry[plan.method](...plan.args, { from: sender });
    console.log(`✓ ${plan.method} tx: ${receipt.tx}`);
  });
