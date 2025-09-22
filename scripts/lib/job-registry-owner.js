'use strict';

const JOB_STATE_NAMES = ['None', 'Created', 'Committed', 'Revealed', 'Finalized', 'Disputed'];
const BPS_DENOMINATOR = 10000;

function parseBooleanFlag(value, defaultValue) {
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

function parseOwnerConsoleArgs(argv) {
  const result = {
    action: 'status',
    execute: false,
    from: null,
    jobId: null,
    commitExtension: null,
    revealExtension: null,
    disputeExtension: null,
    success: true,
    slashWorker: false,
    slashAmount: '0',
    reputationDelta: '0',
    help: false,
  };

  function assignValue(key, value) {
    switch (key) {
      case 'action':
        if (value) {
          result.action = String(value);
        }
        break;
      case 'execute': {
        const boolValue = parseBooleanFlag(value ?? true, true);
        result.execute = boolValue;
        break;
      }
      case 'dry-run': {
        const dryRun = parseBooleanFlag(value ?? true, true);
        result.execute = !dryRun;
        break;
      }
      case 'from':
        if (value) {
          result.from = String(value);
        }
        break;
      case 'job':
      case 'job-id':
      case 'jobId':
        if (value !== undefined && value !== null && value !== '') {
          result.jobId = String(value);
        }
        break;
      case 'commit-extension':
      case 'commitExtension':
        result.commitExtension = String(value);
        break;
      case 'reveal-extension':
      case 'revealExtension':
        result.revealExtension = String(value);
        break;
      case 'dispute-extension':
      case 'disputeExtension':
        result.disputeExtension = String(value);
        break;
      case 'success':
        result.success = parseBooleanFlag(value ?? true, true);
        break;
      case 'slash-worker':
      case 'slashWorker':
        result.slashWorker = parseBooleanFlag(value ?? true, true);
        break;
      case 'slash-amount':
      case 'slashAmount':
        if (value === undefined || value === null) {
          result.slashAmount = '0';
        } else {
          result.slashAmount = String(value);
        }
        break;
      case 'reputation-delta':
      case 'reputationDelta':
        if (value === undefined || value === null) {
          result.reputationDelta = '0';
        } else {
          result.reputationDelta = String(value);
        }
        break;
      case 'help':
        result.help = true;
        break;
      default:
        break;
    }
  }

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (typeof arg !== 'string') {
      continue;
    }

    if (arg.startsWith('--')) {
      const trimmed = arg.slice(2);
      if (trimmed.includes('=')) {
        const [key, rawValue] = trimmed.split(/=(.+)/);
        assignValue(key, rawValue);
      } else if (trimmed === 'help') {
        assignValue('help');
      } else {
        const key = trimmed;
        const next = argv[i + 1];
        if (next === undefined || (typeof next === 'string' && next.startsWith('--'))) {
          assignValue(key, true);
        } else {
          assignValue(key, next);
          i += 1;
        }
      }
      continue;
    }

    if (!result.action || result.action === 'status') {
      result.action = String(arg);
    }
  }

  return result;
}

function jobStateName(stateIndex) {
  return JOB_STATE_NAMES[stateIndex] || `Unknown(${stateIndex})`;
}

function formatBigNumber(value) {
  if (!value) {
    return '0';
  }

  if (typeof value === 'string') {
    return value;
  }

  if (value.toString) {
    return value.toString();
  }

  return String(value);
}

function normalizeStruct(struct, keys) {
  const normalized = {};
  keys.forEach((key) => {
    const value = struct[key];
    normalized[key] = formatBigNumber(value);
  });
  return normalized;
}

