const { expect } = require('chai');
const fs = require('fs');
const path = require('path');

const JobRegistry = artifacts.require('JobRegistry');

const {
  buildSetPlanSummary,
  buildUpdatePlanSummary,
  writePlanSummary,
} = require('../scripts/lib/job-registry-plan-writer');

function diffFromObject(values) {
  return Object.entries(values).reduce((acc, [key, value]) => {
    acc[key] = { previous: null, next: value };
    return acc;
  }, {});
}

contract('JobRegistry plan writer', (accounts) => {
  const [owner, identity, staking, validation, dispute, reputation, feePool] = accounts;

  it('builds set action plan summaries with encoded call data', async () => {
    const jobRegistry = await JobRegistry.new({ from: owner });

    const modulesDesired = {
      identity,
      staking,
      validation,
      dispute,
      reputation,
      feePool,
    };
    const timingsDesired = {
      commitWindow: 3600,
      revealWindow: 5400,
      disputeWindow: 7200,
    };
    const thresholdsDesired = {
      approvalThresholdBps: 6000,
      quorumMin: 3,
      quorumMax: 9,
      feeBps: 275,
      slashBpsMax: 2000,
    };

    const summary = buildSetPlanSummary({
      jobRegistry,
      jobRegistryAddress: jobRegistry.address,
      sender: owner,
      plans: {
        modulesPlan: { changed: true, desired: modulesDesired, diff: diffFromObject(modulesDesired) },
        timingsPlan: { changed: true, desired: timingsDesired, diff: diffFromObject(timingsDesired) },
        thresholdsPlan: {
          changed: true,
          desired: thresholdsDesired,
          diff: diffFromObject(thresholdsDesired),
        },
      },
      configuration: { modules: false, timings: false, thresholds: false },
      variant: 'dev',
      dryRun: true,
    });

    expect(summary.action).to.equal('set');
    expect(summary.dryRun).to.be.true;
    expect(summary.jobRegistry).to.equal(jobRegistry.address);
    expect(summary.variant).to.equal('dev');
    expect(summary.steps).to.have.lengthOf(3);
    summary.steps.forEach((step) => {
      expect(step.call.to).to.equal(jobRegistry.address);
      expect(step.call.value).to.equal('0');
      expect(step.call.data).to.be.a('string').that.matches(/^0x[0-9a-fA-F]*$/);
    });

    const modulesStep = summary.steps.find((step) => step.method === 'setModules');
    expect(modulesStep).to.exist;
    expect(modulesStep.arguments[0].identity).to.equal(identity);
    expect(modulesStep.diff.identity.next).to.equal(identity);

    const timingsStep = summary.steps.find((step) => step.method === 'setTimings');
    expect(timingsStep.arguments[0]).to.equal(3600);
    expect(timingsStep.diff.commitWindow.next).to.equal(3600);

    const thresholdsStep = summary.steps.find((step) => step.method === 'setThresholds');
    expect(thresholdsStep.arguments[3]).to.equal(275);
    expect(thresholdsStep.diff.feeBps.next).to.equal(275);
  });

  it('builds atomic set action plan summaries', async () => {
    const jobRegistry = await JobRegistry.new({ from: owner });

    const modulesDesired = {
      identity,
      staking,
      validation,
      dispute,
      reputation,
      feePool,
    };
    const timingsDesired = {
      commitWindow: 3600,
      revealWindow: 5400,
      disputeWindow: 7200,
    };
    const thresholdsDesired = {
      approvalThresholdBps: 6000,
      quorumMin: 3,
      quorumMax: 9,
      feeBps: 275,
      slashBpsMax: 2000,
    };

    const summary = buildSetPlanSummary({
      jobRegistry,
      jobRegistryAddress: jobRegistry.address,
      sender: owner,
      plans: {
        modulesPlan: { changed: true, desired: modulesDesired, diff: diffFromObject(modulesDesired) },
        timingsPlan: { changed: true, desired: timingsDesired, diff: diffFromObject(timingsDesired) },
        thresholdsPlan: {
          changed: true,
          desired: thresholdsDesired,
          diff: diffFromObject(thresholdsDesired),
        },
        atomicPlan: {
          changed: true,
          desired: {
            modules: modulesDesired,
            timings: timingsDesired,
            thresholds: thresholdsDesired,
          },
          diff: {
            'modules.identity': { previous: null, next: identity },
            'timings.commitWindow': { previous: null, next: 3600 },
            'thresholds.feeBps': { previous: null, next: 275 },
          },
        },
      },
      configuration: { modules: false, timings: false, thresholds: false },
      variant: 'mainnet',
      dryRun: false,
    });

    expect(summary.steps).to.have.lengthOf(1);
    const [step] = summary.steps;
    expect(step.method).to.equal('setFullConfiguration');
    expect(step.arguments[0].identity).to.equal(identity);
    expect(step.arguments[1].commitWindow).to.equal(3600);
    expect(step.arguments[2].feeBps).to.equal(275);
    expect(step.diff['modules.identity'].next).to.equal(identity);
    expect(step.diff['timings.commitWindow'].next).to.equal(3600);
    expect(step.diff['thresholds.feeBps'].next).to.equal(275);
  });

  it('builds update action plan summaries and writes files', async () => {
    const jobRegistry = await JobRegistry.new({ from: owner });

    const plan = {
      method: 'updateThreshold',
      args: ['3', '325'],
      summary: {
        section: 'thresholds',
        key: 'feeBps',
        previous: 275,
        next: 325,
      },
    };

    const summary = buildUpdatePlanSummary({
      jobRegistry,
      jobRegistryAddress: jobRegistry.address,
      sender: owner,
      plan,
      configuration: { modules: true, timings: true, thresholds: true },
      variant: null,
      dryRun: false,
    });

    expect(summary.action).to.equal('update');
    expect(summary.dryRun).to.be.false;
    expect(summary.steps).to.have.lengthOf(1);
    expect(summary.steps[0].method).to.equal('updateThreshold');
    expect(String(summary.steps[0].diff.feeBps.next)).to.equal('325');

    const outputDir = path.join(__dirname, 'tmp-plan');
    const outputPath = path.join(outputDir, 'plan.json');
    if (fs.existsSync(outputPath)) {
      fs.unlinkSync(outputPath);
    }

    const written = writePlanSummary(summary, outputPath);
    expect(written).to.equal(path.resolve(outputPath));
    const parsed = JSON.parse(fs.readFileSync(written, 'utf8'));
    expect(parsed.action).to.equal('update');
    expect(parsed.steps[0].method).to.equal('updateThreshold');
  });
});
