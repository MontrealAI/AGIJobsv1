'use strict';

const { task, types } = require('hardhat/config');

const {
  buildCallSummary,
  ensureAddress,
  ensureOwner,
  formatAddress,
  maybeWriteSummary,
  printPlanSummary,
  resolveSender,
  toChecksum,
} = require('../scripts/lib/owner-task-utils');

async function resolveDisputeModule(hre, explicitAddress) {
  const DisputeModule = hre.artifacts.require('DisputeModule');
  if (explicitAddress) {
    return DisputeModule.at(explicitAddress);
  }
  return DisputeModule.deployed();
}

function describeNetwork(hre) {
  return (hre.network && hre.network.name) || 'unknown';
}

function buildStatusSummary({ hre, disputeModule, owner, jobRegistry, paused }) {
  return {
    network: describeNetwork(hre),
    disputeModule: toChecksum(hre.web3, disputeModule.address),
    owner: toChecksum(hre.web3, owner),
    jobRegistry: toChecksum(hre.web3, jobRegistry),
    paused: Boolean(paused),
  };
}

function printStatus(summary, hre) {
  console.log(`DisputeModule status on ${summary.network}:`);
  console.log(`- Address: ${formatAddress(hre.web3, summary.disputeModule)}`);
  console.log(`- Owner: ${formatAddress(hre.web3, summary.owner)}`);
  console.log(`- Job registry: ${formatAddress(hre.web3, summary.jobRegistry)}`);
  console.log(`- Paused: ${summary.paused ? 'yes' : 'no'}`);
}

task('dispute-module:status', 'Inspect DisputeModule ownership, wiring, and pause state')
  .addOptionalParam('dispute', 'Address of the DisputeModule contract', undefined, types.string)
  .addFlag('json', 'Emit the summary as JSON for automation pipelines')
  .setAction(async (args, hre) => {
    const disputeModule = await resolveDisputeModule(hre, args.dispute);
    const [owner, jobRegistry, paused] = await Promise.all([
      disputeModule.owner(),
      disputeModule.jobRegistry(),
      disputeModule.paused(),
    ]);

    const summary = buildStatusSummary({ hre, disputeModule, owner, jobRegistry, paused });

    if (args.json) {
      console.log(JSON.stringify(summary, null, 2));
      return;
    }

    printStatus(summary, hre);
  });

task('dispute-module:set-registry', 'Initializes the JobRegistry authorized to raise disputes')
  .addOptionalParam('dispute', 'Address of the DisputeModule contract', undefined, types.string)
  .addParam('registry', 'Address of the JobRegistry contract', undefined, types.string)
  .addOptionalParam('from', 'Sender address (defaults to the first unlocked account)', undefined, types.string)
  .addOptionalParam('planOut', 'Optional path to write a Safe-ready summary JSON', undefined, types.string)
  .addFlag('execute', 'Broadcast the transaction after confirmation')
  .setAction(async (args, hre) => {
    const disputeModule = await resolveDisputeModule(hre, args.dispute);
    const owner = await disputeModule.owner();
    const sender = await resolveSender(hre, args.from);
    ensureOwner(sender, owner, 'DisputeModule');

    const registryAddress = ensureAddress(hre.web3, args.registry, '--registry');
    const currentRegistry = await disputeModule.jobRegistry();
    if (currentRegistry && currentRegistry !== '0x0000000000000000000000000000000000000000') {
      throw new Error(
        `DisputeModule already has a job registry configured (${currentRegistry}). Use dispute-module:update-registry instead.`,
      );
    }

    const callData = disputeModule.contract.methods.setJobRegistry(registryAddress).encodeABI();
    const plan = buildCallSummary({
      action: 'dispute-module:setJobRegistry',
      method: 'setJobRegistry(address)',
      args: [registryAddress],
      metadata: {
        previousRegistry: currentRegistry || null,
        newRegistry: registryAddress,
      },
      contractAddress: disputeModule.address,
      sender,
      callData,
    });

    printPlanSummary(plan);
    const writtenPath = maybeWriteSummary(args.planOut, plan);
    if (writtenPath) {
      console.log(`Plan summary written to ${writtenPath}`);
    }

    if (!args.execute) {
      console.log('Dry run complete — re-run with --execute to broadcast the transaction.');
      return;
    }

    await disputeModule.setJobRegistry(registryAddress, { from: sender });
    console.log(`Transaction submitted. DisputeModule job registry set to ${registryAddress}.`);
  });

