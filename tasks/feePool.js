'use strict';

const { task, types } = require('hardhat/config');

const {
  buildCallSummary,
  ensureAddress,
  ensureOwner,
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

async function resolveFeePool(hre, explicitAddress) {
  const FeePool = hre.artifacts.require('FeePool');
  if (explicitAddress) {
    return FeePool.at(explicitAddress);
  }
  return FeePool.deployed();
}

function describeNetwork(hre) {
  const { name } = hre.network;
  return name || 'unknown';
}

function buildStatusSummary({
  hre,
  feePool,
  owner,
  jobRegistry,
  burnAddress,
  feeToken,
  totalFeesRecorded,
  tokenMetadata,
  tokenBalance,
}) {
  const summary = {
    network: describeNetwork(hre),
    feePool: feePool.address,
    owner,
    jobRegistry,
    burnAddress,
    feeToken,
    totalFeesRecorded,
  };

  if (tokenMetadata) {
    summary.feeTokenMetadata = tokenMetadata;
  }

  if (tokenBalance !== null && tokenBalance !== undefined) {
    summary.tokenBalance = tokenBalance;
    if (tokenMetadata && tokenMetadata.decimals !== null && tokenMetadata.decimals !== undefined) {
      summary.tokenBalanceFormatted = formatTokenAmount(tokenBalance, tokenMetadata.decimals);
    }
  }

  return summary;
}

function printStatus(summary, hre) {
  console.log(`FeePool status on ${summary.network}:`);
  console.log(`- Address: ${formatAddress(hre.web3, summary.feePool)}`);
  console.log(`- Owner: ${formatAddress(hre.web3, summary.owner)}`);
  console.log(`- Job registry: ${formatAddress(hre.web3, summary.jobRegistry)}`);
  console.log(`- Burn address: ${formatAddress(hre.web3, summary.burnAddress)}`);
  console.log(`- Fee token: ${formatAddress(hre.web3, summary.feeToken)}`);
  if (summary.feeTokenMetadata) {
    console.log(`  Token metadata: ${formatTokenMetadata(summary.feeTokenMetadata)}`);
  } else {
    console.log('  Token metadata: unavailable');
  }
  console.log(`- Total fees recorded: ${summary.totalFeesRecorded}`);
  if (summary.tokenBalance !== undefined) {
    const formatted = summary.tokenBalanceFormatted || summary.tokenBalance;
    console.log(`- Current token balance: ${formatted}`);
  }
}

task('fee-pool:status', 'Prints the FeePool configuration snapshot.')
  .addOptionalParam('feePool', 'Address of the FeePool contract', undefined, types.string)
  .addFlag('json', 'Emit the summary as JSON for automation pipelines.')
  .setAction(async (args, hre) => {
    const feePool = await resolveFeePool(hre, args.feePool);
    const [owner, jobRegistry, burnAddress, feeToken, totalFeesRecordedRaw] = await Promise.all([
      feePool.owner(),
      feePool.jobRegistry(),
      feePool.burnAddress(),
      feePool.feeToken(),
      feePool.totalFeesRecorded(),
    ]);

    const tokenMetadata = await fetchErc20Metadata(hre.web3, feeToken);
    const tokenBalance = await readTokenBalance(hre.web3, feeToken, feePool.address);
    const totalFeesRecorded = totalFeesRecordedRaw.toString();

    const summary = buildStatusSummary({
      hre,
      feePool,
      owner,
      jobRegistry,
      burnAddress,
      feeToken,
      totalFeesRecorded,
      tokenMetadata,
      tokenBalance,
    });

    if (args.json) {
      console.log(JSON.stringify(summary, null, 2));
      return;
    }

    printStatus(summary, hre);
  });

task('fee-pool:set-registry', 'Initializes the authorized JobRegistry for the FeePool.')
  .addOptionalParam('feePool', 'Address of the FeePool contract', undefined, types.string)
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
    const feePool = await resolveFeePool(hre, args.feePool);
    const owner = await feePool.owner();
    const sender = await resolveSender(hre, args.from);
    ensureOwner(sender, owner, 'FeePool');

    const registryAddress = ensureAddress(hre.web3, args.registry, '--registry');
    const currentRegistry = await feePool.jobRegistry();
    if (currentRegistry && currentRegistry !== ZERO_ADDRESS) {
      throw new Error(
        `FeePool already has a job registry configured (${currentRegistry}). Use fee-pool:update-registry instead.`
      );
    }

    const callData = feePool.contract.methods.setJobRegistry(registryAddress).encodeABI();
    const plan = buildCallSummary({
      action: 'fee-pool:setJobRegistry',
      method: 'setJobRegistry(address)',
      args: [registryAddress],
      metadata: {
        previousRegistry: currentRegistry,
        newRegistry: registryAddress,
      },
      contractAddress: feePool.address,
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

    await feePool.setJobRegistry(registryAddress, { from: sender });
    console.log(`Transaction submitted. FeePool job registry set to ${registryAddress}.`);
  });

task('fee-pool:update-registry', 'Reassigns the JobRegistry authorized to report fees.')
  .addOptionalParam('feePool', 'Address of the FeePool contract', undefined, types.string)
  .addParam('registry', 'Address of the new JobRegistry contract', undefined, types.string)
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
    const feePool = await resolveFeePool(hre, args.feePool);
    const owner = await feePool.owner();
    const sender = await resolveSender(hre, args.from);
    ensureOwner(sender, owner, 'FeePool');

    const registryAddress = ensureAddress(hre.web3, args.registry, '--registry');
    const currentRegistry = await feePool.jobRegistry();
    if (!currentRegistry || currentRegistry === ZERO_ADDRESS) {
      throw new Error(
        'FeePool job registry is not configured yet. Use fee-pool:set-registry first.'
      );
    }
    if (currentRegistry.toLowerCase() === registryAddress.toLowerCase()) {
      throw new Error('FeePool job registry already matches the provided address.');
    }

    const callData = feePool.contract.methods.updateJobRegistry(registryAddress).encodeABI();
    const plan = buildCallSummary({
      action: 'fee-pool:updateJobRegistry',
      method: 'updateJobRegistry(address)',
      args: [registryAddress],
      metadata: {
        previousRegistry: currentRegistry,
        newRegistry: registryAddress,
      },
      contractAddress: feePool.address,
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

    await feePool.updateJobRegistry(registryAddress, { from: sender });
    console.log(`Transaction submitted. FeePool job registry updated to ${registryAddress}.`);
  });

task('fee-pool:update-burn', 'Updates the burn destination for accumulated protocol fees.')
  .addOptionalParam('feePool', 'Address of the FeePool contract', undefined, types.string)
  .addParam('burn', 'Address of the new burn destination', undefined, types.string)
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
    const feePool = await resolveFeePool(hre, args.feePool);
    const owner = await feePool.owner();
    const sender = await resolveSender(hre, args.from);
    ensureOwner(sender, owner, 'FeePool');

    const newBurnAddress = ensureAddress(hre.web3, args.burn, '--burn');
    const currentBurnAddress = await feePool.burnAddress();
    if (currentBurnAddress.toLowerCase() === newBurnAddress.toLowerCase()) {
      throw new Error('FeePool burn address already matches the provided destination.');
    }

    const callData = feePool.contract.methods.updateBurnAddress(newBurnAddress).encodeABI();
    const plan = buildCallSummary({
      action: 'fee-pool:updateBurnAddress',
      method: 'updateBurnAddress(address)',
      args: [newBurnAddress],
      metadata: {
        previousBurnAddress: currentBurnAddress,
        newBurnAddress,
      },
      contractAddress: feePool.address,
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

    await feePool.updateBurnAddress(newBurnAddress, { from: sender });
    console.log(`Transaction submitted. FeePool burn address updated to ${newBurnAddress}.`);
  });

task('fee-pool:burn', 'Transfers the accumulated fee token balance to the configured burn address.')
  .addOptionalParam('feePool', 'Address of the FeePool contract', undefined, types.string)
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
    const feePool = await resolveFeePool(hre, args.feePool);
    const owner = await feePool.owner();
    const sender = await resolveSender(hre, args.from);
    ensureOwner(sender, owner, 'FeePool');

    const feeToken = await feePool.feeToken();
    const burnAddress = await feePool.burnAddress();
    const tokenMetadata = await fetchErc20Metadata(hre.web3, feeToken);
    const tokenBalance = await readTokenBalance(hre.web3, feeToken, feePool.address);

    if (tokenBalance === null) {
      console.log(
        'Warning: Unable to read the FeePool token balance. The transaction may revert if nothing is available.'
      );
    } else if (BigInt(tokenBalance) === 0n) {
      throw new Error('FeePool balance is zero. Burning would revert.');
    }

    const callData = feePool.contract.methods.burnAccumulatedFees().encodeABI();
    const plan = buildCallSummary({
      action: 'fee-pool:burnAccumulatedFees',
      method: 'burnAccumulatedFees()',
      args: [],
      metadata: {
        burnAddress,
        tokenBalance,
        tokenBalanceFormatted:
          tokenBalance !== null && tokenMetadata && tokenMetadata.decimals !== null
            ? formatTokenAmount(tokenBalance, tokenMetadata.decimals)
            : tokenBalance,
      },
      contractAddress: feePool.address,
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

    await feePool.burnAccumulatedFees({ from: sender });
    console.log('Transaction submitted. FeePool burn executed.');
  });
