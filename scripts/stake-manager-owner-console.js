'use strict';

const path = require('path');

const StakeManager = artifacts.require('StakeManager');

const { buildContractCallStep, writePlanSummary } = require('./lib/plan-utils');
const { extractNetwork, toChecksum } = require('./lib/job-registry-config-utils');

const ACTIONS = Object.freeze({
  STATUS: 'status',
  SET_JOB_REGISTRY: 'setJobRegistry',
  UPDATE_JOB_REGISTRY: 'updateJobRegistry',
  SET_FEE_RECIPIENT: 'setFeeRecipient',
  PAUSE: 'pause',
  UNPAUSE: 'unpause',
  EMERGENCY_RELEASE: 'emergencyRelease',
});

const ACTION_ALIASES = Object.freeze({
  status: ACTIONS.STATUS,
  'set-job-registry': ACTIONS.SET_JOB_REGISTRY,
  setjobregistry: ACTIONS.SET_JOB_REGISTRY,
  'update-job-registry': ACTIONS.UPDATE_JOB_REGISTRY,
  updatejobregistry: ACTIONS.UPDATE_JOB_REGISTRY,
  'set-fee-recipient': ACTIONS.SET_FEE_RECIPIENT,
  setfeerecipient: ACTIONS.SET_FEE_RECIPIENT,
  pause: ACTIONS.PAUSE,
  unpause: ACTIONS.UNPAUSE,
  'emergency-release': ACTIONS.EMERGENCY_RELEASE,
  emergencyrelease: ACTIONS.EMERGENCY_RELEASE,
});

const SELECTORS = Object.freeze({
  name: '0x06fdde03',
  symbol: '0x95d89b41',
});

function printHelp() {
  console.log('AGI Jobs v1 — StakeManager owner console');
  console.log(
    'Usage: npx truffle exec scripts/stake-manager-owner-console.js --network <network> [action] [options]'
  );
  console.log('');
  console.log('Actions (default: status):');
  console.log('  status                Display current configuration');
  console.log(
    '  set-job-registry      Call setJobRegistry with validation and Safe-ready plan output'
  );
  console.log(
    '  update-job-registry   Call updateJobRegistry (requires the contract to be paused)'
  );
  console.log('  set-fee-recipient     Configure the slash recipient address');
  console.log('  pause                 Pause deposits, withdrawals, and registry callbacks');
  console.log('  unpause               Resume operations after an incident');
  console.log("  emergency-release     Unlock a worker's stake without the registry");
  console.log('');
  console.log('Common options:');
  console.log('  --from <address>          Sender address (defaults to first unlocked account)');
  console.log('  --execute[=true|false]    Broadcast instead of dry run');
  console.log('  --dry-run[=true|false]    Alias for --execute false/true');
  console.log('  --plan-out <file>         Write a Safe-ready JSON plan to the provided path');
  console.log('  --help                    Show this message');
  console.log('');
  console.log('Action-specific options:');
  console.log('  set-job-registry:   --job-registry <address>');
  console.log('  update-job-registry:--job-registry <address> (contract must be paused)');
  console.log('  set-fee-recipient:  --fee-recipient <address>');
  console.log('  emergency-release:  --account <address> --amount <wei> | --amount-human <tokens>');
}

function normalizeKey(rawKey) {
  return rawKey
    .split('=')[0]
    .replace(/^[^a-zA-Z0-9-]+/, '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toLowerCase();
}

function parseBooleanFlag(value, defaultValue = false) {
  if (value === undefined || value === null) {
    return defaultValue;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 't', 'yes', 'y', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'f', 'no', 'n', 'off'].includes(normalized)) {
    return false;
  }

  throw new Error(`Unable to parse boolean flag from "${value}"`);
}

function normalizeAction(value) {
  if (!value && value !== 0) {
    return ACTIONS.STATUS;
  }

  const normalized = String(value).trim();
  if (!normalized) {
    return ACTIONS.STATUS;
  }

  const compact = normalized.toLowerCase().replace(/[_\s]+/g, '-');
  const alias = ACTION_ALIASES[compact] || ACTION_ALIASES[compact.replace(/-/g, '')];
  if (!alias) {
    throw new Error(
      `Unsupported action "${value}". Use status, set-job-registry, update-job-registry, set-fee-recipient, pause, unpause, or emergency-release.`
    );
  }

  return alias;
}

