'use strict';

const fs = require('fs');
const path = require('path');
const { task, types } = require('hardhat/config');

const {
  loadEnsConfig,
  buildSetPlan,
  formatStatusLines,
  formatPlanLines,
  collectCurrentConfig,
} = require('../scripts/lib/identity-registry-console');
const {
  resolveCheckAddresses,
  resolveModificationEntries,
  formatStatusLines: formatEmergencyStatusLines,
  formatPlanLines: formatEmergencyPlanLines,
  collectEmergencyStatus,
  buildEmergencyPlanEntries,
  enrichPlanEntriesWithCalldata,
  buildPlanSummary: buildEmergencyPlanSummary,
  writePlanSummary: writeEmergencyPlanSummary,
} = require('../scripts/lib/identity-registry-emergency');
const { resolveVariant } = require('../scripts/config-loader');
const { toChecksum, formatAddress } = require('../scripts/lib/job-registry-config-utils');
const { serializeForJson } = require('../scripts/lib/json-utils');

async function resolveIdentity(hre, explicitAddress) {
  const IdentityRegistry = hre.artifacts.require('IdentityRegistry');
  if (explicitAddress) {
    return IdentityRegistry.at(explicitAddress);
  }
  return IdentityRegistry.deployed();
}

async function resolveSender(hre, explicit) {
  if (explicit) {
    if (!hre.web3.utils.isAddress(explicit)) {
      throw new Error(`Invalid --from address: ${explicit}`);
    }
    return toChecksum(explicit);
  }

  const accounts = await hre.web3.eth.getAccounts();
  if (!accounts || accounts.length === 0) {
    throw new Error('No unlocked accounts are available. Specify --from explicitly.');
  }

  return toChecksum(accounts[0]);
}