async function collectOwnerStatus({ registry, web3, owner, jobId }) {
  const [modules, timings, thresholds, config] = await Promise.all([
    registry.modules(),
    registry.timings(),
    registry.thresholds(),
    registry.configurationStatus(),
  ]);

  const modulesSummary = normalizeStruct(modules, [
    'identity',
    'staking',
    'validation',
    'dispute',
    'reputation',
    'feePool',
  ]);
  const timingsSummary = normalizeStruct(timings, [
    'commitWindow',
    'revealWindow',
    'disputeWindow',
  ]);
  const thresholdsSummary = normalizeStruct(thresholds, [
    'approvalThresholdBps',
    'quorumMin',
    'quorumMax',
    'feeBps',
    'slashBpsMax',
  ]);

  const configuration = {
    modules: Boolean(config[0]),
    timings: Boolean(config[1]),
    thresholds: Boolean(config[2]),
  };

  let jobSummary = null;
  if (jobId !== null && jobId !== undefined) {
    const { BN } = web3.utils;
    const jobIdBn = new BN(jobId);
    const job = await registry.jobs(jobIdBn);
    const stateIndex = job.state.toNumber();
    if (stateIndex !== 0 || job.client !== '0x0000000000000000000000000000000000000000') {
      jobSummary = {
        id: jobIdBn.toString(),
        client: job.client,
        worker: job.worker,
        stakeAmount: formatBigNumber(job.stakeAmount),
        commitDeadline: formatBigNumber(job.commitDeadline),
        revealDeadline: formatBigNumber(job.revealDeadline),
        disputeDeadline: formatBigNumber(job.disputeDeadline),
        commitHash: job.commitHash,
        state: {
          value: stateIndex,
          name: jobStateName(stateIndex),
        },
      };
    }
  }

  return {
    owner,
    configuration,
    modules: modulesSummary,
    timings: timingsSummary,
    thresholds: thresholdsSummary,
    job: jobSummary,
  };
}

function requireJobPresent(jobId, jobRaw) {
  const stateIndex = jobRaw.state.toNumber();
  if (stateIndex === 0 && jobRaw.client === '0x0000000000000000000000000000000000000000') {
    throw new Error(`Job ${jobId} has not been created`);
  }
}

function requireStateIn(jobId, jobRaw, allowedStates) {
  const stateIndex = jobRaw.state.toNumber();
  if (!allowedStates.includes(stateIndex)) {
    throw new Error(
      `Job ${jobId} cannot perform this action from state ${jobStateName(stateIndex)} (${stateIndex})`
    );
  }
}

function bnFrom(web3, value, label, { allowNegative = false } = {}) {
  const { BN } = web3.utils;
  try {
    const bn = new BN(value ?? '0');
    if (!allowNegative && bn.isNeg()) {
      throw new Error(`${label} must not be negative`);
    }
    return bn;
  } catch (error) {
    if (error && error.message && error.message.includes('not a number')) {
      throw new Error(`Unable to parse ${label} from "${value}"`);
    }
    throw error;
  }
}

function buildDeadlineSummary(before, extensions) {
  return {
    before: {
      commitDeadline: before.commitDeadline.clone(),
      revealDeadline: before.revealDeadline.clone(),
      disputeDeadline: before.disputeDeadline.clone(),
    },
    after: {
      commitDeadline: before.commitDeadline.add(extensions.commit),
      revealDeadline: before.revealDeadline.add(extensions.reveal),
      disputeDeadline: before.disputeDeadline.add(extensions.dispute),
    },
  };
}

