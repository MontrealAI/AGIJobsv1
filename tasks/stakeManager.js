'use strict';

const { task, types } = require('hardhat/config');

const {
  buildCallSummary,
  ensureAddress,
  ensureOwner,
  ensureUint256,
  fetchErc20Metadata,
  formatAddress,
  formatTokenAmount,
  formatTokenMetadata,
  maybeWriteSummary,
  printPlanSummary,
  readTokenBalance,
  resolveSender,
} = require('../scripts/lib/owner-task-utils');

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

async function resolveStakeManager(hre, explicitAddress) {
  const StakeManager = hre.artifacts.require('StakeManager');
  if (explicitAddress) {
    return StakeManager.at(explicitAddress);
  }
  return StakeManager.deployed();
}

function describeNetwork(hre) {
  const { name } = hre.network;
  return name || 'unknown';
}

function normalizeNumber(value) {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value.toNumber === 'function') {
    return value.toNumber();
  }
  const stringified = value.toString();
  if (/^\d+$/.test(stringified)) {
    return Number(stringified);
  }
  return stringified;
}

function buildStatusSummary({
  hre,
  stakeManager,
  owner,
  jobRegistry,
  feeRecipient,
  paused,
  stakeToken,
  stakeTokenDecimals,
  tokenMetadata,
  tokenBalance,
}) {
  const summary = {
    network: describeNetwork(hre),
    stakeManager: stakeManager.address,
    owner,
    jobRegistry,
    feeRecipient,
    paused,
    stakeToken,
    stakeTokenDecimals,
  };

  if (tokenMetadata) {
    summary.stakeTokenMetadata = tokenMetadata;
  }

  if (tokenBalance !== null && tokenBalance !== undefined) {
    summary.contractBalance = tokenBalance;
    if (tokenMetadata && tokenMetadata.decimals !== null && tokenMetadata.decimals !== undefined) {
      summary.contractBalanceFormatted = formatTokenAmount(tokenBalance, tokenMetadata.decimals);
    }
  }

  return summary;
}

function printStatus(summary, hre) {
  console.log(`StakeManager status on ${summary.network}:`);
  console.log(`- Address: ${formatAddress(hre.web3, summary.stakeManager)}`);
  console.log(`- Owner: ${formatAddress(hre.web3, summary.owner)}`);
  console.log(`- Job registry: ${formatAddress(hre.web3, summary.jobRegistry)}`);
  console.log(`- Fee recipient: ${formatAddress(hre.web3, summary.feeRecipient)}`);
  console.log(`- Paused: ${Boolean(summary.paused)}`);
  console.log(`- Stake token: ${formatAddress(hre.web3, summary.stakeToken)}`);
  if (summary.stakeTokenMetadata) {
    console.log(`  Token metadata: ${formatTokenMetadata(summary.stakeTokenMetadata)}`);
  } else {
    console.log('  Token metadata: unavailable');
  }
  console.log(`- Stake token decimals (cached): ${summary.stakeTokenDecimals}`);
  if (summary.contractBalance !== undefined) {
    const formatted = summary.contractBalanceFormatted || summary.contractBalance;
    console.log(`- Current contract balance: ${formatted}`);
  }
}

task('stake-manager:status', 'Prints the StakeManager configuration snapshot.')
  .addOptionalParam('stakeManager', 'Address of the StakeManager contract', undefined, types.string)
  .addFlag('json', 'Emit the summary as JSON for automation pipelines.')
  .setAction(async (args, hre) => {
    const stakeManager = await resolveStakeManager(hre, args.stakeManager);
    const [owner, jobRegistry, feeRecipient, paused, stakeToken, stakeTokenDecimalsRaw] =
      await Promise.all([
        stakeManager.owner(),
        stakeManager.jobRegistry(),
        stakeManager.feeRecipient(),
        stakeManager.paused(),
        stakeManager.stakeToken(),
        stakeManager.stakeTokenDecimals(),
      ]);

    const stakeTokenDecimals = normalizeNumber(stakeTokenDecimalsRaw);
    const tokenMetadata = await fetchErc20Metadata(hre.web3, stakeToken);
    const tokenBalance = await readTokenBalance(hre.web3, stakeToken, stakeManager.address);

    const summary = buildStatusSummary({
      hre,
      stakeManager,
      owner,
      jobRegistry,
      feeRecipient,
      paused,
      stakeToken,
      stakeTokenDecimals,
      tokenMetadata,
      tokenBalance,
    });

    if (args.json) {
      console.log(JSON.stringify(summary, null, 2));
      return;
    }

    printStatus(summary, hre);
  });

