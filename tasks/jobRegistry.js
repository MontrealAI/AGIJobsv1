'use strict';

const fs = require('fs');
const path = require('path');
const { task, types } = require('hardhat/config');

const {
  collectOwnerStatus,
  buildOwnerTxPlan,
  formatStatusLines,
  formatTxPlanLines,
} = require('../scripts/lib/job-registry-owner');
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

function buildCallSummary({ plan, callData, registryAddress, sender }) {
  return {
    action: plan.action,
    method: plan.method,
    args: serializeForJson(plan.args),
    metadata: serializeForJson(plan.metadata),
    call: {
      to: registryAddress,
      data: callData,
      value: '0',
      from: sender || null,
    },
  };
}

function maybeWriteSummary(summary, outputPath) {
  if (!outputPath) {
    return null;
  }

  const resolvedPath = path.resolve(outputPath);
  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
  fs.writeFileSync(resolvedPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  return resolvedPath;
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

  const summary = buildCallSummary({ plan, callData, registryAddress: registry.address, sender });

  if (args.planOut) {
    const writtenPath = maybeWriteSummary(summary, args.planOut);
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