function parseCliArgs(argv) {
  const result = {
    action: ACTIONS.STATUS,
    execute: false,
    from: null,
    planOut: null,
    jobRegistry: null,
    feeRecipient: null,
    account: null,
    amount: null,
    amountHuman: null,
    help: false,
  };

  const positional = [];

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (typeof arg !== 'string') {
      continue;
    }

    if (!arg.startsWith('--')) {
      if (arg === 'truffle' || arg === 'exec' || arg.endsWith('.js')) {
        continue;
      }
      positional.push(arg);
      continue;
    }

    if (arg === '--help' || arg === '-h') {
      result.help = true;
      continue;
    }

    let key = null;
    let value = null;

    if (arg.includes('=')) {
      const [lhs, rhs] = arg.split(/=(.+)/);
      key = normalizeKey(lhs.slice(2));
      value = rhs;
    } else {
      key = normalizeKey(arg.slice(2));
      const next = argv[i + 1];
      if (next !== undefined && typeof next === 'string' && !next.startsWith('--')) {
        value = next;
        i += 1;
      } else {
        value = true;
      }
    }

    switch (key) {
      case 'action':
        if (value !== true) {
          positional.push(value);
        }
        break;
      case 'from':
        result.from = typeof value === 'string' ? value : null;
        break;
      case 'execute':
        result.execute = parseBooleanFlag(value === true ? true : value, true);
        break;
      case 'dryrun': {
        const dryRun = parseBooleanFlag(value === true ? true : value, true);
        result.execute = !dryRun;
        break;
      }
      case 'planout':
        if (typeof value !== 'string' || value.length === 0) {
          throw new Error('--plan-out requires a file path');
        }
        result.planOut = path.resolve(value);
        break;
      case 'jobregistry':
        if (value === true || value === undefined || value === null) {
          throw new Error('--job-registry requires an address');
        }
        result.jobRegistry = String(value);
        break;
      case 'feerecipient':
        if (value === true || value === undefined || value === null) {
          throw new Error('--fee-recipient requires an address');
        }
        result.feeRecipient = String(value);
        break;
      case 'account':
        if (value === true || value === undefined || value === null) {
          throw new Error('--account requires an address');
        }
        result.account = String(value);
        break;
      case 'amount':
        if (value === true || value === undefined || value === null) {
          throw new Error('--amount requires a numeric value');
        }
        result.amount = String(value);
        break;
      case 'amounthuman':
        if (value === true || value === undefined || value === null) {
          throw new Error('--amount-human requires a decimal token amount');
        }
        result.amountHuman = String(value);
        break;
      default:
        break;
    }
  }

  if (positional.length > 0) {
    result.action = normalizeAction(positional[0]);
  }

  return result;
}

function isZeroAddress(address) {
  if (!address) {
    return true;
  }
  const normalized = String(address).toLowerCase();
  return normalized === '0x0000000000000000000000000000000000000000';
}

async function callOptionalString(address, selector) {
  if (!address || isZeroAddress(address)) {
    return null;
  }

  try {
    const result = await web3.eth.call({ to: address, data: selector });
    if (!result || result === '0x') {
      return null;
    }
    return web3.eth.abi.decodeParameter('string', result);
  } catch (error) {
    const message = String(error && error.message ? error.message : error).toLowerCase();
    if (
      message.includes('execution reverted') ||
      message.includes('revert') ||
      message.includes('invalid opcode') ||
      message.includes('method not found') ||
      (typeof error?.code === 'number' && (error.code === -32601 || error.code === 3))
    ) {
      return null;
    }
    throw error;
  }
}

async function fetchTokenMetadata(address) {
  if (!address || isZeroAddress(address)) {
    return { address: null, name: null, symbol: null };
  }

  const [name, symbol] = await Promise.all([
    callOptionalString(address, SELECTORS.name),
    callOptionalString(address, SELECTORS.symbol),
  ]);

  return {
    address,
    name: name ? name.trim() : null,
    symbol: symbol ? symbol.trim() : null,
  };
}

function parseTokenAmount({ rawAmount, humanAmount, decimals }) {
  if (rawAmount && humanAmount) {
    throw new Error(
      'Provide either --amount (raw units) or --amount-human (token units), not both.'
    );
  }

  if (!rawAmount && !humanAmount) {
    throw new Error('Specify --amount or --amount-human for emergency-release.');
  }

  if (humanAmount) {
    const trimmed = humanAmount.trim();
    if (!/^\d+(\.\d+)?$/.test(trimmed)) {
      throw new Error(
        `Invalid decimal token amount "${humanAmount}". Use digits and an optional decimal point.`
      );
    }
    const [whole, fraction = ''] = trimmed.split('.');
    if (fraction.length > decimals) {
      throw new Error(
        `Token amount precision exceeds stake token decimals (${decimals}). Provided ${fraction.length} decimal places.`
      );
    }
    const normalized = `${whole}${fraction.padEnd(decimals, '0')}`.replace(/^0+/, '');
    return normalized.length === 0 ? '0' : normalized;
  }

  const rawTrimmed = rawAmount.trim();
  if (!/^\d+$/.test(rawTrimmed)) {
    throw new Error(`Invalid raw amount "${rawAmount}". Provide a non-negative integer.`);
  }
  return rawTrimmed.replace(/^0+/, '') || '0';
}

