'use strict';

const {
  serializeValue,
  normalizeDiffMap,
  buildContractCallStep,
  writePlanSummary,
} = require('./plan-utils');

function buildStep({ jobRegistry, method, args, diff, summary }) {
  return buildContractCallStep({
    contract: jobRegistry,
    method,
    args,
    contractName: 'JobRegistry',
    diff,
    summary,
  });
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

module.exports = {
  buildSetPlanSummary,
  buildUpdatePlanSummary,
  writePlanSummary,
  normalizeDiffMap,
  serializeValue,
};
