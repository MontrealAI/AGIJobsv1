'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const JobRegistry = artifacts.require('JobRegistry');

const {
  parseOwnerConsoleArgs,
  parseBooleanFlag,
  collectOwnerStatus,
  buildOwnerTxPlan,
  formatStatusLines,
  formatTxPlanLines,
} = require('./lib/job-registry-owner');
const { serializeForJson } = require('./lib/json-utils');

const ACTION_CHOICES = [
  { key: 'status', description: 'Inspect configuration and optional job status (no transaction)' },
  { key: 'extend', description: 'Extend commit/reveal/dispute deadlines for an active job' },
  { key: 'finalize', description: 'Finalize a revealed job with a success/failure flag' },
  { key: 'timeout', description: 'Timeout a stalled job and optionally slash the worker stake' },
  {
    key: 'resolve',
    description: 'Resolve an active dispute with slash and reputation adjustments',
  },
];

function parseWizardArgs(argv) {
  const result = {
    interactive: null,
    planOut: null,
    yes: false,
    help: false,
  };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (typeof arg !== 'string') {
      continue;
    }

    if (!arg.startsWith('--')) {
      continue;
    }

    if (arg === '--help' || arg === '-h') {
      result.help = true;
      continue;
    }

    if (arg === '--interactive') {
      result.interactive = true;
      continue;
    }

    if (arg === '--no-interactive' || arg === '--non-interactive') {
      result.interactive = false;
      continue;
    }

    if (arg === '--yes' || arg === '--assume-yes' || arg === '--force') {
      result.yes = true;
      continue;
    }

    if (arg === '--plan-out') {
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        result.planOut = path.resolve(next);
        i += 1;
      } else {
        throw new Error('--plan-out requires a file path');
      }
      continue;
    }

    if (arg.startsWith('--plan-out=')) {
      const [, filePath] = arg.split(/=(.+)/);
      if (!filePath) {
        throw new Error('--plan-out requires a file path');
      }
      result.planOut = path.resolve(filePath);
      continue;
    }
  }

  return result;
}

function normalizeAction(raw) {
  if (!raw && raw !== 0) {
    return null;
  }

  const value = String(raw).trim().toLowerCase();
  if (!value) {
    return null;
  }

  const numericMatch = value.match(/^\d+$/);
  if (numericMatch) {
    const index = Number(value) - 1;
    if (index >= 0 && index < ACTION_CHOICES.length) {
      return ACTION_CHOICES[index].key;
    }
  }

  const choice = ACTION_CHOICES.find((option) => option.key === value);
  return choice ? choice.key : null;
}

function describeActions(defaultAction) {
  console.log('Available actions:');
  ACTION_CHOICES.forEach((choice, index) => {
    const marker = choice.key === defaultAction ? '*' : ' ';
    console.log(`  ${marker} ${index + 1}. ${choice.key} — ${choice.description}`);
  });
async function promptOrFallback({
  interactive,
  rl,
  question,
  defaultValue,
  required = false,
  validator = null,
  transform = null,
}) {
  if (!interactive) {
    const value = defaultValue;
    if ((value === undefined || value === null || value === '') && required) {
      throw new Error(`${question} is required in non-interactive mode`);
    }
    if (validator) {
      validator(value);
    }
    return transform ? transform(value) : value;
  }

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const suffix =
      defaultValue !== undefined && defaultValue !== null && defaultValue !== ''
        ? ` [${defaultValue}]`
        : '';
    const promptText = `${question}${suffix ? suffix : ''}: `;
    const answer = await new Promise((resolve) => {
      rl.question(promptText, (input) => {
        resolve(typeof input === 'string' ? input.trim() : '');
      });
    });

    const value = answer === '' ? defaultValue : answer;

    if ((value === undefined || value === null || value === '') && required) {
      console.log('A value is required.');
      continue;
    }

    try {
      if (validator) {
        validator(value);
      }
      return transform ? transform(value) : value;
    } catch (error) {
      console.log(`Error: ${error.message}`);
    }
  }
}

