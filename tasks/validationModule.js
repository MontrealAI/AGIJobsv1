'use strict';

const fs = require('fs');
const path = require('path');

const { task, types } = require('hardhat/config');

const {
  buildCallSummary,
  ensureOwner,
  formatAddress,
  maybeWriteSummary,
  printPlanSummary,
  resolveSender,
  toChecksum,
} = require('../scripts/lib/owner-task-utils');

function describeNetwork(hre) {
  return (hre.network && hre.network.name) || 'unknown';
}

async function resolveValidationModule(hre, explicitAddress) {
  const ValidationModule = hre.artifacts.require('ValidationModule');
  if (explicitAddress) {
    return ValidationModule.at(explicitAddress);
  }
  return ValidationModule.deployed();
}

function normalizeRule(web3, rawInput) {
  const value = String(rawInput || '').trim();
  if (!value) {
    throw new Error('Validation rule identifier is required.');
  }

  if (/^0x[0-9a-fA-F]{64}$/.test(value)) {
    return { hash: value, description: null, source: rawInput };
  }

  const hash = web3.utils.keccak256(value);
  return {
    hash,
    description: `keccak256('${value}')`,
    source: rawInput,
  };
}

function parseRuleEntries(rawContent, contextLabel) {
  if (!rawContent) {
    return [];
  }

  const trimmed = rawContent.trim();
  if (!trimmed) {
    return [];
  }

  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      return parsed.map((entry) => String(entry).trim()).filter(Boolean);
    }
    return [String(parsed).trim()].filter(Boolean);
  } catch (error) {
    const segments = trimmed
      .split(/[\r\n,]+/)
      .map((segment) => segment.trim())
      .filter(Boolean);

    if (segments.length === 0) {
      throw new Error(
        contextLabel
          ? `No rule identifiers found in ${contextLabel}. Provide a JSON array or comma/newline-separated values.`
          : 'No rule identifiers found. Provide a JSON array or comma/newline-separated values.',
      );
    }

    return segments;
  }
}

function resolveRuleInputs(raw, baseDir = process.cwd()) {
  if (!raw) {
    return [];
  }

  const trimmed = String(raw).trim();
  if (!trimmed) {
    return [];
  }

  if (trimmed.startsWith('@')) {
    const filePath = path.resolve(baseDir, trimmed.slice(1));
    if (!fs.existsSync(filePath)) {
      throw new Error(`Rules file not found at ${filePath}`);
    }
    const contents = fs.readFileSync(filePath, 'utf8');
    return parseRuleEntries(contents, filePath);
  }

  return parseRuleEntries(trimmed, null);
}

function buildStatusSummary({ hre, validationModule, owner, ruleSummaries }) {
  return {
    network: describeNetwork(hre),
    validationModule: toChecksum(hre.web3, validationModule.address),
    owner: toChecksum(hre.web3, owner),
    rules: ruleSummaries,
  };
}

function printStatus(summary, hre) {
  console.log(`ValidationModule status on ${summary.network}:`);
  console.log(`- Address: ${formatAddress(hre.web3, summary.validationModule)}`);
  console.log(`- Owner: ${formatAddress(hre.web3, summary.owner)}`);
  if (!summary.rules || summary.rules.length === 0) {
    console.log('- Rules: (provide --rules to inspect specific identifiers)');
    return;
  }

  console.log('- Rules:');
  summary.rules.forEach((rule) => {
    const label = rule.description ? `${rule.hash} (${rule.description})` : rule.hash;
    console.log(`  • ${label} — ${rule.enabled ? 'enabled' : 'disabled'}`);
  });
}

task('validation-module:status', 'Inspect ValidationModule ownership and optional rule states')
  .addOptionalParam('validation', 'Address of the ValidationModule contract', undefined, types.string)
  .addOptionalParam(
    'rules',
    'Comma-separated list, JSON array, or @path file reference of rule identifiers to inspect',
    undefined,
    types.string,
  )
  .addFlag('json', 'Emit the summary as JSON for automation pipelines')
  .setAction(async (args, hre) => {
    const validationModule = await resolveValidationModule(hre, args.validation);
    const owner = await validationModule.owner();

    const ruleInputs = resolveRuleInputs(args.rules);
    const ruleSummaries = [];
    for (const ruleInput of ruleInputs) {
      const rule = normalizeRule(hre.web3, ruleInput);
      const enabled = await validationModule.validationRules(rule.hash);
      ruleSummaries.push({
        input: String(ruleInput),
        hash: rule.hash,
        description: rule.description,
        enabled: Boolean(enabled),
      });
    }

    const summary = buildStatusSummary({ hre, validationModule, owner, ruleSummaries });

    if (args.json) {
      console.log(JSON.stringify(summary, null, 2));
      return;
    }

    printStatus(summary, hre);
  });

task('validation-module:set-rule', 'Enables or disables a validation rule with Safe-ready planning support')
  .addOptionalParam('validation', 'Address of the ValidationModule contract', undefined, types.string)
  .addParam('rule', 'Rule identifier (bytes32 hash or human-readable string)', undefined, types.string)
  .addParam('enabled', 'Whether the rule should be enabled', undefined, types.boolean)
  .addOptionalParam('from', 'Sender address (defaults to the first unlocked account)', undefined, types.string)
  .addOptionalParam('planOut', 'Optional path to write a Safe-ready summary JSON', undefined, types.string)
  .addFlag('execute', 'Broadcast the transaction after confirmation')
  .addFlag('force', 'Allow broadcasting even if the desired state matches the current rule value')
  .setAction(async (args, hre) => {
    const validationModule = await resolveValidationModule(hre, args.validation);
    const owner = await validationModule.owner();
    const sender = await resolveSender(hre, args.from);
    ensureOwner(sender, owner, 'ValidationModule');

    const rule = normalizeRule(hre.web3, args.rule);
    const desiredEnabled = Boolean(args.enabled);
    const current = await validationModule.validationRules(rule.hash);
    const currentEnabled = Boolean(current);

    if (!args.force && currentEnabled === desiredEnabled) {
      console.log(
        `Validation rule ${rule.hash} already matches the desired state (${desiredEnabled ? 'enabled' : 'disabled'}). ` +
          'No transaction required. Re-run with --force to generate a plan anyway.',
      );
      return;
    }

    const callData = validationModule.contract.methods
      .setValidationRule(rule.hash, desiredEnabled)
      .encodeABI();
    const plan = buildCallSummary({
      action: 'validation-module:setValidationRule',
      method: 'setValidationRule(bytes32,bool)',
      args: [rule.hash, desiredEnabled],
      metadata: {
        ruleInput: String(args.rule),
        description: rule.description,
        previousEnabled: currentEnabled,
        nextEnabled: desiredEnabled,
      },
      contractAddress: validationModule.address,
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

    const receipt = await validationModule.setValidationRule(rule.hash, desiredEnabled, { from: sender });
    console.log(
      `Transaction submitted. Validation rule ${rule.hash} now ${desiredEnabled ? 'enabled' : 'disabled'}.`,
    );
    if (receipt && (receipt.tx || receipt.transactionHash)) {
      console.log(`Tx hash: ${receipt.tx || receipt.transactionHash}`);
    }
  });