function formatTokenAmount(amount, decimals) {
  if (!amount) {
    return '0';
  }
  const value = BigInt(amount);
  if (decimals === 0) {
    return value.toString();
  }
  const base = BigInt(10) ** BigInt(decimals);
  const whole = value / base;
  const fraction = value % base;
  if (fraction === 0n) {
    return whole.toString();
  }
  const fractionString = fraction.toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${whole.toString()}.${fractionString}`;
}

function ensureAddress(value, label) {
  if (!value || typeof value !== 'string') {
    throw new Error(`${label} must be provided`);
  }
  const trimmed = value.trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(trimmed)) {
    throw new Error(`${label} must be a 20-byte hexadecimal address`);
  }
  return toChecksum(trimmed);
}

function buildPlan({ action, stakeManager, method, args, sender, dryRun, diff, summary, context }) {
  const step = buildContractCallStep({
    contract: stakeManager,
    method,
    args,
    contractName: 'StakeManager',
    diff,
    summary,
  });

  return {
    action,
    dryRun: Boolean(dryRun),
    stakeManager: context.stakeManager,
    sender,
    owner: context.owner,
    paused: context.paused,
    jobRegistry: context.jobRegistry,
    feeRecipient: context.feeRecipient,
    stakeToken: context.stakeToken,
    generatedAt: new Date().toISOString(),
    steps: [step],
  };
}

function printContext({ stakeManager, owner, paused, jobRegistry, feeRecipient, token }) {
  console.log(`StakeManager: ${stakeManager}`);
  console.log(`Owner: ${owner || '(unknown)'}`);
  console.log(`Paused: ${paused ? 'yes' : 'no'}`);
  console.log(`JobRegistry: ${jobRegistry.display}`);
  console.log(`Fee recipient: ${feeRecipient.display}`);
  const descriptor = [];
  if (token.symbol) {
    descriptor.push(token.symbol);
  }
  if (token.name) {
    descriptor.push(`(${token.name})`);
  }
  const tokenLabel = token.display || token.address || '(unset)';
  console.log(`Stake token: ${tokenLabel}${descriptor.length ? ` ${descriptor.join(' ')}` : ''}`);
  console.log(`Stake token decimals: ${token.decimals}`);
}

module.exports = async function (callback) {
  try {
    const options = parseCliArgs(process.argv);
    if (options.help) {
      printHelp();
      callback();
      return;
    }

    const action = options.action;
    const networkName =
      extractNetwork(process.argv) || process.env.NETWORK || process.env.TRUFFLE_NETWORK || null;

    const stakeManager = await StakeManager.deployed();
    const stakeManagerAddress = toChecksum(stakeManager.address);
    const owner = toChecksum(await stakeManager.owner());
    const paused = Boolean(await stakeManager.paused());
    const currentJobRegistry = await stakeManager.jobRegistry();
    const currentFeeRecipient = await stakeManager.feeRecipient();
    const stakeTokenAddress = await stakeManager.stakeToken();
    const stakeTokenDecimalsRaw = await stakeManager.stakeTokenDecimals();
    const stakeTokenDecimals = Number(stakeTokenDecimalsRaw.toString());
    const tokenMetadata = await fetchTokenMetadata(stakeTokenAddress);

    const accounts = await web3.eth.getAccounts();
    const sender = options.from
      ? toChecksum(options.from)
      : accounts[0]
        ? toChecksum(accounts[0])
        : null;

    if (!sender) {
      throw new Error('No sender account is available. Specify --from explicitly.');
    }

    const isOwner = owner && sender && owner.toLowerCase() === sender.toLowerCase();

    const jobRegistryAddress = isZeroAddress(currentJobRegistry)
      ? null
      : toChecksum(currentJobRegistry);
    const feeRecipientAddress = isZeroAddress(currentFeeRecipient)
      ? null
      : toChecksum(currentFeeRecipient);
    const stakeTokenChecksum = isZeroAddress(stakeTokenAddress)
      ? null
      : toChecksum(stakeTokenAddress);

    const context = {
      stakeManager: stakeManagerAddress,
      owner,
      paused,
      jobRegistry: {
        address: jobRegistryAddress,
        display: jobRegistryAddress || '(unset)',
      },
      feeRecipient: {
        address: feeRecipientAddress,
        display: feeRecipientAddress || '(unset)',
      },
      stakeToken: {
        address: stakeTokenChecksum,
        display: stakeTokenChecksum || '(unset)',
        symbol: tokenMetadata.symbol,
        name: tokenMetadata.name,
        decimals: stakeTokenDecimals,
      },
    };

    console.log('AGIJobsv1 — StakeManager owner console');
    console.log(`Action: ${action}`);
    console.log(`Network: ${networkName || '(unspecified)'}`);
    printContext({
      stakeManager: stakeManagerAddress,
      owner,
      paused,
      jobRegistry: context.jobRegistry,
      feeRecipient: context.feeRecipient,
      token: context.stakeToken,
    });
    console.log(`Sender: ${toChecksum(sender)}`);
    console.log('');

    if (action === ACTIONS.STATUS) {
      callback();
      return;
    }

    const shouldExecute = Boolean(options.execute);

    if (!isOwner && shouldExecute) {
      throw new Error(`Sender ${sender} is not the StakeManager owner (${owner}).`);
    }

    let method = null;
    let args = [];
    let diff = null;
    let summary = null;

    if (action === ACTIONS.SET_JOB_REGISTRY) {
      if (!isZeroAddress(currentJobRegistry)) {
        throw new Error(
          `StakeManager already references a JobRegistry (${toChecksum(currentJobRegistry)}). Use update-job-registry while paused.`
        );
      }
      const desired = ensureAddress(options.jobRegistry, 'Job registry address');
      method = 'setJobRegistry';
      args = [desired];
      diff = { jobRegistry: { previous: currentJobRegistry, next: desired } };
      summary = { jobRegistry: { previous: currentJobRegistry, next: desired } };
    } else if (action === ACTIONS.UPDATE_JOB_REGISTRY) {
      if (!paused) {
        throw new Error(
          'update-job-registry requires the StakeManager to be paused. Run pause first.'
        );
      }
      if (isZeroAddress(currentJobRegistry)) {
        throw new Error(
          'StakeManager has no job registry configured. Use set-job-registry instead.'
        );
      }
      const desired = ensureAddress(options.jobRegistry, 'Job registry address');
      if (toChecksum(currentJobRegistry) === desired) {
        throw new Error('Job registry address is unchanged. Provide a different address.');
      }
      method = 'updateJobRegistry';
      args = [desired];
      diff = { jobRegistry: { previous: currentJobRegistry, next: desired } };
      summary = { jobRegistry: { previous: currentJobRegistry, next: desired } };
    } else if (action === ACTIONS.SET_FEE_RECIPIENT) {
      const desired = ensureAddress(options.feeRecipient, 'Fee recipient address');
      method = 'setFeeRecipient';
      args = [desired];
      diff = { feeRecipient: { previous: currentFeeRecipient, next: desired } };
      summary = { feeRecipient: { previous: currentFeeRecipient, next: desired } };
    } else if (action === ACTIONS.PAUSE) {
      if (paused) {
        console.log('StakeManager is already paused.');
        callback();
        return;
      }
      method = 'pause';
      args = [];
      summary = { paused: { previous: paused, next: true } };
    } else if (action === ACTIONS.UNPAUSE) {
      if (!paused) {
        console.log('StakeManager is already unpaused.');
        callback();
        return;
      }
      method = 'unpause';
      args = [];
      summary = { paused: { previous: paused, next: false } };
    } else if (action === ACTIONS.EMERGENCY_RELEASE) {
      const account = ensureAddress(options.account, 'Account address');
      const amountRaw = parseTokenAmount({
        rawAmount: options.amount,
        humanAmount: options.amountHuman,
        decimals: stakeTokenDecimals,
      });
      if (amountRaw === '0') {
        throw new Error('Emergency release amount must be greater than zero.');
      }
      method = 'emergencyRelease';
      args = [account, amountRaw];
      diff = { lockedAmounts: { previous: null, next: amountRaw } };
      summary = {
        emergencyRelease: {
          account,
          amountRaw,
          amountHuman: formatTokenAmount(amountRaw, stakeTokenDecimals),
        },
      };
    } else {
      throw new Error(`Unhandled action ${action}`);
    }

    const plan = buildPlan({
      action,
      stakeManager,
      method,
      args,
      sender,
      dryRun: !shouldExecute,
      diff,
      summary,
      context,
    });

    const step = plan.steps[0];
    const callPayload = {
      to: step.call.to,
      from: sender,
      value: '0',
      data: step.call.data,
      description: step.description,
    };

    if (options.planOut) {
      const written = writePlanSummary(plan, options.planOut);
      console.log(`Plan written to ${written}`);
    }

    if (!shouldExecute) {
      console.log('Dry run: transaction not broadcast.');
      console.log(JSON.stringify(callPayload, null, 2));
      callback();
      return;
    }

    const receipt = await stakeManager[method](...args, { from: sender });
    console.log(`Transaction broadcast. Hash: ${receipt.tx}`);
    callback();
  } catch (error) {
    callback(error);
  }
};