async function promptBoolean({ interactive, rl, question, defaultValue }) {
  const suffix = defaultValue === undefined ? ' (y/n)' : defaultValue ? ' (Y/n)' : ' (y/N)';
  const promptQuestion = `${question}${suffix}`;

  return promptOrFallback({
    interactive,
    rl,
    question: promptQuestion,
    defaultValue,
    required: defaultValue === undefined,
    transform: (value) =>
      parseBooleanFlag(value === '' ? defaultValue : value, defaultValue ?? false),
  });
}

function ensureIntegerString(value, { label, allowNegative = false, allowEmpty = false } = {}) {
  if (value === undefined || value === null || value === '') {
    if (allowEmpty) {
      return '';
    }
    throw new Error(`${label} is required`);
  }

  const normalized = String(value).trim();
  if (!normalized) {
    if (allowEmpty) {
      return '';
    }
    throw new Error(`${label} is required`);
  }

  if (!allowNegative) {
    if (!/^\d+$/.test(normalized)) {
      throw new Error(`${label} must be a non-negative integer`);
    }
  } else if (!/^-?\d+$/.test(normalized)) {
    throw new Error(`${label} must be an integer`);
  }

  return normalized;
}

async function selectAction({ interactive, rl, defaultAction, yes }) {
  if (!interactive) {
    const normalized = normalizeAction(defaultAction || 'status');
    if (!normalized) {
      throw new Error(
        'Non-interactive mode requires --action <status|extend|finalize|timeout|resolve>'
      );
    }
    return normalized;
  }

  const initial = normalizeAction(defaultAction || 'status') || 'status';
  describeActions(initial);

  if (yes) {
    console.log(`Auto-selecting default action: ${initial}`);
    return initial;
  }

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const answer = await new Promise((resolve) => {
      rl.question('Choose an action (number or name): ', (input) => {
        resolve(typeof input === 'string' ? input.trim() : '');
      });
    });

    if (!answer) {
      return initial;
    }

    const normalized = normalizeAction(answer);
    if (normalized) {
      return normalized;
    }

    console.log('Unrecognized action. Please choose from the listed options.');
  }
}

function printStatusSummary(status) {
  const lines = formatStatusLines(status);
  lines.forEach((line) => console.log(`  ${line}`));
}

function printJobSummary(jobSummary) {
  if (!jobSummary) {
    console.log('  No matching job found or the job has not been created yet.');
    return;
  }

  console.log('  Job summary:');
  console.log(`    id: ${jobSummary.id}`);
  console.log(`    state: ${jobSummary.state.name} (${jobSummary.state.value})`);
  console.log(`    client: ${jobSummary.client}`);
  console.log(`    worker: ${jobSummary.worker}`);
  console.log(`    stakeAmount: ${jobSummary.stakeAmount}`);
  console.log(`    commitDeadline: ${jobSummary.commitDeadline}`);
  console.log(`    revealDeadline: ${jobSummary.revealDeadline}`);
  console.log(`    disputeDeadline: ${jobSummary.disputeDeadline}`);
  console.log(`    commitHash: ${jobSummary.commitHash}`);
}

function writePlanToFile(planOut, artifact) {
  const directory = path.dirname(planOut);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(planOut, `${JSON.stringify(artifact, null, 2)}\n`);
  console.log(`Dry-run transaction plan written to ${planOut}`);
}