task('stake-manager:set-registry', 'Initializes the JobRegistry authorized to manage stake locks.')
  .addOptionalParam('stakeManager', 'Address of the StakeManager contract', undefined, types.string)
  .addParam('registry', 'Address of the JobRegistry contract', undefined, types.string)
  .addOptionalParam(
    'from',
    'Sender address. Defaults to the first unlocked account.',
    undefined,
    types.string
  )
  .addOptionalParam(
    'planOut',
    'Optional path to persist the call summary JSON.',
    undefined,
    types.string
  )
  .addFlag('execute', 'Broadcast the transaction instead of performing a dry run.')
  .setAction(async (args, hre) => {
    const stakeManager = await resolveStakeManager(hre, args.stakeManager);
    const owner = await stakeManager.owner();
    const sender = await resolveSender(hre, args.from);
    ensureOwner(sender, owner, 'StakeManager');

    const registryAddress = ensureAddress(hre.web3, args.registry, '--registry');
    const currentRegistry = await stakeManager.jobRegistry();
    if (currentRegistry && currentRegistry !== ZERO_ADDRESS) {
      throw new Error(
        `StakeManager already has a job registry configured (${currentRegistry}). Use stake-manager:update-registry instead.`
      );
    }

    const callData = stakeManager.contract.methods.setJobRegistry(registryAddress).encodeABI();
    const plan = buildCallSummary({
      action: 'stake-manager:setJobRegistry',
      method: 'setJobRegistry(address)',
      args: [registryAddress],
      metadata: {
        previousRegistry: currentRegistry,
        newRegistry: registryAddress,
      },
      contractAddress: stakeManager.address,
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

    await stakeManager.setJobRegistry(registryAddress, { from: sender });
    console.log(`Transaction submitted. StakeManager job registry set to ${registryAddress}.`);
  });

task('stake-manager:update-registry', 'Reassigns the JobRegistry authorized to manage stake locks.')
  .addOptionalParam('stakeManager', 'Address of the StakeManager contract', undefined, types.string)
  .addParam('registry', 'Address of the replacement JobRegistry contract', undefined, types.string)
  .addOptionalParam(
    'from',
    'Sender address. Defaults to the first unlocked account.',
    undefined,
    types.string
  )
  .addOptionalParam(
    'planOut',
    'Optional path to persist the call summary JSON.',
    undefined,
    types.string
  )
  .addFlag('execute', 'Broadcast the transaction instead of performing a dry run.')
  .setAction(async (args, hre) => {
    const stakeManager = await resolveStakeManager(hre, args.stakeManager);
    const owner = await stakeManager.owner();
    const sender = await resolveSender(hre, args.from);
    ensureOwner(sender, owner, 'StakeManager');

    const registryAddress = ensureAddress(hre.web3, args.registry, '--registry');
    const currentRegistry = await stakeManager.jobRegistry();
    if (!currentRegistry || currentRegistry === ZERO_ADDRESS) {
      throw new Error(
        'StakeManager job registry is not configured yet. Use stake-manager:set-registry first.'
      );
    }
    if (currentRegistry.toLowerCase() === registryAddress.toLowerCase()) {
      throw new Error('StakeManager job registry already matches the provided address.');
    }

    const paused = await stakeManager.paused();
    if (!paused) {
      throw new Error(
        'StakeManager must be paused before calling updateJobRegistry. Invoke stake-manager:pause first.'
      );
    }

    const callData = stakeManager.contract.methods.updateJobRegistry(registryAddress).encodeABI();
    const plan = buildCallSummary({
      action: 'stake-manager:updateJobRegistry',
      method: 'updateJobRegistry(address)',
      args: [registryAddress],
      metadata: {
        previousRegistry: currentRegistry,
        newRegistry: registryAddress,
      },
      contractAddress: stakeManager.address,
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

    await stakeManager.updateJobRegistry(registryAddress, { from: sender });
    console.log(`Transaction submitted. StakeManager job registry updated to ${registryAddress}.`);
  });

task(
  'stake-manager:set-fee-recipient',
  'Sets the destination that receives slashed stake proceeds.'
)
  .addOptionalParam('stakeManager', 'Address of the StakeManager contract', undefined, types.string)
  .addParam('recipient', 'Address of the fee recipient', undefined, types.string)
  .addOptionalParam(
    'from',
    'Sender address. Defaults to the first unlocked account.',
    undefined,
    types.string
  )
  .addOptionalParam(
    'planOut',
    'Optional path to persist the call summary JSON.',
    undefined,
    types.string
  )
  .addFlag('execute', 'Broadcast the transaction instead of performing a dry run.')
  .setAction(async (args, hre) => {
    const stakeManager = await resolveStakeManager(hre, args.stakeManager);
    const owner = await stakeManager.owner();
    const sender = await resolveSender(hre, args.from);
    ensureOwner(sender, owner, 'StakeManager');

    const recipientAddress = ensureAddress(hre.web3, args.recipient, '--recipient');
    const currentRecipient = await stakeManager.feeRecipient();
    if (currentRecipient && currentRecipient.toLowerCase() === recipientAddress.toLowerCase()) {
      throw new Error('StakeManager fee recipient already matches the provided address.');
    }

    const callData = stakeManager.contract.methods.setFeeRecipient(recipientAddress).encodeABI();
    const plan = buildCallSummary({
      action: 'stake-manager:setFeeRecipient',
      method: 'setFeeRecipient(address)',
      args: [recipientAddress],
      metadata: {
        previousRecipient: currentRecipient,
        newRecipient: recipientAddress,
      },
      contractAddress: stakeManager.address,
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

    await stakeManager.setFeeRecipient(recipientAddress, { from: sender });
    console.log(
      `Transaction submitted. StakeManager fee recipient updated to ${recipientAddress}.`
    );
  });

task('stake-manager:pause', 'Pauses StakeManager deposits and withdrawals.')
  .addOptionalParam('stakeManager', 'Address of the StakeManager contract', undefined, types.string)
  .addOptionalParam(
    'from',
    'Sender address. Defaults to the first unlocked account.',
    undefined,
    types.string
  )
  .addOptionalParam(
    'planOut',
    'Optional path to persist the call summary JSON.',
    undefined,
    types.string
  )
  .addFlag('execute', 'Broadcast the transaction instead of performing a dry run.')
  .setAction(async (args, hre) => {
    const stakeManager = await resolveStakeManager(hre, args.stakeManager);
    const owner = await stakeManager.owner();
    const sender = await resolveSender(hre, args.from);
    ensureOwner(sender, owner, 'StakeManager');

    const paused = await stakeManager.paused();
    if (paused) {
      throw new Error('StakeManager is already paused.');
    }

    const callData = stakeManager.contract.methods.pause().encodeABI();
    const plan = buildCallSummary({
      action: 'stake-manager:pause',
      method: 'pause()',
      args: [],
      metadata: {},
      contractAddress: stakeManager.address,
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

    await stakeManager.pause({ from: sender });
    console.log('Transaction submitted. StakeManager paused.');
  });

task('stake-manager:unpause', 'Resumes StakeManager deposits and withdrawals.')
  .addOptionalParam('stakeManager', 'Address of the StakeManager contract', undefined, types.string)
  .addOptionalParam(
    'from',
    'Sender address. Defaults to the first unlocked account.',
    undefined,
    types.string
  )
  .addOptionalParam(
    'planOut',
    'Optional path to persist the call summary JSON.',
    undefined,
    types.string
  )
  .addFlag('execute', 'Broadcast the transaction instead of performing a dry run.')
  .setAction(async (args, hre) => {
    const stakeManager = await resolveStakeManager(hre, args.stakeManager);
    const owner = await stakeManager.owner();
    const sender = await resolveSender(hre, args.from);
    ensureOwner(sender, owner, 'StakeManager');

    const paused = await stakeManager.paused();
    if (!paused) {
      throw new Error('StakeManager is not paused.');
    }

    const callData = stakeManager.contract.methods.unpause().encodeABI();
    const plan = buildCallSummary({
      action: 'stake-manager:unpause',
      method: 'unpause()',
      args: [],
      metadata: {},
      contractAddress: stakeManager.address,
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

    await stakeManager.unpause({ from: sender });
    console.log('Transaction submitted. StakeManager unpaused.');
  });

task(
  'stake-manager:emergency-release',
  'Invokes the owner emergency release to unlock staked funds without registry interaction.'
)
  .addOptionalParam('stakeManager', 'Address of the StakeManager contract', undefined, types.string)
  .addParam('account', 'Address whose locked stake will be released', undefined, types.string)
  .addParam('amount', 'Amount of stake to release (raw token units)', undefined, types.string)
  .addOptionalParam(
    'from',
    'Sender address. Defaults to the first unlocked account.',
    undefined,
    types.string
  )
  .addOptionalParam(
    'planOut',
    'Optional path to persist the call summary JSON.',
    undefined,
    types.string
  )
  .addFlag('execute', 'Broadcast the transaction instead of performing a dry run.')
  .setAction(async (args, hre) => {
    const stakeManager = await resolveStakeManager(hre, args.stakeManager);
    const owner = await stakeManager.owner();
    const sender = await resolveSender(hre, args.from);
    ensureOwner(sender, owner, 'StakeManager');

    const accountAddress = ensureAddress(hre.web3, args.account, '--account');
    const amount = ensureUint256(args.amount, '--amount');

    const callData = stakeManager.contract.methods
      .emergencyRelease(accountAddress, amount)
      .encodeABI();
    const plan = buildCallSummary({
      action: 'stake-manager:emergencyRelease',
      method: 'emergencyRelease(address,uint256)',
      args: [accountAddress, amount],
      metadata: {
        account: accountAddress,
        amount,
      },
      contractAddress: stakeManager.address,
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

    await stakeManager.emergencyRelease(accountAddress, amount, { from: sender });
    console.log(`Transaction submitted. Emergency release initiated for ${accountAddress}.`);
  });