async function buildOwnerTxPlan({ registry, web3, options }) {
  const action = options.action || 'status';
  if (action === 'status') {
    throw new Error(
      'Status action does not produce a transaction plan. Call collectOwnerStatus instead.'
    );
  }

  const { BN } = web3.utils;
  if (!options.jobId) {
    throw new Error('jobId is required for owner actions');
  }
  const jobIdBn = new BN(options.jobId);
  const jobRaw = await registry.jobs(jobIdBn);
  requireJobPresent(jobIdBn.toString(), jobRaw);

  const stakeAmount = jobRaw.stakeAmount.clone
    ? jobRaw.stakeAmount.clone()
    : new BN(jobRaw.stakeAmount);
  const thresholds = await registry.thresholds();
  const slashBpsMax = new BN(thresholds.slashBpsMax.toString());
  const feeBps = new BN(thresholds.feeBps.toString());
  const metadata = {
    jobId: jobIdBn.toString(),
    client: jobRaw.client,
    worker: jobRaw.worker,
    stakeAmount,
    state: {
      value: jobRaw.state.toNumber(),
      name: jobStateName(jobRaw.state.toNumber()),
    },
  };

  if (action === 'extend') {
    const commitExtension = bnFrom(web3, options.commitExtension || '0', 'commitExtension');
    const revealExtension = bnFrom(web3, options.revealExtension || '0', 'revealExtension');
    const disputeExtension = bnFrom(web3, options.disputeExtension || '0', 'disputeExtension');

    if (commitExtension.isZero() && revealExtension.isZero() && disputeExtension.isZero()) {
      throw new Error('At least one extension value must be greater than zero');
    }

    requireStateIn(metadata.jobId, jobRaw, [1, 2, 3]);

    const deadlines = buildDeadlineSummary(
      {
        commitDeadline: jobRaw.commitDeadline.clone
          ? jobRaw.commitDeadline.clone()
          : new BN(jobRaw.commitDeadline),
        revealDeadline: jobRaw.revealDeadline.clone
          ? jobRaw.revealDeadline.clone()
          : new BN(jobRaw.revealDeadline),
        disputeDeadline: jobRaw.disputeDeadline.clone
          ? jobRaw.disputeDeadline.clone()
          : new BN(jobRaw.disputeDeadline),
      },
      {
        commit: commitExtension,
        reveal: revealExtension,
        dispute: disputeExtension,
      }
    );

    return {
      action: 'extend',
      method: 'extendJobDeadlines',
      args: [
        metadata.jobId,
        commitExtension.toString(),
        revealExtension.toString(),
        disputeExtension.toString(),
      ],
      metadata: {
        ...metadata,
        deadlines,
      },
      warnings: [],
    };
  }

  if (action === 'finalize') {
    requireStateIn(metadata.jobId, jobRaw, [3]);

    const feeAmount = stakeAmount.mul(feeBps).div(new BN(BPS_DENOMINATOR));

    return {
      action: 'finalize',
      method: 'finalizeJob',
      args: [metadata.jobId, Boolean(options.success)],
      metadata: {
        ...metadata,
        success: Boolean(options.success),
        feeAmount,
      },
      warnings: [],
    };
  }

  if (action === 'timeout') {
    requireStateIn(metadata.jobId, jobRaw, [2]);

    const slashAmount = bnFrom(web3, options.slashAmount || '0', 'slashAmount');
    if (slashAmount.gt(stakeAmount)) {
      throw new Error('slashAmount must not exceed the job stake amount');
    }

    const maxSlash = stakeAmount.mul(slashBpsMax).div(new BN(BPS_DENOMINATOR));
    if (slashAmount.gt(maxSlash)) {
      throw new Error(
        `slashAmount exceeds the configured maximum (${maxSlash.toString()}) for job ${metadata.jobId}`
      );
    }

    return {
      action: 'timeout',
      method: 'timeoutJob',
      args: [metadata.jobId, slashAmount.toString()],
      metadata: {
        ...metadata,
        slashAmount,
        maxSlash,
      },
      warnings: [],
    };
  }

  if (action === 'resolve') {
    requireStateIn(metadata.jobId, jobRaw, [5]);

    const slashWorker = Boolean(options.slashWorker);
    const slashAmount = bnFrom(web3, options.slashAmount || '0', 'slashAmount');
    if (!slashWorker && !slashAmount.isZero()) {
      throw new Error('slashAmount must be zero when slashWorker is false');
    }

    if (slashAmount.gt(stakeAmount)) {
      throw new Error('slashAmount must not exceed the job stake amount');
    }

    const maxSlash = stakeAmount.mul(slashBpsMax).div(new BN(BPS_DENOMINATOR));
    if (slashAmount.gt(maxSlash)) {
      throw new Error(
        `slashAmount exceeds the configured maximum (${maxSlash.toString()}) for job ${metadata.jobId}`
      );
    }

    const reputationDelta = options.reputationDelta || '0';

    return {
      action: 'resolve',
      method: 'resolveDispute',
      args: [metadata.jobId, slashWorker, slashAmount.toString(), reputationDelta],
      metadata: {
        ...metadata,
        slashWorker,
        slashAmount,
        reputationDelta,
        maxSlash,
      },
      warnings: [],
    };
  }

  throw new Error(`Unsupported owner console action: ${action}`);
}