task('dispute-module:update-registry', 'Reassigns the JobRegistry authorized to report disputes')
  .addOptionalParam('dispute', 'Address of the DisputeModule contract', undefined, types.string)
  .addParam('registry', 'Address of the new JobRegistry contract', undefined, types.string)
  .addOptionalParam('from', 'Sender address (defaults to the first unlocked account)', undefined, types.string)
  .addOptionalParam('planOut', 'Optional path to write a Safe-ready summary JSON', undefined, types.string)
  .addFlag('execute', 'Broadcast the transaction after confirmation')
  .setAction(async (args, hre) => {
    const disputeModule = await resolveDisputeModule(hre, args.dispute);
    const owner = await disputeModule.owner();
    const sender = await resolveSender(hre, args.from);
    ensureOwner(sender, owner, 'DisputeModule');

    const paused = await disputeModule.paused();
    if (!paused) {
      throw new Error('DisputeModule must be paused before updating the job registry. Run dispute-module:pause first.');
    }

    const currentRegistry = await disputeModule.jobRegistry();
    if (!currentRegistry || currentRegistry === '0x0000000000000000000000000000000000000000') {
      throw new Error('DisputeModule job registry has not been initialized. Use dispute-module:set-registry instead.');
    }

    const registryAddress = ensureAddress(hre.web3, args.registry, '--registry');
    if (currentRegistry.toLowerCase() === registryAddress.toLowerCase()) {
      throw new Error('The provided registry address matches the current configuration.');
    }

    const callData = disputeModule.contract.methods.updateJobRegistry(registryAddress).encodeABI();
    const plan = buildCallSummary({
      action: 'dispute-module:updateJobRegistry',
      method: 'updateJobRegistry(address)',
      args: [registryAddress],
      metadata: {
        previousRegistry: currentRegistry,
        newRegistry: registryAddress,
        paused: true,
      },
      contractAddress: disputeModule.address,
      sender,
      callData,
    });

    printPlanSummary(plan);
    const writtenPath = maybeWriteSummary(args.planOut, plan);
    if (writtenPath) {
      console.log(`Plan summary written to ${writtenPath}`);
    }

    if (!args.execute) {
      console.log('Dry run complete — re-run with --execute to broadcast the transaction.');
      return;
    }

    await disputeModule.updateJobRegistry(registryAddress, { from: sender });
    console.log(`Transaction submitted. DisputeModule job registry updated to ${registryAddress}.`);
  });

task('dispute-module:pause', 'Pauses dispute lifecycle event forwarding')
  .addOptionalParam('dispute', 'Address of the DisputeModule contract', undefined, types.string)
  .addOptionalParam('from', 'Sender address (defaults to the first unlocked account)', undefined, types.string)
  .addOptionalParam('planOut', 'Optional path to write a Safe-ready summary JSON', undefined, types.string)
  .addFlag('execute', 'Broadcast the transaction after confirmation')
  .setAction(async (args, hre) => {
    const disputeModule = await resolveDisputeModule(hre, args.dispute);
    const owner = await disputeModule.owner();
    const sender = await resolveSender(hre, args.from);
    ensureOwner(sender, owner, 'DisputeModule');

    const paused = await disputeModule.paused();
    if (paused) {
      console.log('DisputeModule is already paused. No transaction required.');
      return;
    }

    const callData = disputeModule.contract.methods.pause().encodeABI();
    const plan = buildCallSummary({
      action: 'dispute-module:pause',
      method: 'pause()',
      args: [],
      metadata: {
        previousPaused: paused,
        nextPaused: true,
      },
      contractAddress: disputeModule.address,
      sender,
      callData,
    });

    printPlanSummary(plan);
    const writtenPath = maybeWriteSummary(args.planOut, plan);
    if (writtenPath) {
      console.log(`Plan summary written to ${writtenPath}`);
    }

    if (!args.execute) {
      console.log('Dry run complete — re-run with --execute to broadcast the transaction.');
      return;
    }

    const receipt = await disputeModule.pause({ from: sender });
    console.log('Transaction submitted. DisputeModule paused.');
    if (receipt && (receipt.tx || receipt.transactionHash)) {
      console.log(`Tx hash: ${receipt.tx || receipt.transactionHash}`);
    }
  });

task('dispute-module:unpause', 'Resumes dispute lifecycle event forwarding')
  .addOptionalParam('dispute', 'Address of the DisputeModule contract', undefined, types.string)
  .addOptionalParam('from', 'Sender address (defaults to the first unlocked account)', undefined, types.string)
  .addOptionalParam('planOut', 'Optional path to write a Safe-ready summary JSON', undefined, types.string)
  .addFlag('execute', 'Broadcast the transaction after confirmation')
  .setAction(async (args, hre) => {
    const disputeModule = await resolveDisputeModule(hre, args.dispute);
    const owner = await disputeModule.owner();
    const sender = await resolveSender(hre, args.from);
    ensureOwner(sender, owner, 'DisputeModule');

    const paused = await disputeModule.paused();
    if (!paused) {
      console.log('DisputeModule is already unpaused. No transaction required.');
      return;
    }

    const callData = disputeModule.contract.methods.unpause().encodeABI();
    const plan = buildCallSummary({
      action: 'dispute-module:unpause',
      method: 'unpause()',
      args: [],
      metadata: {
        previousPaused: paused,
        nextPaused: false,
      },
      contractAddress: disputeModule.address,
      sender,
      callData,
    });

    printPlanSummary(plan);
    const writtenPath = maybeWriteSummary(args.planOut, plan);
    if (writtenPath) {
      console.log(`Plan summary written to ${writtenPath}`);
    }

    if (!args.execute) {
      console.log('Dry run complete — re-run with --execute to broadcast the transaction.');
      return;
    }

    const receipt = await disputeModule.unpause({ from: sender });
    console.log('Transaction submitted. DisputeModule unpaused.');
    if (receipt && (receipt.tx || receipt.transactionHash)) {
      console.log(`Tx hash: ${receipt.tx || receipt.transactionHash}`);
    }
  });