function ensureOwner(sender, owner) {
  if (!owner) {
    throw new Error('IdentityRegistry owner is not configured on-chain.');
  }

  if (sender.toLowerCase() !== owner.toLowerCase()) {
    throw new Error(
      `Sender ${sender} is not the IdentityRegistry owner (${owner}). ` +
        'Provide --from with the owner account or forward the generated plan through the owner multisig.',
    );
  }
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

function buildPlanSummary({
  identityAddress,
  owner,
  sender,
  plan,
  callData,
  configProfile,
}) {
  return {
    identityRegistry: identityAddress,
    owner,
    sender,
    config: {
      path: configProfile.path,
      variant: configProfile.variant,
    },
    desired: serializeForJson(plan.desired),
    diff: serializeForJson(plan.diff),
    arguments: serializeForJson(plan.args),
    call: {
      to: identityAddress,
      data: callData,
      value: '0',
      from: sender || null,
    },
  };
}

function resolveVariantWithWarning(candidate) {
  if (!candidate) {
    return null;
  }

  try {
    return resolveVariant(candidate);
  } catch (error) {
    console.warn(`Warning: unable to resolve variant for "${candidate}": ${error.message}`);
    return null;
  }
}

task('identity-registry:status', 'Inspect IdentityRegistry ENS configuration and optional drift against config files')
  .addOptionalParam('identity', 'IdentityRegistry contract address', undefined, types.string)
  .addOptionalParam('config', 'Explicit ENS config file path', undefined, types.string)
  .addOptionalParam('variant', 'Config variant hint (mainnet, sepolia, dev)', undefined, types.string)
  .addOptionalParam(
    'overrides',
    'JSON object of overrides (for example {"alphaEnabled":true,"agentRoot":"agents.agi.eth"})',
    undefined,
    types.json,
  )
  .setAction(async (args, hre) => {
    const identity = await resolveIdentity(hre, args.identity);
    const identityAddress = toChecksum(identity.address);
    const owner = toChecksum(await identity.owner());
    const current = await collectCurrentConfig(identity);

    const networkName = hre.network && hre.network.name ? hre.network.name : '(unspecified)';
    const variantHint = args.variant || networkName || undefined;
    const resolvedVariant = resolveVariantWithWarning(variantHint);
    const variantForConfig = args.config ? null : resolvedVariant || args.variant || networkName || undefined;

    console.log('AGIJobsv1 — IdentityRegistry Hardhat console');
    console.log('Action: status');
    console.log(`Network: ${networkName}${resolvedVariant ? ` (variant: ${resolvedVariant})` : ''}`);
    console.log(`IdentityRegistry: ${identityAddress}`);
    console.log(`Owner: ${owner || '(unknown)'}`);
    console.log('');

    formatStatusLines(current).forEach((line) => console.log(line));
    console.log('');

    const overrides = args.overrides || {};

    try {
      const configProfile = loadEnsConfig({
        explicitPath: args.config,
        variant: args.config ? undefined : variantForConfig,
      });
      console.log(`Config file: ${configProfile.path}`);
      const plan = buildSetPlan({ current, baseConfig: configProfile.values, overrides });
      if (plan.changed) {
        console.log('');
        formatPlanLines(plan).forEach((line) => console.log(line));
      } else {
        console.log('\nOn-chain configuration already matches the desired profile.');
      }
    } catch (error) {
      const message = error && error.message ? error.message : String(error);
      console.warn(`Warning: unable to evaluate configuration drift: ${message}`);
    }
  });

task('identity-registry:set-config', 'Align IdentityRegistry ENS configuration with repository defaults and optional overrides')
  .addOptionalParam('identity', 'IdentityRegistry contract address', undefined, types.string)
  .addOptionalParam('from', 'Sender address (defaults to first unlocked account)', undefined, types.string)
  .addOptionalParam('config', 'Explicit ENS config file path', undefined, types.string)
  .addOptionalParam('variant', 'Config variant hint (mainnet, sepolia, dev)', undefined, types.string)
  .addOptionalParam(
    'overrides',
    'JSON object of overrides (for example {"alphaEnabled":true,"agentRoot":"agents.agi.eth"})',
    undefined,
    types.json,
  )
  .addOptionalParam('planOut', 'Path to write a Safe-ready transaction summary JSON', undefined, types.string)
  .addFlag('execute', 'Broadcast the configureEns transaction')
  .setAction(async (args, hre) => {
    const identity = await resolveIdentity(hre, args.identity);
    const identityAddress = toChecksum(identity.address);
    const owner = toChecksum(await identity.owner());
    const sender = await resolveSender(hre, args.from);
    const current = await collectCurrentConfig(identity);

    const networkName = hre.network && hre.network.name ? hre.network.name : '(unspecified)';
    const variantHint = args.variant || networkName || undefined;
    const resolvedVariant = resolveVariantWithWarning(variantHint);
    const variantForConfig = args.config ? null : resolvedVariant || args.variant || networkName || undefined;

    console.log('AGIJobsv1 — IdentityRegistry Hardhat console');
    console.log('Action: set-config');
    console.log(`Network: ${networkName}${resolvedVariant ? ` (variant: ${resolvedVariant})` : ''}`);
    console.log(`IdentityRegistry: ${identityAddress}`);
    console.log(`Owner: ${owner || '(unknown)'}`);
    console.log(`Sender: ${sender}`);
    console.log('');

    formatStatusLines(current).forEach((line) => console.log(line));
    console.log('');

    const overrides = args.overrides || {};

    let configProfile;
    try {
      configProfile = loadEnsConfig({
        explicitPath: args.config,
        variant: args.config ? undefined : variantForConfig,
      });
    } catch (error) {
      const message = error && error.message ? error.message : String(error);
      throw new Error(`Unable to load ENS configuration: ${message}`);
    }

    console.log(`Config file: ${configProfile.path}`);

    const plan = buildSetPlan({ current, baseConfig: configProfile.values, overrides });

    console.log('');
    formatPlanLines(plan).forEach((line) => console.log(line));

    if (!plan.changed) {
      console.log('\nOn-chain configuration already matches the desired profile.');
      return;
    }

    const callData = identity.contract.methods.configureEns(...plan.args).encodeABI();
    const summary = buildPlanSummary({
      identityAddress,
      owner,
      sender,
      plan,
      callData,
      configProfile,
    });

    if (args.planOut) {
      const written = maybeWriteSummary(summary, args.planOut);
      console.log(`\nPlan summary written to ${written}`);
    }

    if (!args.execute) {
      console.log('\nDry run: transaction not broadcast.');
      console.log(JSON.stringify(summary, null, 2));
      return;
    }

    ensureOwner(sender, owner);

    const receipt = await identity.configureEns(...plan.args, { from: sender });
    console.log(`\nTransaction broadcast. Hash: ${receipt.tx}`);
  });

task('identity-registry:emergency-status', 'Inspect IdentityRegistry emergency allow list entries')
  .addOptionalParam('identity', 'IdentityRegistry contract address', undefined, types.string)
  .addOptionalParam('address', 'Single address to inspect', undefined, types.string)
  .addOptionalParam('addresses', 'JSON array of addresses to inspect', undefined, types.json)
  .addOptionalParam('file', 'Path to JSON or newline-separated file of addresses', undefined, types.string)
  .setAction(async (args, hre) => {
    const identity = await resolveIdentity(hre, args.identity);
    const identityAddress = toChecksum(identity.address);
    const owner = toChecksum(await identity.owner());

    const inline = [];
    if (args.address) {
      inline.push(args.address);
    }
    if (args.addresses) {
      inline.push(args.addresses);
    }

    const addresses = resolveCheckAddresses({ inline, filePath: args.file });
    const statusEntries = await collectEmergencyStatus(identity, addresses);
    const networkName = hre.network && hre.network.name ? hre.network.name : '(unspecified)';

    console.log('AGIJobsv1 — IdentityRegistry Hardhat emergency console');
    console.log('Action: emergency-status');
    console.log(`Network: ${networkName}`);
    console.log(`IdentityRegistry: ${identityAddress}`);
    console.log(`Owner: ${owner || '(unknown)'}`);
    console.log('');

    formatEmergencyStatusLines(statusEntries).forEach((line) => console.log(line));
  });

task('identity-registry:set-emergency', 'Grant or revoke emergency access through the IdentityRegistry owner controls')
  .addOptionalParam('identity', 'IdentityRegistry contract address', undefined, types.string)
  .addOptionalParam('from', 'Sender address (defaults to first unlocked account)', undefined, types.string)
  .addOptionalParam('allow', 'Comma-separated addresses to allow', undefined, types.string)
  .addOptionalParam('allowAddresses', 'JSON array of addresses to allow', undefined, types.json)
  .addOptionalParam('revoke', 'Comma-separated addresses to revoke', undefined, types.string)
  .addOptionalParam('revokeAddresses', 'JSON array of addresses to revoke', undefined, types.json)
  .addOptionalParam('batch', 'JSON array of {address,allowed} entries', undefined, types.json)
  .addOptionalParam('batchFile', 'Path to JSON or newline-separated file of entries', undefined, types.string)
  .addOptionalParam('planOut', 'Path to write a Safe-ready transaction summary JSON', undefined, types.string)
  .addFlag('execute', 'Broadcast the emergency access updates')
  .setAction(async (args, hre) => {
    const identity = await resolveIdentity(hre, args.identity);
    const identityAddress = toChecksum(identity.address);
    const owner = toChecksum(await identity.owner());
    const sender = await resolveSender(hre, args.from);

    const allowList = [];
    if (args.allow) {
      allowList.push(args.allow);
    }
    if (args.allowAddresses) {
      allowList.push(args.allowAddresses);
    }

    const revokeList = [];
    if (args.revoke) {
      revokeList.push(args.revoke);
    }
    if (args.revokeAddresses) {
      revokeList.push(args.revokeAddresses);
    }

    const batchEntries = [];
    if (args.batch) {
      if (Array.isArray(args.batch)) {
        batchEntries.push(...args.batch);
      } else {
        batchEntries.push(args.batch);
      }
    }

    const modifications = resolveModificationEntries({
      allowList,
      revokeList,
      batch: batchEntries,
      filePath: args.batchFile,
    });
    const networkName = hre.network && hre.network.name ? hre.network.name : '(unspecified)';

    console.log('AGIJobsv1 — IdentityRegistry Hardhat emergency console');
    console.log('Action: set-emergency');
    console.log(`Network: ${networkName}`);
    console.log(`IdentityRegistry: ${identityAddress}`);
    console.log(`Owner: ${owner || '(unknown)'}`);
    console.log(`Sender: ${sender}`);
    console.log('');

    if (modifications.length === 0) {
      console.log('No emergency access changes detected.');
      return;
    }

    const planEntries = buildEmergencyPlanEntries(modifications);
    const enrichedEntries = enrichPlanEntriesWithCalldata(identity, planEntries);

    formatEmergencyPlanLines(planEntries).forEach((line) => console.log(line));

    const summary = buildEmergencyPlanSummary({
      identityAddress,
      owner,
      sender,
      planEntries: enrichedEntries,
    });

    if (args.planOut) {
      const written = writeEmergencyPlanSummary(summary, args.planOut);
      console.log(`\nPlan summary written to ${written}`);
    }

    if (!args.execute) {
      console.log('\nDry run: transaction not broadcast.');
      console.log(JSON.stringify(summary, null, 2));
      return;
    }

    ensureOwner(sender, owner);

    for (let i = 0; i < enrichedEntries.length; i += 1) {
      const step = enrichedEntries[i];
      // eslint-disable-next-line no-await-in-loop
      const receipt = await identity[step.method](...step.args, { from: sender });
      console.log(`Broadcast ${step.method}(${formatAddress(step.address, hre.web3)}, ${step.allowed}) — tx: ${receipt.tx}`);
    }
  });
