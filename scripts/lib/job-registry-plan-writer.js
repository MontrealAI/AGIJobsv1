'use strict';

const fs = require('fs');
const path = require('path');

function serializeValue(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const valueType = typeof value;
  if (valueType === 'string' || valueType === 'boolean') {
    return value;
  }

  if (valueType === 'number') {
    return Number.isFinite(value) ? value : value.toString();
  }

  if (valueType === 'bigint') {
    return value.toString();
  }

  if (Array.isArray(value)) {
    return value.map((entry) => serializeValue(entry));
  }

  if (value && valueType === 'object') {
    if (typeof value.toString === 'function' && value.toString !== Object.prototype.toString) {
      const stringified = value.toString();
      if (stringified !== '[object Object]') {
        return stringified;
      }
    }

    return Object.entries(value).reduce((acc, [key, entry]) => {
      acc[key] = serializeValue(entry);
      return acc;
    }, {});
  }

  return String(value);
}

function normalizeDiffMap(diff) {
  if (!diff || typeof diff !== 'object') {
    return {};
  }

  return Object.entries(diff).reduce((acc, [key, entry]) => {
    const normalized = entry || {};
    const previous = normalized.previous === undefined ? null : normalized.previous;
    const next = normalized.next === undefined ? null : normalized.next;
    acc[key] = {
      previous: previous === null ? null : serializeValue(previous),
      next: next === null ? null : serializeValue(next),
    };
    return acc;
  }, {});
}

function buildStep({ jobRegistry, method, args, diff, summary }) {
  if (!jobRegistry || !jobRegistry.contract || !jobRegistry.contract.methods) {
    throw new Error('jobRegistry contract instance is required to build plan steps');
  }

  const encoder = jobRegistry.contract.methods[method];
  if (typeof encoder !== 'function') {
    throw new Error(`JobRegistry method ${method} is not available on the contract instance`);
  }

  const encodedArgs = Array.isArray(args) ? args : [];
  const data = jobRegistry.contract.methods[method](...encodedArgs).encodeABI();

  return {
    method,
    description: `JobRegistry.${method}`,
    arguments: serializeValue(encodedArgs),
    diff: normalizeDiffMap(diff),
    summary: summary ? serializeValue(summary) : null,
    call: {
      to: jobRegistry.address,
      value: '0',
      data,
    },
  };
}

function buildSetPlanSummary({
  jobRegistry,
  jobRegistryAddress,
  sender,
  plans,
  configuration,
  variant,
  dryRun,
}) {
  if (!plans || typeof plans !== 'object') {
    throw new Error('plans must be provided when building the set action plan summary');
  }

  const steps = [];

  if (plans.atomicPlan && plans.atomicPlan.changed) {
    steps.push(
      buildStep({
        jobRegistry,
        method: 'setFullConfiguration',
        args: [plans.atomicPlan.desired.modules, plans.atomicPlan.desired.timings, plans.atomicPlan.desired.thresholds],
        diff: plans.atomicPlan.diff,
      })
    );
  } else {
    if (plans.modulesPlan && plans.modulesPlan.changed) {
      steps.push(
        buildStep({
          jobRegistry,
          method: 'setModules',
          args: [plans.modulesPlan.desired],
          diff: plans.modulesPlan.diff,
        })
      );
    }

    if (plans.timingsPlan && plans.timingsPlan.changed) {
      const { commitWindow, revealWindow, disputeWindow } = plans.timingsPlan.desired;
      steps.push(
        buildStep({
          jobRegistry,
          method: 'setTimings',
          args: [commitWindow, revealWindow, disputeWindow],
          diff: plans.timingsPlan.diff,
        })
      );
    }

    if (plans.thresholdsPlan && plans.thresholdsPlan.changed) {
      const { approvalThresholdBps, quorumMin, quorumMax, feeBps, slashBpsMax } =
        plans.thresholdsPlan.desired;
      steps.push(
        buildStep({
          jobRegistry,
          method: 'setThresholds',
          args: [approvalThresholdBps, quorumMin, quorumMax, feeBps, slashBpsMax],
          diff: plans.thresholdsPlan.diff,
        })
      );
    }
  }

  return {
    action: 'set',
    dryRun: Boolean(dryRun),
    jobRegistry: jobRegistryAddress,
    sender,
    variant: variant || null,
    configuration: configuration ? serializeValue(configuration) : null,
    generatedAt: new Date().toISOString(),
    steps,
  };
}

function buildUpdatePlanSummary({
  jobRegistry,
  jobRegistryAddress,
  sender,
  plan,
  configuration,
  variant,
  dryRun,
}) {
  if (!plan || typeof plan !== 'object') {
    throw new Error('plan must be provided when building the update action plan summary');
  }

  const step = buildStep({
    jobRegistry,
    method: plan.method,
    args: plan.args,
    diff: plan.summary ? { [plan.summary.key]: plan.summary } : null,
    summary: plan.summary || null,
  });

  return {
    action: 'update',
    dryRun: Boolean(dryRun),
    jobRegistry: jobRegistryAddress,
    sender,
    variant: variant || null,
    configuration: configuration ? serializeValue(configuration) : null,
    generatedAt: new Date().toISOString(),
    steps: [step],
  };
}

function writePlanSummary(plan, outputPath) {
  if (!outputPath || typeof outputPath !== 'string') {
    throw new Error('outputPath must be a non-empty string when writing plan summaries');
  }

  const resolvedPath = path.resolve(outputPath);
  const directory = path.dirname(resolvedPath);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(resolvedPath, `${JSON.stringify(plan, null, 2)}\n`, 'utf8');
  return resolvedPath;
}

module.exports = {
  buildSetPlanSummary,
  buildUpdatePlanSummary,
  writePlanSummary,
  // Exported for unit tests
  __private__: {
    serializeValue,
    normalizeDiffMap,
    buildStep,
  },
};