function formatStatusLines(status) {
  const lines = [];
  lines.push(`Owner: ${status.owner}`);
  lines.push('Configuration status:');
  lines.push(`  modules: ${status.configuration.modules ? 'configured' : 'incomplete'}`);
  lines.push(`  timings: ${status.configuration.timings ? 'configured' : 'incomplete'}`);
  lines.push(`  thresholds: ${status.configuration.thresholds ? 'configured' : 'incomplete'}`);
  lines.push('Modules:');
  Object.entries(status.modules).forEach(([key, value]) => {
    lines.push(`  ${key}: ${value}`);
  });
  lines.push('Timings (seconds):');
  Object.entries(status.timings).forEach(([key, value]) => {
    lines.push(`  ${key}: ${value}`);
  });
  lines.push('Thresholds:');
  Object.entries(status.thresholds).forEach(([key, value]) => {
    lines.push(`  ${key}: ${value}`);
  });

  if (status.job) {
    lines.push('Job summary:');
    lines.push(`  id: ${status.job.id}`);
    lines.push(`  state: ${status.job.state.name} (${status.job.state.value})`);
    lines.push(`  client: ${status.job.client}`);
    lines.push(`  worker: ${status.job.worker}`);
    lines.push(`  stakeAmount: ${status.job.stakeAmount}`);
    lines.push(`  commitDeadline: ${status.job.commitDeadline}`);
    lines.push(`  revealDeadline: ${status.job.revealDeadline}`);
    lines.push(`  disputeDeadline: ${status.job.disputeDeadline}`);
    lines.push(`  commitHash: ${status.job.commitHash}`);
  }

  return lines;
}

function formatTxPlanLines(plan, callData, { to }) {
  const lines = [];
  lines.push(`Action: ${plan.action}`);
  lines.push(`  jobId: ${plan.metadata.jobId}`);
  lines.push(`  current state: ${plan.metadata.state.name} (${plan.metadata.state.value})`);
  lines.push(`  client: ${plan.metadata.client}`);
  lines.push(`  worker: ${plan.metadata.worker}`);
  lines.push(`  stakeAmount: ${plan.metadata.stakeAmount.toString()}`);

  if (plan.action === 'extend') {
    const { before, after } = plan.metadata.deadlines;
    lines.push('  deadlines:');
    lines.push(
      `    commit: ${before.commitDeadline.toString()} -> ${after.commitDeadline.toString()}`
    );
    lines.push(
      `    reveal: ${before.revealDeadline.toString()} -> ${after.revealDeadline.toString()}`
    );
    lines.push(
      `    dispute: ${before.disputeDeadline.toString()} -> ${after.disputeDeadline.toString()}`
    );
  }

  if (plan.action === 'finalize') {
    lines.push(`  success flag: ${plan.metadata.success}`);
    lines.push(`  feeAmount: ${plan.metadata.feeAmount.toString()}`);
  }

  if (plan.action === 'timeout') {
    lines.push(`  slashAmount: ${plan.metadata.slashAmount.toString()}`);
    lines.push(`  maxSlash: ${plan.metadata.maxSlash.toString()}`);
  }

  if (plan.action === 'resolve') {
    lines.push(`  slashWorker: ${plan.metadata.slashWorker}`);
    lines.push(`  slashAmount: ${plan.metadata.slashAmount.toString()}`);
    lines.push(`  maxSlash: ${plan.metadata.maxSlash.toString()}`);
    lines.push(`  reputationDelta: ${plan.metadata.reputationDelta}`);
  }

  lines.push('Transaction payload:');
  lines.push(`  to: ${to}`);
  lines.push(`  method: ${plan.method}`);
  lines.push(`  args: ${JSON.stringify(plan.args)}`);
  lines.push(`  data: ${callData}`);

  return lines;
}

module.exports = {
  JOB_STATE_NAMES,
  BPS_DENOMINATOR,
  parseOwnerConsoleArgs,
  collectOwnerStatus,
  buildOwnerTxPlan,
  formatStatusLines,
  formatTxPlanLines,
};