module.exports = async function (callback) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  const cleanup = (error) => {
    rl.close();
    callback(error);
  };

  try {
    const ownerOptions = parseOwnerConsoleArgs(process.argv);
    const wizardFlags = parseWizardArgs(process.argv);

    if (ownerOptions.help || wizardFlags.help) {
      console.log('AGI Jobs v1 — JobRegistry owner wizard');
      console.log(
        'Usage: npx truffle exec scripts/job-registry-owner-wizard.js --network <network> [options]'
      );
      console.log('');
      console.log('Common options:');
      console.log('  --action <name>              status | extend | finalize | timeout | resolve');
      console.log('  --job <id>                   Target job identifier for actions');
      console.log(
        '  --from <address>             Sender address (defaults to first unlocked account)'
      );
      console.log('  --execute                    Broadcast the transaction after confirmation');
      console.log('  --plan-out <file>            Save a Safe-ready JSON plan during dry runs');
      console.log(
        '  --no-interactive             Fail if required inputs are missing instead of prompting'
      );
      console.log(
        '  --yes                        Accept defaults for prompts (interactive mode only)'
      );
      console.log('');
      console.log('Extend options:');
      console.log('  --commit-extension <seconds>');
      console.log('  --reveal-extension <seconds>');
      console.log('  --dispute-extension <seconds>');
      console.log('');
      console.log('Finalize options:');
      console.log('  --success[=true|false]');
      console.log('');
      console.log('Timeout options:');
      console.log('  --slash-amount <value>');
      console.log('');
      console.log('Resolve options:');
      console.log('  --slash-worker[=true|false]');
      console.log('  --slash-amount <value>');
      console.log('  --reputation-delta <value>');
      cleanup();
      return;
    }

    const interactive = wizardFlags.interactive !== false;
    const registry = await JobRegistry.deployed();
    const ownerAddress = await registry.owner();
    const accounts = await web3.eth.getAccounts();
    const defaultSender = ownerOptions.from || accounts[0];

    if (!defaultSender) {
      throw new Error('No sender account is available. Specify --from or unlock an account.');
    }

    const { toChecksumAddress, isAddress } = web3.utils;
    const networkName = process.env.TRUFFLE_NETWORK || process.env.NETWORK || null;

    console.log('AGIJobsv1 — JobRegistry owner wizard');
    console.log(`Network: ${networkName || '(unspecified)'}`);
    console.log(`Registry: ${toChecksumAddress(registry.address)}`);
    console.log(`Owner: ${toChecksumAddress(ownerAddress)}`);

    const initialStatus = await collectOwnerStatus({
      registry,
      web3,
      owner: toChecksumAddress(ownerAddress),
      jobId: ownerOptions.jobId,
    });

    console.log('');
    console.log('Current registry snapshot:');
    printStatusSummary(initialStatus);

    const action = await selectAction({
      interactive,
      rl,
      defaultAction: ownerOptions.action,
      yes: wizardFlags.yes,
    });

    if (action === 'status') {
      let jobId = ownerOptions.jobId || '';
      if (interactive && !wizardFlags.yes) {
        jobId = await promptOrFallback({
          interactive,
          rl,
          question: 'Enter a job ID to inspect (leave blank to exit)',
          defaultValue: ownerOptions.jobId || '',
          validator: (value) => {
            if (value === undefined || value === null || value === '') {
              return;
            }
            ensureIntegerString(value, { label: 'jobId' });
          },
        });
      }

      if (jobId) {
        const status = await collectOwnerStatus({
          registry,
          web3,
          owner: toChecksumAddress(ownerAddress),
          jobId,
        });
        printJobSummary(status.job);
      } else {
        console.log('No job ID supplied. Exiting without further action.');
      }

      cleanup();
      return;
    }

    const senderAddress = await promptOrFallback({
      interactive,
      rl,
      question: 'Sender address',
      defaultValue: ownerOptions.from || toChecksumAddress(defaultSender),
      required: true,
      validator: (value) => {
        const candidate = typeof value === 'string' ? value.trim() : value;
        if (!candidate || !isAddress(candidate)) {
          throw new Error('Enter a valid Ethereum address');
        }
      },
      transform: (value) => toChecksumAddress(value),
    });

    const jobId = await promptOrFallback({
      interactive,
      rl,
      question: 'Target job ID',
      defaultValue: ownerOptions.jobId,
      required: true,
      transform: (value) => ensureIntegerString(value, { label: 'jobId' }),
    });

    const planOptions = { action, jobId };

    if (action === 'extend') {
      planOptions.commitExtension = await promptOrFallback({
        interactive,
        rl,
        question: 'Commit extension (seconds)',
        defaultValue: ownerOptions.commitExtension || '0',
        transform: (value) =>
          ensureIntegerString(value || '0', { label: 'commit extension', allowEmpty: true }) || '0',
      });
      planOptions.revealExtension = await promptOrFallback({
        interactive,
        rl,
        question: 'Reveal extension (seconds)',
        defaultValue: ownerOptions.revealExtension || '0',
        transform: (value) =>
          ensureIntegerString(value || '0', { label: 'reveal extension', allowEmpty: true }) || '0',
      });
      planOptions.disputeExtension = await promptOrFallback({
        interactive,
        rl,
        question: 'Dispute extension (seconds)',
        defaultValue: ownerOptions.disputeExtension || '0',
        transform: (value) =>
          ensureIntegerString(value || '0', { label: 'dispute extension', allowEmpty: true }) ||
          '0',
      });
    }

    if (action === 'finalize') {
      const successDefault = ownerOptions.success;
      planOptions.success = await promptBoolean({
        interactive,
        rl,
        question: 'Mark job as successful?',
        defaultValue: successDefault,
      });
    }

    if (action === 'timeout') {
      planOptions.slashAmount = await promptOrFallback({
        interactive,
        rl,
        question: 'Slash amount (wei)',
        defaultValue: ownerOptions.slashAmount || '0',
        transform: (value) =>
          ensureIntegerString(value || '0', { label: 'slash amount', allowEmpty: true }) || '0',
      });
    }

    if (action === 'resolve') {
      const slashWorkerDefault = ownerOptions.slashWorker;
      planOptions.slashWorker = await promptBoolean({
        interactive,
        rl,
        question: 'Slash the worker stake?',
        defaultValue: slashWorkerDefault,
      });
      planOptions.slashAmount = await promptOrFallback({
        interactive,
        rl,
        question: 'Slash amount (wei)',
        defaultValue: ownerOptions.slashAmount || '0',
        transform: (value) =>
          ensureIntegerString(value || '0', { label: 'slash amount', allowEmpty: true }) || '0',
      });
      planOptions.reputationDelta = await promptOrFallback({
        interactive,
        rl,
        question: 'Reputation delta (signed integer)',
        defaultValue: ownerOptions.reputationDelta || '0',
        transform: (value) =>
          ensureIntegerString(value || '0', {
            label: 'reputation delta',
            allowNegative: true,
          }) || '0',
      });
    }

    const plan = await buildOwnerTxPlan({ registry, web3, options: planOptions });
    const callData = registry.contract.methods[plan.method](...plan.args).encodeABI();

    console.log('');
    console.log('Proposed transaction plan:');
    const planLines = formatTxPlanLines(plan, callData, { to: registry.address });
    planLines.forEach((line) => console.log(`  ${line}`));

    let shouldExecute = Boolean(ownerOptions.execute);
    if (!shouldExecute && interactive && !wizardFlags.yes) {
      shouldExecute = await promptBoolean({
        interactive,
        rl,
        question: 'Broadcast transaction now?',
        defaultValue: ownerOptions.execute,
      });
    }

    if (shouldExecute) {
      if (
        toChecksumAddress(senderAddress).toLowerCase() !==
        toChecksumAddress(ownerAddress).toLowerCase()
      ) {
        throw new Error(
          `Sender ${senderAddress} is not the JobRegistry owner (${toChecksumAddress(ownerAddress)}).`
        );
      }

      const receipt = await registry[plan.method](...plan.args, { from: senderAddress });
      console.log(`Transaction broadcast. Hash: ${receipt.tx}`);
      cleanup();
      return;
    }

    console.log('Dry run: transaction not broadcast.');
    const dryRunArtifact = {
      timestamp: new Date().toISOString(),
      network: networkName || null,
      action: plan.action,
      from: senderAddress,
      to: registry.address,
      method: plan.method,
      args: plan.args,
      data: callData,
      metadata: serializeForJson(plan.metadata),
      warnings: plan.warnings,
    };

    console.log(JSON.stringify(dryRunArtifact, null, 2));

    if (wizardFlags.planOut) {
      writePlanToFile(wizardFlags.planOut, dryRunArtifact);
    }

    cleanup();
  } catch (error) {
    cleanup(error);
  }
};
